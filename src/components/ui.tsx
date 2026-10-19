import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/* ---------- icons (inline so the shell works offline on first paint) ---------- */

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

export const Icons = {
  pool: () => svg(<><rect x="3" y="5" width="11" height="15" rx="1.5" /><path d="M8 3h11a1.5 1.5 0 0 1 1.5 1.5V17" /></>),
  add: () => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>),
  decks: () => svg(<><rect x="3" y="4" width="11" height="15" rx="1.5" /><path d="M9 7h2M9 10h2M14 6l5 1.5v13L14 19" /></>),
  loans: () => svg(<><path d="M4 9h13l-3-3M20 15H7l3 3" /></>),
  me: () => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>),
  search: () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  camera: () => svg(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  list: () => svg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>),
  close: () => svg(<path d="M6 6l12 12M18 6 6 18" />),
  check: () => svg(<path d="m5 12 5 5L20 7" />),
  back: () => svg(<path d="M15 5l-7 7 7 7" />),
}

/* ---------- mana pips ---------- */

const ORDER = ['W', 'U', 'B', 'R', 'G']

export function Pips({ identity }: { identity: string[] }) {
  const list = identity.length ? ORDER.filter((c) => identity.includes(c)) : ['C']
  return (
    <span className="pips" aria-label={identity.length ? identity.join(' ') : 'colorless'}>
      {list.map((c) => (
        <i key={c} className={`pip ${c}`} />
      ))}
    </span>
  )
}

/* ---------- stepper ---------- */

export function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <span className="stepper" role="group" aria-label="Quantity">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Fewer">
        −
      </button>
      <output>{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} aria-label="More">
        +
      </button>
    </span>
  )
}

/* ---------- bottom sheet ---------- */

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  )
}

/* ---------- toast ---------- */

type Toast = { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const show = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now()
    setToast({ id, text, kind })
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), kind === 'error' ? 5000 : 2600)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
