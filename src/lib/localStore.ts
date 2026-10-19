import { get, set } from 'idb-keyval'
import type { Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

const KEY = 'pod-pool/v1'

/**
 * Single-device store backed by IndexedDB. Used when no Supabase config is
 * present so the app is fully usable on one phone before the pod sets up
 * sharing. Also doubles as a readable reference for the store contract.
 */
export class LocalStore implements PoolStore {
  readonly mode = 'local' as const
  private snap: Snapshot = { players: [], cards: [], loans: [] }
  private listeners = new Set<() => void>()
  private loaded = false

  async load(): Promise<Snapshot> {
    if (!this.loaded) {
      const stored = await get<Snapshot>(KEY)
      if (stored) this.snap = stored
      this.loaded = true
    }
    return this.snap
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  private async commit() {
    this.snap = { players: [...this.snap.players], cards: [...this.snap.cards], loans: [...this.snap.loans] }
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
      const dup = this.snap.cards.find((x) => x.owner_id === ownerId && x.scryfall_id === c.scryfall_id)
      if (dup) {
        dup.quantity += c.quantity
        added.push(dup)
        continue
      }
      const row: PoolCard = { ...c, id: crypto.randomUUID(), owner_id: ownerId, created_at: now }
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

  async createLoan(cardId: string, borrowerId: string): Promise<Loan> {
    const now = new Date().toISOString()
    const loan: Loan = {
      id: crypto.randomUUID(),
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
}
