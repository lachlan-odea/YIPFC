import { useState } from 'react'
import { usePool } from '../lib/store'
import { toPoolCard, type ScryfallCard } from '../lib/scryfall'
import { Pips, Stepper, errorText, useToast } from './ui'
import PrintingPicker from './PrintingPicker'

/** Shared "here's the card, how many, add it" step used by Scan and Search. */
export default function AddCardPanel({
  card,
  onChangePrinting,
  onAdded,
  addLabel = 'Add to the pool',
}: {
  card: ScryfallCard
  onChangePrinting: (c: ScryfallCard) => void
  onAdded: () => void
  addLabel?: string
}) {
  const pool = usePool()
  const toast = useToast()
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const img = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? ''

  async function add() {
    setBusy(true)
    try {
      await pool.addCards([toPoolCard(card, qty)])
      toast(`Added ${qty > 1 ? `${qty}× ` : ''}${card.name}`)
      onAdded()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="detail">
        <img src={img} alt={`${card.name} card`} />
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>{card.name}</h2>
            <div className="meta row" style={{ gap: 8 }}>
              <Pips identity={card.color_identity ?? []} />
              <span className="small muted">{card.type_line}</span>
            </div>
          </div>
          <PrintingPicker name={card.name} selected={card} onSelect={onChangePrinting} />
          <div className="row between">
            <span className="muted">Spare copies</span>
            <Stepper value={qty} onChange={setQty} />
          </div>
        </div>
      </div>
      <button className="btn primary block" disabled={busy} onClick={add}>
        {busy ? 'Adding…' : addLabel}
      </button>
    </div>
  )
}
