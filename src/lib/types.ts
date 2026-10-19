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
  /** Foil copies are listed separately from non-foil ones of the same printing. */
  foil: boolean
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

/** One line of a deck. Enough card data to render and group it without a lookup. */
export type DeckCard = {
  scryfall_id: string
  name: string
  quantity: number
  type_line: string
  mana_cost: string
  cmc: number
  color_identity: string[]
  image_small: string
  commander: boolean
}

export type Deck = {
  id: string
  owner_id: string
  name: string
  cards: DeckCard[]
  created_at: string
  updated_at: string
}

/** What the import/scan flows hand to the store: a card minus its pool bookkeeping. */
export type NewPoolCard = Omit<PoolCard, 'id' | 'owner_id' | 'created_at'>

export type Snapshot = {
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
  decks: Deck[]
}

export interface PoolStore {
  readonly mode: 'local' | 'shared'
  load(): Promise<Snapshot>
  subscribe(onChange: () => void): () => void
  upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player>
  addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]>
  updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes'>>): Promise<void>
  removeCard(id: string): Promise<void>
  /** Swap a row for a different printing or finish, keeping owner, quantity and notes; merges into an existing matching row. */
  replaceCard(id: string, next: NewPoolCard): Promise<PoolCard>
  createLoan(cardId: string, borrowerId: string): Promise<Loan>
  setLoanStatus(id: string, status: LoanStatus): Promise<void>
  /** Insert or replace a whole deck. */
  saveDeck(deck: Deck): Promise<void>
  removeDeck(id: string): Promise<void>
}
