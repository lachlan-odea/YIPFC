import { get, set } from 'idb-keyval'
import { uid } from './uid'
import type { Deck, Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

const KEY = 'pod-pool/v1'

/**
 * Single-device store backed by IndexedDB. Used when no Firebase config is
 * present so the app is fully usable on one phone before the pod sets up
 * sharing. Also doubles as a readable reference for the store contract.
 */
export class LocalStore implements PoolStore {
  readonly mode = 'local' as const
  private snap: Snapshot = { players: [], cards: [], loans: [], decks: [] }
  private listeners = new Set<() => void>()
  private loaded = false

  async load(): Promise<Snapshot> {
    if (!this.loaded) {
      const stored = await get<Snapshot>(KEY)
      // Older saves predate decks; fill the gap so the rest of the app can assume it.
      if (stored) this.snap = { ...stored, decks: stored.decks ?? [] }
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
      // Same owner + same printing: bump quantity rather than duplicate the row.
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

  async updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes'>>) {
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

  async createLoan(cardId: string, borrowerId: string): Promise<Loan> {
    const now = new Date().toISOString()
    const loan: Loan = {
      id: uid(),
      card_id: cardId,
      borrower_id: borrowerId,
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
}
