/** A signed-in account. In shared mode the id is the Firebase uid; locally it is a random id. */
export type AuthUser = {
  id: string
  email: string | null
}

/** A person. The id matches their account id, so one account is one player everywhere. */
export type Player = {
  id: string
  name: string
  email?: string
  created_at: string
}

/**
 * A pod: a group of players whose collections are pooled together. A player
 * can be in several pods; their collection is the same in each.
 */
export type Pod = {
  id: string
  name: string
  /** Six-character invite code, also carried in share links. */
  code: string
  created_by: string
  members: string[]
  created_at: string
}

/** One line in a collection: a printing someone owns spare copies of. */
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
  /** Scryfall layout ("normal", "modal_dfc", "transform", ...). Undefined on rows added before it was stored. */
  layout?: string
  /** Back face image for double-faced cards; empty for single-faced. */
  image_back?: string
  created_at: string
}

export type LoanStatus = 'requested' | 'lent' | 'returned' | 'declined'

export type Loan = {
  id: string
  card_id: string
  borrower_id: string
  /** The card's owner, copied so loans can be found by either party. */
  owner_id?: string
  /** The pod the request was made in, for context only. */
  pod_id?: string | null
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

/** One seat's line in a finished game. */
export type SeatResult = {
  seat: number
  name: string
  /** The pod player, when the seat was picked from the pod. */
  player_id: string | null
  /** The commander they played, as typed; tallies match it case-insensitively. */
  commander: string | null
  colour: string
  won: boolean
  /** The turn they went out, or null if they were still in at the end. */
  out_turn: number | null
  final_life: number
  life_gained: number
  life_lost: number
  commander_dealt: number
  commander_taken: number
  poison: number
  turns: number
}

/** A finished game of Commander, kept so commanders and players build up a record. */
export type GameRecord = {
  id: string
  /** The pod it was played in, or null for a game outside any pod. */
  pod_id: string | null
  created_by: string
  played_at: string
  ended_at: string
  /** Turns taken in total, counting every player's turn. */
  turns: number
  starting_life: number
  winner_seat: number | null
  players: SeatResult[]
}

/** What the import/scan flows hand to the store: a card minus its pool bookkeeping. */
export type NewPoolCard = Omit<PoolCard, 'id' | 'owner_id' | 'created_at'>

/** Everything the UI needs for the current view: the pod's members and their data, plus your pods. */
export type Snapshot = {
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
  decks: Deck[]
  pods: Pod[]
  /** Finished games in the current pod (or your own, outside a pod), newest first. */
  games: GameRecord[]
}

export interface PoolStore {
  readonly mode: 'local' | 'shared'

  // ---- accounts
  /** Reports the signed-in user now and whenever it changes. */
  onAuth(cb: (user: AuthUser | null) => void): () => void
  /** Local mode ignores email and password and just needs a name. */
  signUp(name: string, email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  resetPassword(email: string): Promise<void>
  upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player>

  // ---- pods
  /** Which pod load()/subscribe cover. null shows only your own collection. */
  setPod(podId: string | null): void
  createPod(name: string): Promise<Pod>
  joinPod(code: string): Promise<Pod>
  leavePod(podId: string): Promise<void>
  renamePod(podId: string, name: string): Promise<void>

  // ---- data
  load(): Promise<Snapshot>
  subscribe(onChange: () => void): () => void
  addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]>
  updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes' | 'layout' | 'image_back'>>): Promise<void>
  removeCard(id: string): Promise<void>
  /** Swap a row for a different printing or finish, keeping owner, quantity and notes; merges into an existing matching row. */
  replaceCard(id: string, next: NewPoolCard): Promise<PoolCard>
  createLoan(cardId: string, borrowerId: string, ownerId: string, podId: string | null): Promise<Loan>
  setLoanStatus(id: string, status: LoanStatus): Promise<void>
  /** Insert or replace a whole deck. */
  saveDeck(deck: Deck): Promise<void>
  removeDeck(id: string): Promise<void>
  /** Keep a finished game's result. */
  saveGame(record: GameRecord): Promise<void>
  removeGame(id: string): Promise<void>

  /** Shared mode only: move a pre-accounts player's cards, loans and decks onto the signed-in account. Returns cards moved. */
  claimLegacy?(oldPlayerId: string): Promise<number>
}
