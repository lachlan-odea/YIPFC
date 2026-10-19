import { collection } from './scryfall'

/**
 * Card values in Australian dollars. Scryfall publishes USD (and EUR) prices
 * per printing; we convert with the European Central Bank's USD→AUD rate via
 * frankfurter.dev. Both are cached in localStorage for a day: prices move
 * slowly and the pod does not need tick-by-tick numbers.
 */

const RATE_KEY = 'yipfc/aud-rate/v1'
const PRICE_KEY = 'yipfc/prices/v2'
const DAY = 24 * 60 * 60 * 1000

export type Price = {
  /** Scryfall's USD prices for this printing, by finish; null when not listed. */
  usd: number | null
  usd_foil: number | null
}

/** The AUD value of one copy, preferring the card's own finish and falling back to the other. */
export function audFor(p: Price | null | undefined, foil: boolean, rate: number): { aud: number; usedFoil: boolean } | null {
  if (!p) return null
  const pick = foil ? (p.usd_foil ?? p.usd) : (p.usd ?? p.usd_foil)
  if (pick === null) return null
  return { aud: pick * rate, usedFoil: foil ? p.usd_foil !== null : p.usd === null }
}

type RateCache = { rate: number; date: string; fetched: number }
type PriceCache = { fetched: number; prices: Record<string, Price | null> }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked; we just refetch next time */
  }
}

/** USD→AUD rate and the date it is for. */
export async function audRate(): Promise<{ rate: number; date: string }> {
  const cached = read<RateCache>(RATE_KEY)
  if (cached && Date.now() - cached.fetched < DAY) return cached
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD')
    if (!res.ok) throw new Error(`rate ${res.status}`)
    const data = (await res.json()) as { date: string; rates: { AUD: number } }
    const next: RateCache = { rate: data.rates.AUD, date: data.date, fetched: Date.now() }
    write(RATE_KEY, next)
    return next
  } catch (e) {
    if (cached) return cached // stale beats nothing when offline
    throw e
  }
}

/** USD prices for a set of Scryfall ids, fetching only the ones not cached today. */
export async function usdPrices(ids: string[]): Promise<Record<string, Price | null>> {
  const cache = read<PriceCache>(PRICE_KEY)
  const fresh = cache && Date.now() - cache.fetched < DAY ? cache.prices : {}
  const missing = [...new Set(ids)].filter((id) => !(id in fresh))
  if (missing.length) {
    const { found } = await collection(missing.map((id) => ({ id })))
    const got: Record<string, Price | null> = {}
    for (const id of missing) got[id] = null
    for (const c of found) {
      const usd = num(c.prices?.usd)
      const usd_foil = num(c.prices?.usd_foil)
      got[c.id] = usd !== null || usd_foil !== null ? { usd, usd_foil } : null
    }
    Object.assign(fresh, got)
    write(PRICE_KEY, { fetched: cache && Date.now() - cache.fetched < DAY ? cache.fetched : Date.now(), prices: fresh })
  }
  return fresh
}

function num(s: string | null | undefined): number | null {
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

export function formatAud(aud: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: aud >= 100 ? 0 : 2 }).format(aud)
}
