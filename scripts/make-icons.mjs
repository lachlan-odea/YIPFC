// Renders the brand assets the app ships from the two source images in /brand:
//   brand/logo-src.png      the goblin + YIPFC lock-up (square, black background)
//   brand/wordmark-src.png  "Yes I pay for cardboard" lettering (transparent)
// Outputs go to public/ and are gitignored; `npm run build` runs this first.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const LOGO = 'brand/logo-src.png'
const WORDMARK = 'brand/wordmark-src.png'

mkdirSync('public/icons', { recursive: true })
mkdirSync('public/brand', { recursive: true })

// Background colour of the logo artwork, sampled from a corner so padded
// areas (maskable icon, splash) match it exactly.
async function cornerColour(file) {
  const { data } = await sharp(file).extract({ left: 2, top: 2, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true })
  return { r: data[0], g: data[1], b: data[2], alpha: 1 }
}

const bg = await cornerColour(LOGO)
const meta = await sharp(LOGO).metadata()
const side = Math.min(meta.width, meta.height)

/** The goblin's head, for tiny sizes where the lettering would be mush. */
const HEAD = {
  left: Math.round(side * 0.2),
  top: Math.round(side * 0.02),
  width: Math.round(side * 0.6),
  height: Math.round(side * 0.58),
}

const png = (s) => s.png({ compressionLevel: 9, palette: false })

const jobs = [
  // PWA icons ("any" purpose): the whole lock-up on its own background.
  png(sharp(LOGO).resize(192, 192)).toFile('public/icons/icon-192.png'),
  png(sharp(LOGO).resize(512, 512)).toFile('public/icons/icon-512.png'),
  png(sharp(LOGO).resize(180, 180)).toFile('public/icons/apple-touch-180.png'),
  // Maskable: launchers crop to a circle or squircle inside the central 80%,
  // so shrink the artwork into that safe zone and pad with the background.
  sharp(LOGO)
    .resize(400, 400)
    .extend({ top: 56, bottom: 56, left: 56, right: 56, background: bg })
    .png({ compressionLevel: 9 })
    .toFile('public/icons/maskable-512.png'),
  // Favicon: just the head, readable at 32px.
  png(sharp(LOGO).extract(HEAD).resize(64, 64)).toFile('public/brand/favicon.png'),
  // In-app artwork.
  png(sharp(LOGO).resize(512, 512)).toFile('public/brand/logo.png'),
  png(sharp(LOGO).extract(HEAD).resize(256, 256)).toFile('public/brand/goblin.png'),
  png(sharp(WORDMARK).resize({ width: 480 })).toFile('public/brand/wordmark-sm.png'),
]

await Promise.all(jobs)
console.log(`brand assets written to public/icons and public/brand (background #${[bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, '0')).join('')})`)
