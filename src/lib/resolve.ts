import type { ParsedLine } from './parseList'
import { collection, namedFuzzy, type CardIdentifier, type ScryfallCard } from './scryfall'

/**
 * Resolves parsed list lines against Scryfall in as few requests as possible:
 *  1. one batched collection call with the most specific identifier per line,
 *  2. a second batch by name only for lines whose set/number did not match,
 *  3. fuzzy lookups one at a time for whatever is still missing (typos).
 * Returns one entry per input line, null where nothing matched.
 */
export async function resolveLines(lines: ParsedLine[]): Promise<Array<ScryfallCard | null>> {
  const out: Array<ScryfallCard | null> = lines.map(() => null)

  const ident = (l: ParsedLine, strict: boolean): CardIdentifier => {
    if (strict && l.set && l.collector_number) return { set: l.set, collector_number: l.collector_number }
    if (strict && l.set) return { name: l.name, set: l.set }
    return { name: l.name }
  }

  async function pass(indexes: number[], strict: boolean) {
    if (!indexes.length) return [] as number[]
    const ids = indexes.map((i) => ident(lines[i], strict))
    const { found } = await collection(ids)
    const stillMissing: number[] = []
    for (let k = 0; k < indexes.length; k++) {
      const i = indexes[k]
      const id = ids[k]
      const match = found.find((c) => {
        if ('collector_number' in id) return c.set === id.set && c.collector_number.toLowerCase() === id.collector_number.toLowerCase()
        if ('name' in id) return sameName(c, id.name) && (!id.set || c.set === id.set)
        return c.id === id.id
      })
      if (match) out[i] = match
      else stillMissing.push(i)
    }
    return stillMissing
  }

  let missing = await pass(lines.map((_, i) => i), true)
  missing = await pass(missing.filter((i) => lines[i].set), false).then((m) => [...m, ...missing.filter((i) => !lines[i].set)])
  for (const i of missing) {
    try {
      out[i] = await namedFuzzy(lines[i].name)
    } catch {
      out[i] = null
    }
  }
  return out
}

export function sameName(card: ScryfallCard, name: string) {
  const n = name.toLowerCase()
  if (card.name.toLowerCase() === n) return true
  // Front-face name of a double-faced card.
  return card.card_faces?.some((f) => f.name.toLowerCase() === n) ?? false
}
