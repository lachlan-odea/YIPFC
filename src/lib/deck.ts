import type { Deck, DeckCard, Loan, PoolCard } from './types'

/**
 * Pure deck logic: matching deck lines to pool cards, working out what is
 * covered and what is missing, and grouping for display. No React, no
 * Scryfall, so it is unit tested directly.
 */

/** "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki" and its front face compare equal. */
export function cardKey(name: string): string {
  return name.split(' // ')[0].trim().toLowerCase()
}

export function sameCard(a: string, b: string) {
  return cardKey(a) === cardKey(b)
}

export type Source = { row: PoolCard; free: number }

export type CardCoverage = {
  card: DeckCard
  need: number
  /** Copies in your own pile of spares (free, not out on loan). */
  yours: number
  /** Copies other players have free to lend right now. */
  borrowable: number
  /** Copies you already hold or have asked for from someone else. */
  pending: number
  missing: number
  yourRows: PoolCard[]
  otherRows: Source[]
  /** The loan you have open on a matching card, if any. */
  myLoan?: Loan
}

export type Coverage = {
  rows: CardCoverage[]
  total: number
  yours: number
  borrowable: number
  pending: number
  missing: number
}

/**
 * Compare a deck with the pool from one player's point of view. A pool row is
 * free when it has no open loan; a row the viewer has asked for or already
 * holds counts as pending rather than borrowable.
 */
export function coverage(cards: DeckCard[], pool: PoolCard[], loans: Loan[], meId: string | null): Coverage {
  const openLoan = (cardId: string) => loans.find((l) => l.card_id === cardId && (l.status === 'requested' || l.status === 'lent'))
  const rows: CardCoverage[] = cards.map((card) => {
    const key = cardKey(card.name)
    const matches = pool.filter((p) => cardKey(p.name) === key)
    const yourRows = matches.filter((p) => p.owner_id === meId)
    const otherRows: Source[] = []
    let pending = 0
    let myLoan: Loan | undefined
    for (const p of matches) {
      if (p.owner_id === meId) continue
      const loan = openLoan(p.id)
      if (loan && loan.borrower_id === meId) {
        pending += p.quantity
        myLoan ??= loan
      } else if (!loan) otherRows.push({ row: p, free: p.quantity })
    }
    const yours = yourRows.reduce((n, p) => n + (openLoan(p.id) ? 0 : p.quantity), 0)
    const borrowable = otherRows.reduce((n, s) => n + s.free, 0)
    const need = card.quantity
    const have = Math.min(need, yours)
    const pend = Math.min(need - have, pending)
    const borrow = Math.min(need - have - pend, borrowable)
    return {
      card,
      need,
      yours: have,
      pending: pend,
      borrowable: borrow,
      missing: need - have - pend - borrow,
      yourRows,
      otherRows,
      myLoan,
    }
  })
  const sum = (k: 'need' | 'yours' | 'borrowable' | 'pending' | 'missing') => rows.reduce((n, r) => n + r[k], 0)
  return { rows, total: sum('need'), yours: sum('yours'), borrowable: sum('borrowable'), pending: sum('pending'), missing: sum('missing') }
}

const TYPE_ORDER = ['Commander', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other']

/** The primary type for grouping: the first of TYPE_ORDER found in the type line. */
export function primaryType(card: Pick<DeckCard, 'type_line' | 'commander'>): string {
  if (card.commander) return 'Commander'
  const front = card.type_line.split(' // ')[0]
  for (const t of TYPE_ORDER) if (t !== 'Commander' && t !== 'Other' && front.includes(t)) return t
  return 'Other'
}

export function groupByType<T extends { card: DeckCard }>(rows: T[]): Array<{ type: string; rows: T[]; count: number }> {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const t = primaryType(r.card)
    groups.set(t, [...(groups.get(t) ?? []), r])
  }
  return TYPE_ORDER.filter((t) => groups.has(t)).map((t) => {
    const list = groups.get(t)!.slice().sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name))
    return { type: t, rows: list, count: list.reduce((n, r) => n + r.card.quantity, 0) }
  })
}

/** Merge a card into a deck's list, adding quantities when the name is already there. */
export function addToDeck(cards: DeckCard[], add: DeckCard): DeckCard[] {
  const i = cards.findIndex((c) => sameCard(c.name, add.name))
  if (i < 0) return [...cards, add]
  return cards.map((c, j) => (j === i ? { ...c, quantity: c.quantity + add.quantity } : c))
}

export function setDeckQty(cards: DeckCard[], name: string, quantity: number): DeckCard[] {
  if (quantity <= 0) return cards.filter((c) => !sameCard(c.name, name))
  return cards.map((c) => (sameCard(c.name, name) ? { ...c, quantity } : c))
}

export function deckSize(deck: Pick<Deck, 'cards'>): number {
  return deck.cards.reduce((n, c) => n + c.quantity, 0)
}

/** Plain text in the "1 Card Name" form every deck site accepts, commander first. */
export function deckToText(deck: Deck): string {
  const line = (c: DeckCard) => `${c.quantity} ${c.name}`
  const commanders = deck.cards.filter((c) => c.commander)
  const rest = deck.cards.filter((c) => !c.commander).slice().sort((a, b) => a.name.localeCompare(b.name))
  const parts: string[] = []
  if (commanders.length) parts.push('Commander', ...commanders.map(line), '')
  parts.push(...rest.map(line))
  return parts.join('\n')
}

export function fromPoolCard(p: PoolCard, quantity = 1): DeckCard {
  return {
    scryfall_id: p.scryfall_id,
    name: p.name,
    quantity,
    type_line: p.type_line,
    mana_cost: p.mana_cost,
    cmc: p.cmc,
    color_identity: p.color_identity,
    image_small: p.image_small,
    commander: false,
  }
}
