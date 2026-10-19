import type { Frame } from './ocr'

/**
 * On-device card recognition by picture. A 256-bit difference hash of the art
 * window is compared against an index of every distinct Scryfall artwork
 * (public/art-index.bin, built by scripts/build-art-index.mjs). Matching is a
 * linear Hamming scan: ~45k entries × 8 words is a few milliseconds, so it can
 * run on every camera frame while the slower OCR pass catches up.
 *
 * REGION, HW and HH must match the build script exactly.
 */

/** Art window as fractions of the card. */
export const ART_REGION = { x: 0.08, y: 0.1, w: 0.84, h: 0.46 }
const HW = 17
const HH = 16
const HASH_WORDS = 8 // 256 bits
const ENTRY = 64 // id 16 + oracle 16 + hash 32

export type ArtMatch = {
  /** Scryfall id of the nearest artwork. */
  id: string
  oracleId: string
  /** Hamming distance to it, 0..256. */
  distance: number
  /** Distance to the nearest artwork of a *different* card. */
  runnerUp: number
}

let indexPromise: Promise<ArtIndex | null> | null = null

export class ArtIndex {
  readonly count: number
  private ids: Uint8Array
  private hashes: Uint32Array

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf)
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 8))
    if (magic !== 'YIPFCART') throw new Error('Not an art index')
    this.count = dv.getUint32(12, true)
    const body = new Uint8Array(buf, 16, this.count * ENTRY)
    this.ids = body
    // Pull the hashes out into a contiguous word array for the hot loop.
    this.hashes = new Uint32Array(this.count * HASH_WORDS)
    const tmp = new Uint8Array(32)
    for (let i = 0; i < this.count; i++) {
      tmp.set(body.subarray(i * ENTRY + 32, i * ENTRY + 64))
      const words = new Uint32Array(tmp.buffer)
      this.hashes.set(words, i * HASH_WORDS)
    }
  }

  private uuidAt(offset: number): string {
    let h = ''
    for (let i = 0; i < 16; i++) h += this.ids[offset + i].toString(16).padStart(2, '0')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }

  private oracleEq(a: number, b: number): boolean {
    for (let i = 0; i < 16; i++) if (this.ids[a * ENTRY + 16 + i] !== this.ids[b * ENTRY + 16 + i]) return false
    return true
  }

  /** Nearest entry to a 256-bit hash (as 8 words). */
  match(q: Uint32Array): ArtMatch | null {
    if (!this.count) return null
    const h = this.hashes
    let best = -1
    let bestD = 257
    let second = -1
    let secondD = 257
    for (let i = 0, o = 0; i < this.count; i++, o += HASH_WORDS) {
      let d = 0
      for (let w = 0; w < HASH_WORDS; w++) d += popcount(h[o + w] ^ q[w])
      if (d < bestD) {
        second = best
        secondD = bestD
        best = i
        bestD = d
      } else if (d < secondD) {
        second = i
        secondD = d
      }
    }
    // The runner-up must be a different card; another art of the same card is not a rival.
    let runnerUp = secondD
    if (second >= 0 && this.oracleEq(best, second)) {
      runnerUp = 257
      for (let i = 0, o = 0; i < this.count; i++, o += HASH_WORDS) {
        if (this.oracleEq(best, i)) continue
        let d = 0
        for (let w = 0; w < HASH_WORDS; w++) d += popcount(h[o + w] ^ q[w])
        if (d < runnerUp) runnerUp = d
      }
    }
    return { id: this.uuidAt(best * ENTRY), oracleId: this.uuidAt(best * ENTRY + 16), distance: bestD, runnerUp }
  }
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** Fetch and parse the index once. Resolves null when it is not deployed, so the scanner falls back to OCR only. */
export function loadArtIndex(): Promise<ArtIndex | null> {
  indexPromise ??= fetch(`${import.meta.env.BASE_URL}art-index.bin`)
    .then(async (r) => {
      if (!r.ok) return null
      const buf = await r.arrayBuffer()
      return buf.byteLength > 16 ? new ArtIndex(buf) : null
    })
    .catch(() => null)
  return indexPromise
}

// ---- hashing a camera frame ------------------------------------------------

const SCRATCH_W = HW * 8
const SCRATCH_H = HH * 8
let scratch: HTMLCanvasElement | null = null

/**
 * Hash the art window of the card sitting in `frame` within `source`.
 * `dx`/`dy` nudge the window by a fraction of the card, `scale` grows or
 * shrinks it, so a few jittered hashes can cover slight misalignment.
 */
export function hashFrame(source: CanvasImageSource, srcW: number, srcH: number, frame: Frame, dx = 0, dy = 0, scale = 1): Uint32Array {
  scratch ??= document.createElement('canvas')
  scratch.width = SCRATCH_W
  scratch.height = SCRATCH_H
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const cardX = frame.x * srcW
  const cardY = frame.y * srcH
  const cardW = frame.w * srcW
  const cardH = frame.h * srcH
  const rw = ART_REGION.w * scale
  const rh = ART_REGION.h * scale
  const rx = ART_REGION.x + (ART_REGION.w - rw) / 2 + dx
  const ry = ART_REGION.y + (ART_REGION.h - rh) / 2 + dy
  ctx.drawImage(source, cardX + rx * cardW, cardY + ry * cardH, rw * cardW, rh * cardH, 0, 0, SCRATCH_W, SCRATCH_H)

  // Box-filter down to the hash grid in grey; drawing straight to 17x16 would alias badly.
  const { data } = ctx.getImageData(0, 0, SCRATCH_W, SCRATCH_H)
  const grey = new Float32Array(HW * HH)
  for (let y = 0; y < SCRATCH_H; y++) {
    const gy = (y >> 3) * HW
    for (let x = 0; x < SCRATCH_W; x++) {
      const i = (y * SCRATCH_W + x) * 4
      grey[gy + (x >> 3)] += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    }
  }
  const out = new Uint32Array(HASH_WORDS)
  const bytes = new Uint8Array(out.buffer)
  let bit = 0
  for (let y = 0; y < HH; y++) {
    for (let x = 0; x < HW - 1; x++) {
      if (grey[y * HW + x] > grey[y * HW + x + 1]) bytes[bit >> 3] |= 0x80 >> (bit & 7)
      bit++
    }
  }
  return out
}

/** Hash a few nudged windows and keep the best match across them. */
export function bestArtMatch(index: ArtIndex, source: CanvasImageSource, srcW: number, srcH: number, frame: Frame): ArtMatch | null {
  const variants: Array<[number, number, number]> = [
    [0, 0, 1],
    [0.02, 0, 1],
    [-0.02, 0, 1],
    [0, 0.02, 1],
    [0, -0.02, 1],
    [0, 0, 1.05],
    [0, 0, 0.95],
  ]
  let best: ArtMatch | null = null
  for (const [dx, dy, s] of variants) {
    const m = index.match(hashFrame(source, srcW, srcH, frame, dx, dy, s))
    if (m && (!best || m.distance < best.distance)) best = m
  }
  return best
}
