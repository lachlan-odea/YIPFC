export type Player = {
  id: string
  name: string
  created_at: string
}

/** One line in the pool: a printing someone owns spare copies of. */
export type PoolCard = {
  id: string
  owner_id: string
  scryfall_id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string
  type_line: string
  mana_cost: string
  cmc: number
  color_identity: string[]
  rarity: string
  image_small: string
  image_normal: string
  oracle_text: string
  quantity: number
  notes: string
  created_at: string
}

export type LoanStatus = 'requested' | 'lent' | 'returned' | 'declined'

export type Loan = {
  id: string
  card_id: string
  borrower_id: string
  status: LoanStatus
  requested_at: string
  updated_at: string
}

/** What the import/scan flows hand to the store: a card minus its pool bookkeeping. */
export type NewPoolCard = Omit<PoolCard, 'id' | 'owner_id' | 'created_at'>

export type Snapshot = {
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
}

export interface PoolStore {
  readonly mode: 'local' | 'shared'
  load(): Promise<Snapshot>
  subscribe(onChange: () => void): () => void
  upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player>
  addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]>
  updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes'>>): Promise<void>
  removeCard(id: string): Promise<void>
  createLoan(cardId: string, borrowerId: string): Promise<Loan>
  setLoanStatus(id: string, status: LoanStatus): Promise<void>
}
