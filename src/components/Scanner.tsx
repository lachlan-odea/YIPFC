import { useCallback, useEffect, useRef, useState } from 'react'
import { autocomplete, collection, namedFuzzy, type ScryfallCard } from '../lib/scryfall'
import { cropTitleBand, readTitle, warmUp, type Frame } from '../lib/ocr'
import { Icons, errorText } from './ui'
import AddCardPanel from './AddCardPanel'

// Card frame inside the 3:4 viewfinder, as fractions. Mirrors .viewfinder .frame CSS below.
const FRAME_W = 0.72
const FRAME: Frame = (() => {
  const w = FRAME_W
  const h = (w * 88) / 63 / (4 / 3) // card height as a fraction of the 3:4 viewfinder height
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
})()

/** After adding a card, ignore that same name for this long so it is not re-scanned while being put down. */
const SUPPRESS_MS = 5000

type Phase =
  | { kind: 'live' }
  | { kind: 'reading'; still: HTMLCanvasElement }
  | { kind: 'choose'; still: HTMLCanvasElement; read: string; candidates: ScryfallCard[]; picked: ScryfallCard | null }
  | { kind: 'nomatch'; still: HTMLCanvasElement; read: string }

type Readout = { kind: 'idle' | 'reading' | 'checking' | 'locked'; text: string }

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const suppressRef = useRef<{ name: string; until: number } | null>(null)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const [camError, setCamError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'live' })
  const [readout, setReadout] = useState<Readout>({ kind: 'idle', text: '' })
  const [added, setAdded] = useState(0)

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
    return stop
  }, [start, stop])

  // Paint the frozen still into the preview canvas whenever we are not live.
  useEffect(() => {
    if (phase.kind === 'live' || !previewRef.current) return
    const c = previewRef.current
    c.width = phase.still.width
    c.height = phase.still.height
    c.getContext('2d')!.drawImage(phase.still, 0, 0)
  }, [phase])

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

  /** Freeze on a still and resolve it to a card. `known` skips OCR when the live loop already matched. */
  async function identify(still: HTMLCanvasElement, frame: Frame, known?: { read: string; best: ScryfallCard }) {
    setPhase({ kind: 'reading', still })
    try {
      let read = known?.read
      if (read === undefined) {
        const band = cropTitleBand(still, still.width, still.height, frame)
        read = await readTitle(band)
      }
      if (read.length < 3) {
        setPhase({ kind: 'nomatch', still, read })
        return
      }
      const candidates = await findCandidates(read, known?.best)
      if (candidates.length === 0) setPhase({ kind: 'nomatch', still, read })
      else setPhase({ kind: 'choose', still, read, candidates, picked: candidates[0] })
    } catch (e) {
      setPhase({ kind: 'nomatch', still, read: errorText(e) })
    }
  }

  function freeze(still: HTMLCanvasElement, known?: { read: string; best: ScryfallCard }) {
    stop()
    setCamera('off')
    void identify(still, FRAME, known)
  }

  // Live scanning: read the title band over and over while the camera is on.
  // A card locks in when two consecutive reads agree and Scryfall knows the name.
  const live = phase.kind === 'live'
  useEffect(() => {
    if (!live || camera !== 'on') return
    let cancelled = false
    let lastKey = ''
    const failed = new Set<string>()
    setReadout({ kind: 'idle', text: '' })

    const loop = async () => {
      while (!cancelled) {
        const still = captureStill()
        if (!still) {
          await sleep(150)
          continue
        }
        let read: string
        try {
          read = await readTitle(cropTitleBand(still, still.width, still.height, FRAME))
        } catch {
          await sleep(300)
          continue
        }
        if (cancelled) return
        const key = normalize(read)
        const stable = key.length >= 4 && key === lastKey
        lastKey = key
        setReadout(read ? { kind: 'reading', text: read } : { kind: 'idle', text: '' })
        if (!stable || failed.has(key)) continue

        setReadout({ kind: 'checking', text: read })
        try {
          const best = await namedFuzzy(read)
          if (cancelled) return
          const sup = suppressRef.current
          if (sup && sup.name === best.name && Date.now() < sup.until) continue
          setReadout({ kind: 'locked', text: best.name })
          freeze(still, { read, best })
          return
        } catch {
          if (cancelled) return
          failed.add(key)
        }
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
    // captureStill/freeze only touch refs and setters, so they need not be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, camera])

  function snap() {
    const still = captureStill()
    if (still) freeze(still)
  }

  async function fromFile(file: File) {
    const bmp = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    stop()
    setCamera('off')
    // A photo straight from the camera roll: assume the card fills the shot.
    void identify(canvas, { x: 0.02, y: 0.02, w: 0.96, h: 0.96 })
  }

  function again(justAdded?: string) {
    suppressRef.current = justAdded ? { name: justAdded, until: Date.now() + SUPPRESS_MS } : null
    setPhase({ kind: 'live' })
    void start()
  }

  const frameState = readout.kind === 'locked' ? 'locked' : readout.kind === 'checking' ? 'checking' : ''

  return (
    <div className="stack">
      <div className="viewfinder">
        <video ref={videoRef} playsInline muted hidden={!live} />
        <canvas ref={previewRef} className="preview" hidden={live} />
        {live && camera === 'on' && (
          <>
            <div
              className={`frame ${frameState}`}
              style={{ left: `${FRAME.x * 100}%`, top: `${FRAME.y * 100}%`, width: `${FRAME.w * 100}%`, height: `${FRAME.h * 100}%` }}
            />
            <div className="hint">
              {readout.kind === 'idle' && 'Hold a card in the frame, name inside the gold box'}
              {readout.kind === 'reading' && (
                <>
                  Reading <span className="readout">{readout.text}</span>
                </>
              )}
              {readout.kind === 'checking' && (
                <>
                  Checking <span className="readout">{readout.text}</span>…
                </>
              )}
              {readout.kind === 'locked' && (
                <>
                  Found <span className="readout">{readout.text}</span>
                </>
              )}
            </div>
          </>
        )}
        {live && camera === 'starting' && <div className="hint">Starting camera…</div>}
        {live && camera === 'off' && camError && (
          <div className="hint" style={{ bottom: '45%', padding: '0 24px' }}>
            {camError}
          </div>
        )}
        {phase.kind === 'reading' && <div className="hint">Looking it up…</div>}
      </div>

      {live && (
        <div className="row" style={{ justifyContent: 'center', gap: 24 }}>
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
          <button className="shutter" onClick={snap} disabled={camera !== 'on'} aria-label="Scan now">
            <Icons.camera />
          </button>
          <span style={{ width: 84 }} className="small faint">
            {added > 0 ? `${added} added` : ''}
          </span>
        </div>
      )}
      {live && camera === 'on' && (
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
          Scanning happens on its own. The button is there if it is being stubborn.
        </p>
      )}

      {phase.kind === 'nomatch' && (
        <div className="stack">
          <div className="notice warn">
            Could not match a card{phase.read ? ` from “${phase.read}”` : ''}. Hold the phone steadier, fill the frame, and avoid glare on the name.
          </div>
          <button className="btn primary block" onClick={() => again()}>
            Try again
          </button>
        </div>
      )}

      {phase.kind === 'choose' && (
        <div className="stack">
          {phase.candidates.length > 1 && (
            <>
              <p className="small muted">
                Read “{phase.read}”. Pick the right card:
              </p>
              <div className="candidates">
                {phase.candidates.map((c) => (
                  <button
                    key={c.id}
                    className="candidate"
                    aria-pressed={phase.picked?.id === c.id}
                    onClick={() => setPhase({ ...phase, picked: c })}
                  >
                    <img src={c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small} alt="" />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {phase.picked && (
            <AddCardPanel
              card={phase.picked}
              onChangePrinting={(c) => setPhase({ ...phase, picked: c })}
              onAdded={() => {
                setAdded((n) => n + 1)
                again(phase.picked?.name)
              }}
              addLabel="Add and scan the next one"
            />
          )}
          <button className="btn quiet block" onClick={() => again(phase.picked?.name)}>
            Not these. Scan again
          </button>
        </div>
      )}
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

/**
 * Fuzzy match first (or reuse one the live loop already fetched); then
 * autocomplete alternatives so a misread letter is one tap to fix.
 */
async function findCandidates(read: string, best?: ScryfallCard): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = []
  const seen = new Set<string>()
  if (!best) {
    try {
      best = await namedFuzzy(read)
    } catch {
      /* no fuzzy match, fall through to autocomplete */
    }
  }
  if (best) {
    out.push(best)
    seen.add(best.name)
  }
  const alternatives = (await autocomplete(read).catch(() => [])).filter((n) => !seen.has(n)).slice(0, 5)
  if (alternatives.length) {
    const { found } = await collection(alternatives.map((name) => ({ name })))
    for (const c of found) if (!seen.has(c.name)) out.push(c)
  }
  return out
}
