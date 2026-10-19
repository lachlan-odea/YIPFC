import type { Deck, Loan, PoolCard } from './types'

/**
 * Achievements are derived, never stored: everything is recomputed from the
 * pool, loans and decks, so they stay honest and need no migration. Personal
 * ones look at your own activity; pod ones at everyone's.
 */

export type SetSizeLike = { code: string; name: string; size: number }

export type SetProgress = { code: string; name: string; have: number; size: number; pct: number }

/** How much of each set the pod holds between them: distinct collector numbers over the set's size. */
export function setProgress(cards: PoolCard[], sizes: Record<string, SetSizeLike>): SetProgress[] {
  const have = new Map<string, Set<string>>()
  for (const c of cards) {
    if (!have.has(c.set_code)) have.set(c.set_code, new Set())
    have.get(c.set_code)!.add(c.collector_number || c.scryfall_id)
  }
  return [...have.entries()]
    .map(([code, nums]) => {
      const s = sizes[code]
      const size = s?.size ?? 0
      return { code, name: s?.name ?? code.toUpperCase(), have: nums.size, size, pct: size ? Math.min(1, nums.size / size) : 0 }
    })
    .sort((a, b) => b.pct - a.pct || b.have - a.have || a.name.localeCompare(b.name))
}

export type Achievement = {
  id: string
  title: string
  /** What it takes, phrased for the locked state. */
  hint: string
  icon: string
  earned: boolean
  /** Optional progress towards it, for the locked state. */
  progress?: { n: number; of: number }
  pod?: boolean
}

export type AchievementInput = {
  meId: string
  cards: PoolCard[]
  loans: Loan[]
  decks: Deck[]
  playerCount: number
  sets: SetProgress[]
}

export function achievements(a: AchievementInput): Achievement[] {
  const mine = a.cards.filter((c) => c.owner_id === a.meId)
  const copies = mine.reduce((n, c) => n + c.quantity, 0)
  const myCardIds = new Set(mine.map((c) => c.id))
  const lentByMe = a.loans.filter((l) => myCardIds.has(l.card_id) && (l.status === 'lent' || l.status === 'returned'))
  const borrowedByMe = a.loans.filter((l) => l.borrower_id === a.meId && (l.status === 'lent' || l.status === 'returned'))
  const returnedByMe = a.loans.filter((l) => l.borrower_id === a.meId && l.status === 'returned')
  const myDecks = a.decks.filter((d) => d.owner_id === a.meId)
  const colours = new Set(mine.flatMap((c) => c.color_identity))
  const foils = mine.filter((c) => c.foil).length
  const distinctSets = new Set(mine.map((c) => c.set_code)).size
  const podCopies = a.cards.reduce((n, c) => n + c.quantity, 0)
  const bestSet = a.sets[0]

  const step = (id: string, title: string, hint: string, icon: string, n: number, of: number, pod = false): Achievement => ({
    id,
    title,
    hint,
    icon,
    earned: n >= of,
    progress: n >= of ? undefined : { n, of },
    pod,
  })

  return [
    step('first-card', 'Dipping your toe in', 'Add your first card to the pool.', '🫧', copies, 1),
    step('shelf', 'Stocking the shelves', 'Offer 25 spare cards.', '📚', copies, 25),
    step('hoard', "Dragon's hoard", 'Offer 100 spare cards.', '🐉', copies, 100),
    step('shiny', 'Shiny!', 'List a foil.', '✨', foils, 1),
    step('rainbow', 'All five colours', 'Offer cards of every colour.', '🌈', ['W', 'U', 'B', 'R', 'G'].filter((c) => colours.has(c)).length, 5),
    step('traveller', 'Well travelled', 'Offer cards from 10 different sets.', '🗺️', distinctSets, 10),
    step('neighbour', 'Good neighbour', 'Lend a card to someone in the pod.', '🤝', lentByMe.length, 1),
    step('pillar', 'Pillar of the community', 'Lend 10 cards.', '🏛️', lentByMe.length, 10),
    step('borrower', 'Yes, I borrow cardboard', 'Borrow a card from the pod.', '🙏', borrowedByMe.length, 1),
    step('full-circle', 'Full circle', 'Give a borrowed card back.', '🔁', returnedByMe.length, 1),
    step('architect', 'Deck architect', 'Build a deck in the Decks tab.', '📐', myDecks.length, 1),
    step('ninety-nine', 'Ninety-nine problems', 'Build a deck with 100 cards in it.', '💯', myDecks.some((d) => d.cards.reduce((n, c) => n + c.quantity, 0) >= 100) ? 1 : 0, 1),
    step('pod-of-four', 'A proper pod', 'Four or more players in the pool.', '👥', a.playerCount, 4, true),
    step('pod-pile', 'The great pile', 'The pod offers 500 spare cards between you.', '🏔️', podCopies, 500, true),
    step('set-quarter', 'Collectors', `Hold a quarter of any set as a pod${bestSet ? ` (${bestSet.name})` : ''}.`, '🧩', bestSet ? Math.round(bestSet.pct * 100) : 0, 25, true),
    step('set-half', 'Halfway there', `Hold half of any set as a pod${bestSet ? ` (${bestSet.name})` : ''}.`, '🌗', bestSet ? Math.round(bestSet.pct * 100) : 0, 50, true),
    step('set-complete', 'Set complete', 'Hold every card of a set as a pod.', '🏆', a.sets.filter((s) => s.size > 0 && s.have >= s.size).length, 1, true),
  ]
}
