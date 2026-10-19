import { createWorker, type Worker } from 'tesseract.js'

/**
 * Reads a card's title from a photo. The scanner UI asks the user to line the
 * card up inside a frame, so we only OCR the title band (the top ~9% of the
 * card) which is far more reliable than reading the whole card.
 *
 * The worker and the English language data (~4 MB) download on first use and
 * are cached by the service worker after that.
 */

let workerPromise: Promise<Worker> | null = null

export function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { logger: () => {} }).then(async (w) => {
      await w.setParameters({
        // Card names: letters, spaces and a little punctuation. No digits.
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,.",
      })
      return w
    })
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

export function warmUp() {
  void getWorker().catch(() => {})
}

/** Card frame in viewfinder coordinates, as fractions of the video size. */
export type Frame = { x: number; y: number; w: number; h: number }

/**
 * Crops the title band out of the card frame, upsamples it and boosts contrast
 * so Tesseract has clean black-on-white text to work with.
 */
export function cropTitleBand(source: CanvasImageSource, srcW: number, srcH: number, frame: Frame): HTMLCanvasElement {
  const cardX = frame.x * srcW
  const cardY = frame.y * srcH
  const cardW = frame.w * srcW
  const cardH = frame.h * srcH

  // Title band on a standard frame: roughly 4%–10.5% down, inset 6% each side.
  const bandX = cardX + cardW * 0.06
  const bandY = cardY + cardH * 0.038
  const bandW = cardW * 0.88
  const bandH = cardH * 0.072

  const scale = Math.max(1, 1400 / bandW)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bandW * scale)
  canvas.height = Math.round(bandH * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, bandX, bandY, bandW, bandH, 0, 0, canvas.width, canvas.height)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  // Greyscale, then stretch contrast around the median so dark text pops on any frame colour.
  const greys = new Uint8ClampedArray(d.length / 4)
  for (let i = 0, j = 0; i < d.length; i += 4, j++) greys[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
  const sorted = Array.from(greys).sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.05)]
  const hi = sorted[Math.floor(sorted.length * 0.95)]
  const range = Math.max(1, hi - lo)
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.min(255, Math.max(0, ((greys[j] - lo) / range) * 255))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export async function readTitle(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(canvas)
  return cleanTitle(data.text)
}

/** Turns raw OCR output into something Scryfall's fuzzy search can use. */
export function cleanTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]
  if (!firstLine) return ''
  return firstLine
    .replace(/[^A-Za-z' ,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'.,-]+|[\s'.,-]+$/g, '')
    .trim()
}
