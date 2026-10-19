import { useCallback, useEffect, useRef, useState } from 'react'
import { usePool } from '../lib/store'
import { bySetNumber, namedFuzzy, toPoolCard, type ScryfallCard } from '../lib/scryfall'
import { cropFooterBand, cropTitleBand, readFooter, readTitle, warmUp, type Frame } from '../lib/ocr'
import { scanFeedback, unlockAudio } from '../lib/feedback'
import { errorText } from './ui'
import ScanTray, { thumb, type ScanItem } from './ScanTray'

// Card frame inside the 3:4 viewfinder, as fractions. Mirrors .viewfinder .frame CSS.
const FRAME_W = 0.72
const FRAME: Frame = (() => {
  const w = FRAME_W
  const h = (w * 88) / 63 / (4 / 3) // card height as a fraction of the 3:4 viewfinder height
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
})()

/** Accept a single read outright when Tesseract is this sure of it; otherwise wait for two that agree. */
const CONFIDENT = 80
/** Minimum gap between two recognitions of anything. */
const LOCK_GAP_MS = 1200
/** The same card counts again only after this long AND after the frame has shown something else. */
const SAME_CARD_MS = 1500
/** How long the "got it" bubble stays up. */
const FLASH_MS = 1800

type Readout = { kind: 'idle' | 'reading' | 'checking'; text: string }
type Flash = { id: number; card: ScryfallCard; count: number }

/**
 * Live scanner. Hold cards up one after another: each one is recognised from
 * its title, pinned to an exact printing from the footer when that can be
 * read, added to the pool straight away, and listed underneath where the
 * printing or quantity can be fixed. The camera never stops.
 */
export default function Scanner({ onDone }: { onDone?: () => void }) {
  const pool = usePool()
  const poolRef = useRef(pool)
  poolRef.current = pool

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const [camError, setCamError] = useState<string | null>(null)
  const [readout, setReadout] = useState<Readout>({ kind: 'idle', text: '' })
  const [flash, setFlash] = useState<Flash | null>(null)
  const [items, setItems] = useState<ScanItem[]>([])
  const [paused, setPaused] = useState(false)

  // ---- camera ------------------------------------------------------------

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    stop()
    setCamera('starting')
    setCamError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('off')
      setCamError('This browser cannot open the camera here. Use the photo button instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamera('on')
    } catch (e) {
      setCamera('off')
      setCamError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser settings, or take a photo instead.'
          : errorText(e),
      )
    }
  }, [stop])

  useEffect(() => {
    warmUp()
    void start()
    document.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => {
      stop()
      document.removeEventListener('pointerdown', unlockAudio)
    }
  }, [start, stop])

  // Pause the loop while the page is hidden; the camera keeps its permission.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /** Grab the visible 3:4 region of the video as a canvas (object-fit: cover equivalent). */
  function captureStill(): HTMLCanvasElement | null {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const vw = v.videoWidth
    const vh = v.videoHeight
    let cw = vw
    let ch = vh
    if (vw / vh > 3 / 4) cw = Math.round((vh * 3) / 4)
    else ch = Math.round((vw * 4) / 3)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    canvas.getContext('2d')!.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch)
    return canvas
  }

  // ---- pool bookkeeping --------------------------------------------------

  const patch = (key: string, p: Partial<ScanItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  /** Add `n` copies of a printing to the pool and reflect it in the tray. */
  async function addToPool(card: ScryfallCard, n: number) {
    try {
      const [row] = await poolRef.current.addCards([toPoolCard(card, n)])
      patch(card.id, { status: 'added', poolId: row?.id, poolQty: row?.quantity, error: undefined })
    } catch (e) {
      patch(card.id, { status: 'error', error: errorText(e) })
    }
  }

  /** A recognised card: bump the tray row (or make one) and add a copy to the pool. */
  function recognised(card: ScryfallCard) {
    let count = 1
    setItems((list) => {
      const existing = list.find((i) => i.key === card.id)
      if (existing) {
        count = existing.scanned + 1
        const row: ScanItem = { ...existing, scanned: count, status: 'adding' }
        return [row, ...list.filter((i) => i.key !== card.id)]
      }
      return [{ key: card.id, card, scanned: 1, status: 'adding' }, ...list]
    })
    const id = Date.now()
    setFlash({ id, card, count })
    setTimeout(() => setFlash((f) => (f?.id === id ? null : f)), FLASH_MS)
    scanFeedback(count > 1 ? 'again' : 'added')
    void addToPool(card, 1)
  }

  async function setQty(item: ScanItem, qty: number) {
    if (!item.poolId) return
    if (qty <= 0) return remove(item)
    try {
      await poolRef.current.updateCard(item.poolId, { quantity: qty })
      patch(item.key, { poolQty: qty })
    } catch (e) {
      patch(item.key, { status: 'error', error: errorText(e) })
    }
  }

  /** Take this session's copies back out; keep any the owner had before. */
  async function remove(item: ScanItem) {
    setItems((list) => list.filter((i) => i.key !== item.key))
    if (!item.poolId || item.poolQty === undefined) return
    const left = item.poolQty - item.scanned
    try {
      if (left > 0) await poolRef.current.updateCard(item.poolId, { quantity: left })
      else await poolRef.current.removeCard(item.poolId)
    } catch {
      /* the tray row is gone; the pool screen shows the truth */
    }
  }

  async function changePrinting(item: ScanItem, card: ScryfallCard) {
    await remove(item)
    setItems((list) => [{ key: card.id, card, scanned: item.scanned, status: 'adding' }, ...list.filter((i) => i.key !== card.id)])
    await addToPool(card, item.scanned)
  }

  // ---- the live loop -------------------------------------------------------

  const live = camera === 'on' && !paused
  useEffect(() => {
    if (!live) return
    let cancelled = false
    let lastKey = ''
    let lastLockAt = 0
    let lastLockName = ''
    let lastLockKey = ''
    let seenOtherSinceLock = true
    const failed = new Set<string>()
    setReadout({ kind: 'idle', text: '' })

    const loop = async () => {
      while (!cancelled) {
        const still = captureStill()
        if (!still) {
          await sleep(150)
          continue
        }
        let text: string
        let confidence: number
        try {
          ;({ text, confidence } = await readTitle(cropTitleBand(still, still.width, still.height, FRAME)))
        } catch {
          await sleep(300)
          continue
        }
        if (cancelled) return

        const key = normalize(text)
        const stable = key.length >= 4 && key === lastKey
        const confident = key.length >= 6 && confidence >= CONFIDENT
        lastKey = key
        if (key !== lastLockKey) seenOtherSinceLock = true
        setReadout(text ? { kind: 'reading', text } : { kind: 'idle', text: '' })

        if ((!stable && !confident) || failed.has(key)) continue
        if (Date.now() - lastLockAt < LOCK_GAP_MS) continue

        setReadout({ kind: 'checking', text })
        let card: ScryfallCard
        try {
          card = await namedFuzzy(text)
        } catch {
          failed.add(key)
          continue
        }
        if (cancelled) return

        // Same card still in the frame: do not count it again until it has
        // left the frame (or another card was shown) and a moment has passed.
        if (card.name === lastLockName && (!seenOtherSinceLock || Date.now() - lastLockAt < SAME_CARD_MS)) continue

        lastLockAt = Date.now()
        lastLockName = card.name
        lastLockKey = key
        seenOtherSinceLock = false

        // Pin the exact printing from the footer when it can be read. This
        // costs one more OCR pass and one request, so it only runs on a lock.
        try {
          const footer = await readFooter(cropFooterBand(still, still.width, still.height, FRAME))
          if (footer) {
            const exact = await bySetNumber(footer.set, footer.number)
            if (exact.name.toLowerCase() === card.name.toLowerCase()) card = exact
          }
        } catch {
          /* unreadable footer or no such printing: keep Scryfall's default */
        }
        if (cancelled) return
        recognised(card)
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
    // captureStill/recognised only touch refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // ---- photo fallback for browsers with no live camera -----------------------

  async function fromFile(file: File) {
    const bmp = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    const full: Frame = { x: 0.02, y: 0.02, w: 0.96, h: 0.96 }
    setReadout({ kind: 'checking', text: 'photo' })
    try {
      const { text } = await readTitle(cropTitleBand(canvas, canvas.width, canvas.height, full))
      let card = await namedFuzzy(text)
      try {
        const footer = await readFooter(cropFooterBand(canvas, canvas.width, canvas.height, full))
        if (footer) {
          const exact = await bySetNumber(footer.set, footer.number)
          if (exact.name.toLowerCase() === card.name.toLowerCase()) card = exact
        }
      } catch {
        /* keep default printing */
      }
      recognised(card)
      setReadout({ kind: 'idle', text: '' })
    } catch (e) {
      setCamError(`Could not read that photo: ${errorText(e)}`)
      setReadout({ kind: 'idle', text: '' })
    }
  }

  return (
    <div className="stack">
      <div className="viewfinder">
        <video ref={videoRef} playsInline muted />
        {camera === 'on' && (
          <>
            <div
              className={`frame ${readout.kind === 'checking' ? 'checking' : ''} ${flash ? 'locked' : ''}`}
              style={{ left: `${FRAME.x * 100}%`, top: `${FRAME.y * 100}%`, width: `${FRAME.w * 100}%`, height: `${FRAME.h * 100}%` }}
            />
            <div className="hint top">
              {paused && 'Paused'}
              {!paused && readout.kind === 'idle' && 'Hold a card in the frame'}
              {!paused && readout.kind === 'reading' && (
                <>
                  Reading <span className="readout">{readout.text}</span>
                </>
              )}
              {!paused && readout.kind === 'checking' && (
                <>
                  Checking <span className="readout">{readout.text}</span>…
                </>
              )}
            </div>
            {flash && (
              <div className="scan-flash" key={flash.id} role="status">
                <img src={thumb(flash.card)} alt="" />
                <span>
                  <strong>{flash.card.name}</strong>
                  <span className="small">
                    {flash.card.set.toUpperCase()} #{flash.card.collector_number}
                    {flash.count > 1 ? ` · ×${flash.count}` : ' · Added'}
                  </span>
                </span>
              </div>
            )}
          </>
        )}
        {camera === 'starting' && <div className="hint">Starting camera…</div>}
        {camera === 'off' && camError && (
          <div className="hint" style={{ bottom: '45%', padding: '0 24px' }}>
            {camError}
          </div>
        )}
      </div>

      {camera === 'off' && (
        <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
          <button className="btn" onClick={() => void start()}>
            Try the camera again
          </button>
          <label className="btn quiet" style={{ cursor: 'pointer' }}>
            Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {camera === 'on' && items.length === 0 && (
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
          Each card is added as soon as it is recognised. Swap to the next one when you feel the buzz.
        </p>
      )}

      <ScanTray
        items={items}
        onSetQty={(i, q) => void setQty(i, q)}
        onChangePrinting={(i, c) => void changePrinting(i, c)}
        onRemove={(i) => void remove(i)}
        onRetry={(i) => {
          patch(i.key, { status: 'adding', error: undefined })
          void addToPool(i.card, 1)
        }}
        onDone={onDone}
      />
    </div>
  )
}

/** Lower-case letters only, so "Lightning Bolt" and "lightning  bolt." compare equal between frames. */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, '')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
