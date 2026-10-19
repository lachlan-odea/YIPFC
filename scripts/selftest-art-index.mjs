// Checks the art index against images it has never seen: the `normal` size
// of a sample of cards (different resolution from the `small` images the
// index was built from), roughed up the way a phone camera would: slight
// blur, brightness shift, and a nudged crop. Reports top-1 accuracy and the
// distance distributions so the thresholds in src/lib/artHash.ts can be set.
//
//   node scripts/selftest-art-index.mjs [sampleSize]
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { dhash } from './build-art-index.mjs'

const UA = 'YIPFC/0.1 (+https://github.com/lachlan-odea/YIPFC)'
const REGION = { x: 0.08, y: 0.1, w: 0.84, h: 0.46 }
const HW = 17
const HH = 16
const N = parseInt(process.argv[2] ?? '200', 10)

const buf = readFileSync('public/art-index.bin')
const count = buf.readUInt32LE(12)
const ids = []
const oracles = []
const hashes = []
for (let i = 0; i < count; i++) {
  const o = 16 + i * 64
  ids.push(uuid(buf.subarray(o, o + 16)))
  oracles.push(uuid(buf.subarray(o + 16, o + 32)))
  hashes.push(buf.subarray(o + 32, o + 64))
}
console.log(`${count} entries`)

function uuid(b) {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const POP = new Uint8Array(256).map((_, i) => i.toString(2).split('1').length - 1)
function dist(a, b) {
  let d = 0
  for (let i = 0; i < 32; i++) d += POP[a[i] ^ b[i]]
  return d
}
function nearest(q) {
  let best = -1, bd = 999, runner = 999
  for (let i = 0; i < count; i++) {
    const d = dist(q, hashes[i])
    if (d < bd) { best = i; bd = d }
  }
  for (let i = 0; i < count; i++) if (oracles[i] !== oracles[best]) runner = Math.min(runner, dist(q, hashes[i]))
  return { best, bd, runner }
}

// Deterministic sample spread across the index.
const step = Math.max(1, Math.floor(count / N))
const sample = Array.from({ length: Math.min(N, count) }, (_, k) => k * step)

let hit = 0, tested = 0
const trueD = [], runnerD = []
for (const i of sample) {
  const card = await (await fetch(`https://api.scryfall.com/cards/${ids[i]}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json()
  const url = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal
  if (!url) continue
  await new Promise((r) => setTimeout(r, 110))
  const img = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer())
  const { width, height } = await sharp(img).metadata()
  // Camera-like damage: 1.5% crop nudge, blur, +10% brightness, JPEG recompress at low quality.
  const nudgeX = Math.round(width * 0.015), nudgeY = Math.round(height * 0.012)
  const grey = await sharp(img)
    .extract({
      left: Math.round(width * REGION.x) + nudgeX,
      top: Math.round(height * REGION.y) + nudgeY,
      width: Math.round(width * REGION.w),
      height: Math.round(height * REGION.h),
    })
    .blur(1.2)
    .modulate({ brightness: 1.1 })
    .jpeg({ quality: 40 })
    .toBuffer()
    .then((b) => sharp(b).grayscale().resize(HW, HH, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer())
  const q = dhash(grey)
  const { best, bd, runner } = nearest(q)
  tested++
  const ok = oracles[best] === oracles[i]
  if (ok) hit++
  trueD.push(dist(q, hashes[i]))
  runnerD.push(runner)
  if (!ok) console.log(`miss: ${card.name} -> ${ids[best]} (d=${bd}, true d=${dist(q, hashes[i])})`)
}
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)]
console.log(`top-1 accuracy: ${hit}/${tested} (${((100 * hit) / tested).toFixed(1)}%)`)
console.log(`distance to true art:   p50 ${pct(trueD, 0.5)}  p90 ${pct(trueD, 0.9)}  p99 ${pct(trueD, 0.99)}  max ${Math.max(...trueD)}`)
console.log(`distance to best rival: p1 ${pct(runnerD, 0.01)}  p10 ${pct(runnerD, 0.1)}  p50 ${pct(runnerD, 0.5)}  min ${Math.min(...runnerD)}`)
