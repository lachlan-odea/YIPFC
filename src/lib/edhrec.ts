/**
 * Deck ideas from EDHREC: which commanders the cards you already own are
 * signature cards for, and how much of each commander's usual list you hold.
 *
 * EDHREC publishes the JSON behind its pages at json.edhrec.com with open
 * CORS, so the browser reads it directly. Two pages are used: a card's page
 * (its top commanders) and a commander's page (its recommended cards). Pure
 * scoring lives here with the fetching injectable, so it can be tested.
 */
import { cardKey } from './deck.js'

/** EDHREC's URL slug for a card name: front face only, ASCII, lowercase, punctuation dropped, spaces to hyphens. */
export function edhrecSlug(name: string): string {
  return name
    .split(' // ')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"!?.,:;()]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A commander as a card's page lists it. */
export type CommanderRef = { slug: string; name: string; id: string; decks: number; potential: number }

/** What is kept from a card's page. */
export type CardPage = {
  /** How much of the format runs this card, 0..1; staples are near 1 and say nothing about a deck. */
  inclusion: number
  commanders: CommanderRef[]
}

/** What is kept from a commander's page. */
export type CommanderPage = {
  name: string
  id: string
  colours: string[]
  decks: number
  /** Every recommended card name across its lists, deduplicated. */
  cards: string[]
}

type Cardview = { name?: string; sanitized?: string; slug?: string; id?: string; num_decks?: number; potential_decks?: number; url?: string }
type Page = {
  container?: {
    json_dict?: {
      card?: { name?: string; id?: string; num_decks?: number; potential_decks?: number; color_identity?: string[] }
      cardlists?: Array<{ tag?: string; header?: string; cardviews?: Cardview[] }>
    }
  }
}

export function parseCardPage(raw: unknown): CardPage | null {
  const jd = (raw as Page)?.container?.json_dict
  if (!jd?.card) return null
  const decks = jd.card.num_decks ?? 0
  const potential = jd.card.potential_decks ?? 0
  const list = jd.cardlists?.find((l) => l.tag === 'topcommanders')?.cardviews ?? []
  const commanders: CommanderRef[] = []
  for (const v of list) {
    const slug = v.slug ?? v.sanitized ?? (v.url ?? '').split('/').pop()
    if (!slug || !v.name || !v.id) continue
    commanders.push({ slug, name: v.name, id: v.id, decks: v.num_decks ?? 0, potential: v.potential_decks ?? 0 })
  }
  return { inclusion: potential ? decks / potential : 0, commanders }
}

export function parseCommanderPage(raw: unknown): CommanderPage | null {
  const jd = (raw as Page)?.container?.json_dict
  if (!jd?.card) return null
  const names = new Set<string>()
  for (const l of jd.cardlists ?? []) for (const v of l.cardviews ?? []) if (v.name) names.add(v.name)
  return {
    name: jd.card.name ?? '',
    id: jd.card.id ?? '',
    colours: jd.card.color_identity ?? [],
    decks: jd.card.num_decks ?? 0,
    cards: [...names],
  }
}

/** A card you own, as the recommender sees it. */
export type OwnedCard = { name: string; type_line: string }

/** Cards worth asking about: no lands, one entry per name, decks' cards first, capped. */
export function pickCards(owned: OwnedCard[], cap = 80): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of owned) {
    const k = cardKey(c.name)
    if (seen.has(k) || /\bLand\b/.test(c.type_line)) continue
    seen.add(k)
    out.push(c.name)
    if (out.length >= cap) break
  }
  return out
}

/** Above this share of all decks, a card is a staple and says nothing about which deck to build. */
export const STAPLE = 0.25

export type Suggestion = {
  slug: string
  name: string
  id: string
  /** Sum over your cards of how often this commander's decks run them. */
  score: number
  /** Your cards that are signature for this commander, strongest first. */
  cards: string[]
}

/**
 * Rank commanders by how many of your non-staple cards point at them, each
 * card weighted by how much of that commander's decks run it. Commanders in
 * `exclude` (ones you already have a deck for) are dropped.
 */
export function scoreCommanders(pages: Array<{ name: string; page: CardPage | null }>, exclude: Iterable<string> = []): Suggestion[] {
  const skip = new Set([...exclude].map(edhrecSlug))
  const acc = new Map<string, Suggestion & { weights: Map<string, number> }>()
  for (const { name, page } of pages) {
    if (!page || page.inclusion > STAPLE) continue
    for (const c of page.commanders) {
      if (skip.has(c.slug) || skip.has(edhrecSlug(c.name))) continue
      const w = c.potential ? c.decks / c.potential : 0
      if (w <= 0) continue
      const s = acc.get(c.slug) ?? { slug: c.slug, name: c.name, id: c.id, score: 0, cards: [], weights: new Map() }
      s.score += w
      s.weights.set(name, Math.max(w, s.weights.get(name) ?? 0))
      acc.set(c.slug, s)
    }
  }
  return [...acc.values()]
    .map(({ weights, ...s }) => ({ ...s, cards: [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) }))
    .sort((a, b) => b.score - a.score || b.cards.length - a.cards.length || a.name.localeCompare(b.name))
}

/** Which of your cards a commander's page recommends. */
export function ownedFor(page: CommanderPage, ownedNames: Iterable<string>): string[] {
  const want = new Map(page.cards.map((n) => [cardKey(n), n]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of ownedNames) {
    const k = cardKey(n)
    if (want.has(k) && !seen.has(k)) {
      seen.add(k)
      out.push(n)
    }
  }
  return out
}

/* ---------- fetching, with a week-long cache in localStorage ---------- */

const BASE = 'https://json.edhrec.com/pages'
const TTL = 7 * 24 * 60 * 60 * 1000
const PREFIX = 'yipfc/edhrec/'

type Fetcher = (url: string) => Promise<Response>

function cached<T>(key: string): T | null | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const { at, v } = JSON.parse(raw) as { at: number; v: T | null }
    return Date.now() - at < TTL ? v : undefined
  } catch {
    return undefined
  }
}

function remember<T>(key: string, v: T | null) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v }))
  } catch {
    /* storage full: fine, it is only a cache */
  }
}

/** Forget every cached EDHREC page, so the next run fetches fresh. */
export function clearCache() {
  try {
    const gone: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) gone.push(k)
    }
    gone.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* nothing to clear */
  }
}

async function getPage<T>(kind: 'cards' | 'commanders', slug: string, parse: (raw: unknown) => T | null, fetcher: Fetcher): Promise<T | null> {
  const key = `${kind}/${slug}`
  const hit = cached<T>(key)
  if (hit !== undefined) return hit
  let v: T | null = null
  try {
    const res = await fetcher(`${BASE}/${kind}/${slug}.json`)
    if (res.ok) v = parse(await res.json())
    else if (res.status !== 403 && res.status !== 404) return null // transient: do not cache
  } catch {
    return null
  }
  remember(key, v)
  return v
}

export const cardPage = (name: string, fetcher: Fetcher = fetch) => getPage('cards', edhrecSlug(name), parseCardPage, fetcher)
export const commanderPage = (slug: string, fetcher: Fetcher = fetch) => getPage('commanders', slug, parseCommanderPage, fetcher)

/** Run `work` over `items` a few at a time, reporting progress. */
export async function throttled<T, R>(items: T[], work: (item: T) => Promise<R>, onProgress?: (done: number) => void, concurrency = 4): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await work(items[i])
        onProgress?.(++done)
      }
    }),
  )
  return out
}

export const edhrecUrl = (slug: string) => `https://edhrec.com/commanders/${slug}`
export const artFor = (scryfallId: string) => `https://cards.scryfall.io/art_crop/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`
