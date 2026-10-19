// Builds the on-device art index the scanner matches camera frames against.
//
// Source: Scryfall's "unique_artwork" bulk file (one entry per distinct
// illustration). For every paper card we download the small card image, crop
// the art window, and compute a 256-bit difference hash. The client crops the
// same window out of the camera frame, hashes it the same way, and finds the
// nearest entry by Hamming distance. See src/lib/artHash.ts for the matcher;
// REGION and the hash geometry below must stay identical on both sides.
//
// Output: public/art-index.bin, entries of [scryfall id 16B][oracle id 16B][hash 32B].
// Progress is cached in .cache/art-hashes.tsv so an interrupted run resumes.
//
//   npm run art-index            build or resume
//   npm run art-index -- --limit 500   quick partial build for testing
import { createWriteStream, existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import sharp from 'sharp'

const UA = 'YIPFC/0.1 (+https://github.com/lachlan-odea/YIPFC)'
const CACHE_DIR = '.cache'
const BULK_FILE = `${CACHE_DIR}/unique_artwork.jsonl`
const HASH_FILE = `${CACHE_DIR}/art-hashes.tsv`
const OUT = 'public/art-index.bin'

// Art window as fractions of the card. Same values as ART_REGION in src/lib/artHash.ts.
const REGION = { x: 0.08, y: 0.1, w: 0.84, h: 0.46 }
const HW = 17 // hash grid: 17 columns -> 16 horizontal gradients
const HH = 16 // 16 rows -> 256 bits
const CONCURRENCY = 8

const args = process.argv.slice(2)
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity

mkdirSync(CACHE_DIR, { recursive: true })

// ---- 1. bulk data ---------------------------------------------------------

async function fetchBulk() {
  if (existsSync(BULK_FILE)) {
    console.log('using cached', BULK_FILE)
    return
  }
  const meta = await (await fetch('https://api.scryfall.com/bulk-data/unique_artwork', { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json()
  const url = meta.jsonl_download_uri ?? meta.download_uri
  console.log('downloading', url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`bulk download failed: ${res.status}`)
  const body = Readable.fromWeb(res.body)
  const gz = url.endsWith('.gz') || res.headers.get('content-encoding') === 'gzip'
  if (url.endsWith('.json')) {
    // Older style: one big JSON array. Convert to JSONL.
    let text = ''
    for await (const chunk of body) text += chunk
    writeFileSync(BULK_FILE, JSON.parse(text).map((c) => JSON.stringify(c)).join('\n'))
    return
  }
  await pipeline(body, ...(gz && !res.headers.get('content-encoding') ? [createGunzip()] : []), createWriteStream(BULK_FILE))
}

const SKIP_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard', 'augment', 'host', 'reversible_card'])
const SKIP_SET_TYPES = new Set(['memorabilia', 'minigame', 'token', 'alchemy'])

function wanted(c) {
  if (!c.games?.includes('paper')) return false
  if (c.digital) return false
  if (c.lang !== 'en') return false
  if (SKIP_LAYOUTS.has(c.layout)) return false
  if (SKIP_SET_TYPES.has(c.set_type)) return false
  if (c.oversized) return false
  return !!imageOf(c)
}

function imageOf(c) {
  return c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? null
}

async function* cards() {
  const rl = readline.createInterface({ input: createReadStream(BULK_FILE), crlfDelay: Infinity })
  for await (const line of rl) {
    const t = line.trim().replace(/,$/, '')
    if (!t || t === '[' || t === ']') continue
    let c
    try {
      c = JSON.parse(t)
    } catch {
      continue
    }
    if (c.object === 'card' && wanted(c)) yield c
  }
}

// ---- 2. hashing -----------------------------------------------------------

/** 256-bit horizontal difference hash of a 17x16 grey grid, as a 32-byte Buffer. */
export function dhash(grey) {
  const out = Buffer.alloc((HW - 1) * HH / 8)
  let bit = 0
  for (let y = 0; y < HH; y++) {
    for (let x = 0; x < HW - 1; x++) {
      if (grey[y * HW + x] > grey[y * HW + x + 1]) out[bit >> 3] |= 0x80 >> (bit & 7)
      bit++
    }
  }
  return out
}

export async function hashImage(buf) {
  const img = sharp(buf)
  const { width, height } = await img.metadata()
  const grey = await img
    .extract({
      left: Math.round(width * REGION.x),
      top: Math.round(height * REGION.y),
      width: Math.round(width * REGION.w),
      height: Math.round(height * REGION.h),
    })
    .grayscale()
    .resize(HW, HH, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer()
  return dhash(grey)
}

async function download(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
}

// ---- 3. main --------------------------------------------------------------

function loadDone() {
  const done = new Map()
  if (!existsSync(HASH_FILE)) return done
  for (const line of readFileSync(HASH_FILE, 'utf8').split('\n')) {
    const [id, oracle, hex] = line.split('\t')
    if (id && hex && hex.length === 64) done.set(id, { oracle, hex })
  }
  return done
}

function uuidBytes(u) {
  return Buffer.from(u.replace(/-/g, ''), 'hex')
}

async function main() {
  await fetchBulk()
  const done = loadDone()
  console.log(`${done.size} hashes already cached`)

  const queue = []
  let total = 0
  for await (const c of cards()) {
    total++
    if (total > limit) break
    if (!done.has(c.id)) queue.push({ id: c.id, oracle: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? c.id, url: imageOf(c) })
  }
  console.log(`${total} eligible artworks, ${queue.length} to hash`)

  let i = 0
  let failed = 0
  const started = Date.now()
  async function worker() {
    while (queue.length) {
      const job = queue.shift()
      try {
        const hash = await hashImage(await download(job.url))
        appendFileSync(HASH_FILE, `${job.id}\t${job.oracle}\t${hash.toString('hex')}\n`)
        done.set(job.id, { oracle: job.oracle, hex: hash.toString('hex') })
      } catch (e) {
        failed++
        if (failed < 20) console.warn('failed', job.url, e.message)
      }
      i++
      if (i % 500 === 0) {
        const rate = i / ((Date.now() - started) / 1000)
        console.log(`${i} hashed, ${queue.length} left, ${rate.toFixed(1)}/s, ~${Math.round(queue.length / rate / 60)} min remaining`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`hashing done, ${failed} failed`)

  // Write the binary index from everything cached, restricted to eligible ids.
  const entries = []
  let n = 0
  for await (const c of cards()) {
    n++
    if (n > limit) break
    const d = done.get(c.id)
    if (d) entries.push({ id: c.id, oracle: d.oracle, hex: d.hex })
  }
  const header = Buffer.alloc(16)
  header.write('YIPFCART', 0, 'ascii')
  header.writeUInt32LE(1, 8)
  header.writeUInt32LE(entries.length, 12)
  const body = Buffer.alloc(entries.length * 64)
  entries.forEach((e, k) => {
    uuidBytes(e.id).copy(body, k * 64)
    uuidBytes(e.oracle).copy(body, k * 64 + 16)
    Buffer.from(e.hex, 'hex').copy(body, k * 64 + 32)
  })
  writeFileSync(OUT, Buffer.concat([header, body]))
  console.log(`wrote ${OUT}: ${entries.length} entries, ${((16 + body.length) / 1e6).toFixed(2)} MB`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('build-art-index.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
