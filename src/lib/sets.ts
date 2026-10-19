import { useEffect, useState } from 'react'
import { setInfo } from './scryfall'

/**
 * Set sizes for completion tracking. Scryfall's set object gives card_count
 * (every printing including variants) and printed_size (the number on the
 * cards, when the set has one). Cached in localStorage for a week.
 */

const KEY = 'yipfc/sets/v1'
const WEEK = 7 * 24 * 60 * 60 * 1000

export type SetSize = { code: string; name: string; size: number; icon: string }
type Cache = Record<string, SetSize & { fetched: number }>

function read(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache
  } catch {
    return {}
  }
}

export async function setSizes(codes: string[]): Promise<Record<string, SetSize>> {
  const cache = read()
  const out: Record<string, SetSize> = {}
  const missing: string[] = []
  for (const code of new Set(codes)) {
    const c = cache[code]
    if (c && Date.now() - c.fetched < WEEK) out[code] = c
    else missing.push(code)
  }
  for (const code of missing) {
    try {
      const s = await setInfo(code)
      const entry = { code, name: s.name, size: s.printed_size ?? s.card_count, icon: s.icon_svg_uri, fetched: Date.now() }
      cache[code] = entry
      out[code] = entry
    } catch {
      /* unknown set code; leave it out */
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* fine */
  }
  return out
}

/** Sizes for the given set codes, refetching as the list changes. */
export function useSetSizes(codes: string[]): Record<string, SetSize> {
  const key = [...new Set(codes)].sort().join(',')
  const [sizes, setSizes_] = useState<Record<string, SetSize>>({})
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void setSizes(key.split(',')).then((s) => !cancelled && setSizes_(s))
    return () => {
      cancelled = true
    }
  }, [key])
  return sizes
}
