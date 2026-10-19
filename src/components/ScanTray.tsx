import { useState } from 'react'
import type { ScryfallCard } from '../lib/scryfall'
import { Sheet, Stepper } from './ui'
import PrintingPicker from './PrintingPicker'

/** One card recognised during this scanning session, and its state in the pool. */
export type ScanItem = {
  /** Scryfall id of the printing in the pool. */
  key: string
  card: ScryfallCard
  /** How many times it was scanned this session. */
  scanned: number
  /** Your pool entry for this printing, once the add has gone through. */
  poolId?: string
  poolQty?: number
  status: 'adding' | 'added' | 'error'
  error?: string
}

export function thumb(c: ScryfallCard) {
  return c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? ''
}

/**
 * The running list under the viewfinder, ManaBox style: newest first, tap a
 * row to change the printing or quantity, or take it back out of the pool.
 */
export default function ScanTray({
  items,
  onSetQty,
  onChangePrinting,
  onRemove,
  onRetry,
  onDone,
}: {
  items: ScanItem[]
  onSetQty: (item: ScanItem, qty: number) => void
  onChangePrinting: (item: ScanItem, card: ScryfallCard) => void
  onRemove: (item: ScanItem) => void
  onRetry: (item: ScanItem) => void
  onDone?: () => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = items.find((i) => i.key === openKey) ?? null
  const total = items.reduce((n, i) => n + i.scanned, 0)

  if (items.length === 0) return null

  return (
    <div className="scan-tray">
      <div className="row between">
        <span className="small muted">
          Scanned {total} {total === 1 ? 'card' : 'cards'} this session
        </span>
        {onDone && (
          <button className="btn quiet sm" onClick={onDone}>
            Done
          </button>
        )}
      </div>
      <ul className="scan-list">
        {items.map((item) => (
          <li key={item.key} className={`scan-row ${item.status}`}>
            <button className="scan-row-main" onClick={() => setOpenKey(item.key)} aria-label={`Edit ${item.card.name}`}>
              <img src={thumb(item.card)} alt="" />
              <span className="scan-row-text">
                <strong>{item.card.name}</strong>
                <span className="small muted">
                  {item.card.set.toUpperCase()} #{item.card.collector_number}
                  {item.status === 'added' && item.poolQty !== undefined && ` · ${item.poolQty} in pool`}
                  {item.status === 'adding' && ' · Adding…'}
                  {item.status === 'error' && ` · ${item.error ?? 'Could not add'}`}
                </span>
              </span>
            </button>
            {item.status === 'error' ? (
              <button className="btn sm" onClick={() => onRetry(item)}>
                Retry
              </button>
            ) : (
              <span className="scan-count" aria-label={`Scanned ${item.scanned} times`}>
                ×{item.scanned}
              </span>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <Sheet onClose={() => setOpenKey(null)} label={`Edit ${open.card.name}`}>
          <div className="stack">
            <div className="detail">
              <img src={open.card.image_uris?.normal ?? open.card.card_faces?.[0]?.image_uris?.normal ?? thumb(open.card)} alt="" />
              <div className="stack" style={{ gap: 10 }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>{open.card.name}</h2>
                <PrintingPicker
                  name={open.card.name}
                  selected={open.card}
                  onSelect={(c) => {
                    if (c.id !== open.key) onChangePrinting(open, c)
                    setOpenKey(c.id)
                  }}
                />
                {open.status === 'added' && open.poolQty !== undefined && (
                  <div className="row between">
                    <span className="muted">In your pool</span>
                    <Stepper value={open.poolQty} onChange={(n) => onSetQty(open, n)} />
                  </div>
                )}
              </div>
            </div>
            <button
              className="btn block"
              onClick={() => {
                onRemove(open)
                setOpenKey(null)
              }}
            >
              Take it back out of the pool
            </button>
            <button className="btn quiet block" onClick={() => setOpenKey(null)}>
              Done
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
