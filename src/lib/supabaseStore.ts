import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

/**
 * Shared store for the whole pod. Tables are defined in supabase/schema.sql.
 * Realtime changes on any table trigger a reload so every phone stays in sync.
 */
export class SupabaseStore implements PoolStore {
  readonly mode = 'shared' as const
  private client: SupabaseClient
  private listeners = new Set<() => void>()
  private channelStarted = false

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey)
  }

  async load(): Promise<Snapshot> {
    const [players, cards, loans] = await Promise.all([
      this.client.from('players').select('*').order('name'),
      this.client.from('cards').select('*').order('name'),
      this.client.from('loans').select('*').order('requested_at', { ascending: false }),
    ])
    const err = players.error ?? cards.error ?? loans.error
    if (err) throw new Error(err.message)
    return {
      players: (players.data ?? []) as Player[],
      cards: (cards.data ?? []) as PoolCard[],
      loans: (loans.data ?? []) as Loan[],
    }
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    if (!this.channelStarted) {
      this.channelStarted = true
      const notify = () => this.listeners.forEach((l) => l())
      this.client
        .channel('pool-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, notify)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, notify)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, notify)
        .subscribe()
    }
    return () => void this.listeners.delete(onChange)
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }

  async upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player> {
    const { data, error } = await this.client.from('players').upsert(player).select().single()
    if (error) throw new Error(error.message)
    this.notify()
    return data as Player
  }

  async addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]> {
    const rows = cards.map((c) => ({ ...c, owner_id: ownerId }))
    // Unique (owner_id, scryfall_id) in the schema; the RPC adds quantities on conflict.
    const { data, error } = await this.client.rpc('add_cards', { rows })
    if (error) throw new Error(error.message)
    this.notify()
    return (data ?? []) as PoolCard[]
  }

  async updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes'>>) {
    const { error } = await this.client.from('cards').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    this.notify()
  }

  async removeCard(id: string) {
    const { error } = await this.client.from('cards').delete().eq('id', id)
    if (error) throw new Error(error.message)
    this.notify()
  }

  async createLoan(cardId: string, borrowerId: string): Promise<Loan> {
    const { data, error } = await this.client
      .from('loans')
      .insert({ card_id: cardId, borrower_id: borrowerId, status: 'requested' })
      .select()
      .single()
    if (error) throw new Error(error.message)
    this.notify()
    return data as Loan
  }

  async setLoanStatus(id: string, status: LoanStatus) {
    const { error } = await this.client
      .from('loans')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(error.message)
    this.notify()
  }
}
