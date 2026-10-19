// Renders the PWA icons as PNG without an image library: the three stacked
// cards from icon.svg are rasterised straight into pixel buffers (2x
// supersampled) and zlib-compressed into PNG chunks. Run via `npm run icons`.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const BG = hex('#15231d')
const GOLD = hex('#d4a84b')
const IVORY = hex('#efe9dc')
const ART = hex('#2e5a48')
const C1 = hex('#1f3a2e')
const C2 = hex('#24433a')

function crc32(buf) {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, rgba) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Signed distance to a rotated rounded rectangle (negative = inside).
function sdRoundRect(px, py, cx, cy, w, h, r, rotDeg) {
  const rot = (-rotDeg * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const dx = px - cx
  const dy = py - cy
  const x = dx * cos - dy * sin
  const y = dx * sin + dy * cos
  const qx = Math.abs(x) - (w / 2 - r)
  const qy = Math.abs(y) - (h / 2 - r)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

function render(size, { maskable }) {
  const out = Buffer.alloc(size * size * 4)
  const scale = 512 / size
  const k = maskable ? 0.78 : 1
  const cardW = 176 * k
  const cardH = 248 * k
  const rr = 14 * k
  const cx = 256
  const cy = maskable ? 262 : 268
  const cards = [
    { ox: -48 * k, oy: 0, rot: -14, fill: C1, stroke: GOLD },
    { ox: 44 * k, oy: -8 * k, rot: 10, fill: C2, stroke: IVORY },
    { ox: 0, oy: 20 * k, rot: 0, fill: IVORY, stroke: null },
  ]
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0]
      for (let s = 0; s < 4; s++) {
        const x = (px + ((s & 1) + 0.5) / 2) * scale
        const y = (py + ((s >> 1) + 0.5) / 2) * scale
        let col = BG
        let alpha = 255
        if (!maskable && sdRoundRect(x, y, 256, 256, 512, 512, 96, 0) > 0) alpha = 0
        for (const c of cards) {
          const ccx = cx + c.ox
          const ccy = cy + c.oy
          const d = sdRoundRect(x, y, ccx, ccy, cardW, cardH, rr, c.rot)
          if (d > 0) continue
          col = c.fill
          if (c.stroke && d > -10 * k) col = c.stroke
          if (!c.stroke) {
            if (sdRoundRect(x, y, ccx, ccy - 24 * k, 132 * k, 104 * k, 6 * k, 0) <= 0) col = ART
            if (Math.hypot(x - ccx, y - (ccy + 66 * k)) <= 26 * k) col = GOLD
          }
        }
        acc[0] += col[0] * (alpha / 255)
        acc[1] += col[1] * (alpha / 255)
        acc[2] += col[2] * (alpha / 255)
        acc[3] += alpha
      }
      const i = (py * size + px) * 4
      const a = acc[3] / 4
      // Un-premultiply so edge pixels keep the right hue.
      const f = a > 0 ? 255 / acc[3] : 0
      out[i] = Math.round(acc[0] * f)
      out[i + 1] = Math.round(acc[1] * f)
      out[i + 2] = Math.round(acc[2] * f)
      out[i + 3] = Math.round(a)
    }
  }
  return png(size, out)
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', render(192, { maskable: false }))
writeFileSync('public/icons/icon-512.png', render(512, { maskable: false }))
writeFileSync('public/icons/maskable-512.png', render(512, { maskable: true }))
console.log('icons written to public/icons')
