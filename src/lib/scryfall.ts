import type { NewPoolCard } from './types'

const API = 'https://api.scryfall.com'

/** Scryfall card object, trimmed to the fields this app reads. */
export type ScryfallCard = {
  id: string
  name: string
  set: string
  set_name: string
  collector_number: string
  type_line?: string
  mana_cost?: string
  cmc?: number
  color_identity?: string[]
  rarity?: string
  oracle_text?: string
  prices?: { usd: string | null; usd_foil: string | null; eur: string | null; eur_foil: string | null }
  image_uris?: Record<string, string>
  card_faces?: Array<{
    name: string
    type_line?: string
    mana_cost?: string
    oracle_text?: string
    image_uris?: Record<string, string>
  }>
}

export type CardIdentifier =
  | { name: string; set?: string }
  | { set: string; collector_number: string }
  | { id: string }

export class ScryfallError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Scryfall asks for at most 10 requests/second; a small spacing keeps us polite.
let lastCall = 0
async function throttle() {
  const wait = Math.max(0, 110 - (Date.now() - lastCall))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await throttle()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { details?: string }
      if (body.details) detail = body.details
    } catch {
      /* non-JSON error body */
    }
    throw new ScryfallError(detail, res.status)
  }
  return (await res.json()) as T
}

export function autocomplete(query: string): Promise<string[]> {
  if (query.trim().length < 2) return Promise.resolve([])
  return request<{ data: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(query)}`).then((r) => r.data)
}

export function namedFuzzy(name: string): Promise<ScryfallCard> {
  return request<ScryfallCard>(`/cards/named?fuzzy=${encodeURIComponent(name)}`)
}

export function namedExact(name: string, set?: string): Promise<ScryfallCard> {
  const setParam = set ? `&set=${encodeURIComponent(set)}` : ''
  return request<ScryfallCard>(`/cards/named?exact=${encodeURIComponent(name)}${setParam}`)
}

/** One card by Scryfall id (what the art index stores). */
export function cardById(id: string): Promise<ScryfallCard> {
  return request<ScryfallCard>(`/cards/${encodeURIComponent(id)}`)
}

/** One exact printing by set code and collector number, as printed in a card's footer. */
export function bySetNumber(set: string, number: string): Promise<ScryfallCard> {
  return request<ScryfallCard>(`/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(number)}`)
}

/** All printings of a card, newest first, for picking the exact version you own. */
export function printings(name: string): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(`!"${name}" game:paper`)
  return request<{ data: ScryfallCard[] }>(`/cards/search?q=${q}&unique=prints&order=released`).then((r) => r.data)
}

export type CollectionResult = { found: ScryfallCard[]; notFound: CardIdentifier[] }

/** Resolve many identifiers at once. Scryfall caps a batch at 75; this chunks for you. */
export async function collection(identifiers: CardIdentifier[]): Promise<CollectionResult> {
  const found: ScryfallCard[] = []
  const notFound: CardIdentifier[] = []
  for (let i = 0; i < identifiers.length; i += 75) {
    const batch = identifiers.slice(i, i + 75)
    const r = await request<{ data: ScryfallCard[]; not_found: CardIdentifier[] }>('/cards/collection', {
      method: 'POST',
      body: JSON.stringify({ identifiers: batch }),
    })
    found.push(...r.data)
    notFound.push(...r.not_found)
  }
  return { found, notFound }
}

function imageOf(card: ScryfallCard, size: 'small' | 'normal'): string {
  return card.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size] ?? ''
}

export function toPoolCard(card: ScryfallCard, quantity = 1, notes = ''): NewPoolCard {
  const face = card.card_faces?.[0]
  return {
    scryfall_id: card.id,
    name: card.name,
    set_code: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    type_line: card.type_line ?? face?.type_line ?? '',
    mana_cost: card.mana_cost ?? card.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(' // ') ?? '',
    cmc: card.cmc ?? 0,
    color_identity: card.color_identity ?? [],
    rarity: card.rarity ?? '',
    image_small: imageOf(card, 'small'),
    image_normal: imageOf(card, 'normal'),
    oracle_text: card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).filter(Boolean).join('\n//\n') ?? '',
    quantity,
    notes,
  }
}
