import { get, set } from 'idb-keyval'
import { uid } from './uid'
import type { AuthUser, Deck, GameRecord, LiveSessions, Loan, LoanStatus, NewPoolCard, Player, Pod, PoolCard, PoolStore, Snapshot } from './types'

const KEY = 'pod-pool/v1'
// Storage key keeps the app's original name so devices that already joined stay signed in.
const ME_KEY = 'pod-pool/me'

/**
 * Single-device store backed by IndexedDB. Used when no Firebase config is
 * present so the app is fully usable on one phone before the pod sets up
 * sharing. There are no accounts or pods here: one local player, one pile.
 * Also doubles as a readable reference for the store contract.
 */
export class LocalStore implements PoolStore {
  readonly mode = 'local' as const
  /** Normally absent: a single device has no pod to share a table with. Dev builds can attach an in-memory one. */
  live?: LiveSessions
  private snap: Snapshot = { players: [], cards: [], loans: [], decks: [], pods: [], games: [] }
  private listeners = new Set<() => void>()
  private authListeners = new Set<(u: AuthUser | null) => void>()
  private loaded = false

  // ---- accounts: the local "account" is just a name remembered on this device

  private user(): AuthUser | null {
    const id = localStorage.getItem(ME_KEY)
    return id ? { id, email: null } : null
  }

  onAuth(cb: (user: AuthUser | null) => void) {
    this.authListeners.add(cb)
    cb(this.user())
    return () => void this.authListeners.delete(cb)
  }

  private announce() {
    const u = this.user()
    this.authListeners.forEach((l) => l(u))
  }

  async signUp(name: string) {
    await this.load()
    const id = uid()
    await this.upsertPlayer({ id, name })
    localStorage.setItem(ME_KEY, id)
    this.announce()
  }

  async signIn() {
    throw new Error('Signing in with an email needs the shared pool. On this device, just enter your name.')
  }

  async signOut() {
    localStorage.removeItem(ME_KEY)
    this.announce()
  }

  async resetPassword() {
    throw new Error('There is no password in single-device mode.')
  }

  // ---- pods: not available without the shared pool

  setPod() {}
  async createPod(): Promise<Pod> {
    throw new Error('Pods need the shared pool. See the README to connect Firebase.')
  }
  async joinPod(): Promise<Pod> {
    throw new Error('Pods need the shared pool. See the README to connect Firebase.')
  }
  async leavePod() {}
  async renamePod() {}

  // ---- data

  async load(): Promise<Snapshot> {
    if (!this.loaded) {
      const stored = await get<Snapshot>(KEY)
      // Older saves predate decks, pods and games; fill the gaps so the rest of the app can assume them.
      if (stored) this.snap = { ...stored, decks: stored.decks ?? [], pods: [], games: stored.games ?? [] }
      this.loaded = true
    }
    return this.snap
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  private async commit() {
    this.snap = {
      players: [...this.snap.players],
      cards: [...this.snap.cards],
      loans: [...this.snap.loans],
      decks: [...this.snap.decks],
      pods: [],
      games: [...this.snap.games],
    }
    await set(KEY, this.snap)
    this.listeners.forEach((l) => l())
  }

  async upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player> {
    const existing = this.snap.players.find((p) => p.id === player.id)
    const next: Player = existing
      ? { ...existing, name: player.name }
      : { ...player, created_at: new Date().toISOString() }
    this.snap.players = existing
      ? this.snap.players.map((p) => (p.id === next.id ? next : p))
      : [...this.snap.players, next]
    await this.commit()
    return next
  }

  async addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]> {
    const now = new Date().toISOString()
    const added: PoolCard[] = []
    for (const c of cards) {
      // Same owner + same printing + same finish: bump quantity rather than duplicate the row.
      const dup = this.snap.cards.find((x) => x.owner_id === ownerId && x.scryfall_id === c.scryfall_id && !!x.foil === !!c.foil)
      if (dup) {
        dup.quantity += c.quantity
        added.push(dup)
        continue
      }
      const row: PoolCard = { ...c, id: uid(), owner_id: ownerId, created_at: now }
      this.snap.cards.push(row)
      added.push(row)
    }
    await this.commit()
    return added
  }

  async updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes' | 'layout' | 'image_back'>>) {
    this.snap.cards = this.snap.cards.map((c) => (c.id === id ? { ...c, ...patch } : c))
    await this.commit()
  }

  async removeCard(id: string) {
    this.snap.cards = this.snap.cards.filter((c) => c.id !== id)
    this.snap.loans = this.snap.loans.filter((l) => l.card_id !== id)
    await this.commit()
  }

  async replaceCard(id: string, next: NewPoolCard): Promise<PoolCard> {
    const old = this.snap.cards.find((c) => c.id === id)
    if (!old) throw new Error('That card is no longer in the pool.')
    const twin = this.snap.cards.find((x) => x.id !== id && x.owner_id === old.owner_id && x.scryfall_id === next.scryfall_id && !!x.foil === !!next.foil)
    let result: PoolCard
    if (twin) {
      result = { ...twin, quantity: twin.quantity + next.quantity }
      this.snap.cards = this.snap.cards.filter((c) => c.id !== id).map((c) => (c.id === twin.id ? result : c))
    } else {
      result = { ...old, ...next }
      this.snap.cards = this.snap.cards.map((c) => (c.id === id ? result : c))
    }
    await this.commit()
    return result
  }

  async createLoan(cardId: string, borrowerId: string, ownerId: string, podId: string | null): Promise<Loan> {
    const now = new Date().toISOString()
    const loan: Loan = {
      id: uid(),
      card_id: cardId,
      borrower_id: borrowerId,
      owner_id: ownerId,
      pod_id: podId,
      status: 'requested',
      requested_at: now,
      updated_at: now,
    }
    this.snap.loans.push(loan)
    await this.commit()
    return loan
  }

  async setLoanStatus(id: string, status: LoanStatus) {
    const now = new Date().toISOString()
    this.snap.loans = this.snap.loans.map((l) => (l.id === id ? { ...l, status, updated_at: now } : l))
    await this.commit()
  }

  async saveDeck(deck: Deck) {
    const exists = this.snap.decks.some((d) => d.id === deck.id)
    this.snap.decks = exists ? this.snap.decks.map((d) => (d.id === deck.id ? deck : d)) : [...this.snap.decks, deck]
    await this.commit()
  }

  async removeDeck(id: string) {
    this.snap.decks = this.snap.decks.filter((d) => d.id !== id)
    await this.commit()
  }

  async saveGame(record: GameRecord) {
    this.snap.games = [record, ...this.snap.games.filter((g) => g.id !== record.id)].sort((a, b) => b.ended_at.localeCompare(a.ended_at))
    await this.commit()
  }

  async removeGame(id: string) {
    this.snap.games = this.snap.games.filter((g) => g.id !== id)
    await this.commit()
  }
}
