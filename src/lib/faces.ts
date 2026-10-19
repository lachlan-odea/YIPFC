import { collection, type ScryfallCard } from './scryfall'
import type { PoolCard } from './types'

/**
 * Double-faced support for rows added before the back face was stored.
 * Rows without a `layout` are looked up on Scryfall once per session, in
 * batches, and patched with their layout and back image. Every device may
 * race to do this after a deploy; the writes are idempotent so it is harmless.
 */

export function backImage(card: ScryfallCard): string {
  return card.card_faces?.[1]?.image_uris?.normal ?? ''
}

/** Layouts where the physical card has a different back face. */
export const DFC_LAYOUTS = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card'])

export function isDoubleFaced(card: Pick<PoolCard, 'image_back'>): boolean {
  return !!card.image_back
}

let ran = false

export async function backfillFaces(cards: PoolCard[], update: (id: string, patch: { layout: string; image_back: string }) => Promise<void>) {
  if (ran) return
  const todo = cards.filter((c) => c.layout === undefined)
  if (!todo.length) return
  ran = true
  const ids = [...new Set(todo.map((c) => c.scryfall_id))]
  const { found } = await collection(ids.map((id) => ({ id })))
  const byId = new Map(found.map((f) => [f.id, f]))
  for (const c of todo) {
    const f = byId.get(c.scryfall_id)
    const layout = (f as (ScryfallCard & { layout?: string }) | undefined)?.layout ?? 'normal'
    try {
      await update(c.id, { layout, image_back: f ? backImage(f) : '' })
    } catch {
      /* next load will try again */
    }
  }
}
