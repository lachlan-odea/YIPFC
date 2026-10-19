import { createWorker, PSM, type Worker } from 'tesseract.js'
import { cleanTitle, parseFooter, type FooterRead } from './cardText'

export { cleanTitle, parseFooter, type FooterRead }

/**
 * Reads text off a card held up to the camera. The scanner frames the card,
 * so we only OCR two small regions: the title band (name) and the bottom-left
 * footer (collector number and set code, which pin down the exact printing).
 *
 * Two workers, because each has its own character whitelist and page mode and
 * swapping parameters on a shared worker would race with the live loop. The
 * English language data (~4 MB) downloads once and is cached by the service
 * worker after that.
 */

let titleWorker: Promise<Worker> | null = null
let footerWorker: Promise<Worker> | null = null

function spawn(params: Partial<Record<string, string>>): Promise<Worker> {
  const p = createWorker('eng', 1, { logger: () => {} }).then(async (w) => {
    await w.setParameters(params)
    return w
  })
  return p
}

function getTitleWorker(): Promise<Worker> {
  if (!titleWorker) {
    titleWorker = spawn({
      // Card names: letters, spaces and a little punctuation. No digits.
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,.",
      // The crop is always one line of text; saying so is faster and more reliable.
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    })
    titleWorker.catch(() => {
      titleWorker = null
    })
  }
  return titleWorker
}

function getFooterWorker(): Promise<Worker> {
  if (!footerWorker) {
    footerWorker = spawn({
      // "0042/0281 U" over "DMU · EN": digits, capitals, slash and separators.
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ·•*-',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    })
    footerWorker.catch(() => {
      footerWorker = null
    })
  }
  return footerWorker
}

export function warmUp() {
  void getTitleWorker().catch(() => {})
  void getFooterWorker().catch(() => {})
}

/** Card frame in viewfinder coordinates, as fractions of the video size. */
export type Frame = { x: number; y: number; w: number; h: number }

type Region = { x: number; y: number; w: number; h: number } // fractions of the card

// Title band on a standard frame: roughly 4%–11% down, inset 6% each side.
const TITLE: Region = { x: 0.06, y: 0.038, w: 0.88, h: 0.072 }
// Footer, bottom-left: collector number line and set/language line.
const FOOTER: Region = { x: 0.035, y: 0.918, w: 0.5, h: 0.066 }

/**
 * Crops a region of the card, upsamples it and stretches the contrast so
 * Tesseract gets clean black-on-white text. Light-on-dark footers are
 * inverted so both regions end up the same way round.
 */
function cropRegion(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  frame: Frame,
  region: Region,
  targetW: number,
  invertIfDark: boolean,
): HTMLCanvasElement {
  const cardX = frame.x * srcW
  const cardY = frame.y * srcH
  const cardW = frame.w * srcW
  const cardH = frame.h * srcH

  const bandX = cardX + cardW * region.x
  const bandY = cardY + cardH * region.y
  const bandW = cardW * region.w
  const bandH = cardH * region.h

  const scale = Math.max(1, targetW / bandW)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bandW * scale)
  canvas.height = Math.round(bandH * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, bandX, bandY, bandW, bandH, 0, 0, canvas.width, canvas.height)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  // Greyscale, then stretch between the 5th and 95th percentiles so dark text
  // pops on any frame colour. A histogram keeps this cheap enough for every frame.
  const greys = new Uint8ClampedArray(d.length / 4)
  const hist = new Uint32Array(256)
  let sum = 0
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    greys[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    hist[greys[j]]++
    sum += greys[j]
  }
  const percentile = (p: number) => {
    let n = 0
    const target = greys.length * p
    for (let v = 0; v < 256; v++) {
      n += hist[v]
      if (n >= target) return v
    }
    return 255
  }
  const lo = percentile(0.05)
  const hi = percentile(0.95)
  const range = Math.max(1, hi - lo)
  const invert = invertIfDark && sum / greys.length < 128
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = Math.min(255, Math.max(0, ((greys[j] - lo) / range) * 255))
    if (invert) v = 255 - v
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function cropTitleBand(source: CanvasImageSource, srcW: number, srcH: number, frame: Frame) {
  return cropRegion(source, srcW, srcH, frame, TITLE, 1400, false)
}

export function cropFooterBand(source: CanvasImageSource, srcW: number, srcH: number, frame: Frame) {
  return cropRegion(source, srcW, srcH, frame, FOOTER, 1200, true)
}

export type TitleRead = { text: string; confidence: number }

export async function readTitle(canvas: HTMLCanvasElement): Promise<TitleRead> {
  const worker = await getTitleWorker()
  const { data } = await worker.recognize(canvas)
  return { text: cleanTitle(data.text), confidence: data.confidence }
}

/**
 * Reads the footer and pulls out the set code and collector number, e.g.
 * "0042/0281 U / DMU · EN" gives { set: 'dmu', number: '42' }. Returns null
 * when either is missing, which is normal for older frames and promos.
 */
export async function readFooter(canvas: HTMLCanvasElement): Promise<FooterRead | null> {
  const worker = await getFooterWorker()
  const { data } = await worker.recognize(canvas)
  return parseFooter(data.text)
}
