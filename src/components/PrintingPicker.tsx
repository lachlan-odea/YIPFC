import { useEffect, useState } from 'react'
import { printings, type ScryfallCard } from '../lib/scryfall'

/**
 * Lets the owner pick the exact printing they hold. Defaults to whatever
 * Scryfall returned first; most people will not bother and that is fine.
 */
export default function PrintingPicker({
  name,
  selected,
  onSelect,
}: {
  name: string
  selected: ScryfallCard
  onSelect: (c: ScryfallCard) => void
}) {
  const [list, setList] = useState<ScryfallCard[] | null>(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || list) return
    printings(name)
      .then(setList)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [open, list, name])

  const img = (c: ScryfallCard) => c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? ''

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between">
        <span className="small muted">
          Printing: {selected.set_name} #{selected.collector_number}
        </span>
        <button className="btn quiet sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Done' : 'Change'}
        </button>
      </div>
      {open && (
        <>
          {err && <div className="notice warn">{err}</div>}
          {!list && !err && <p className="small faint">Loading printings…</p>}
          {list && (
            <div className="printings">
              {list.map((c) => (
                <button key={c.id} className="candidate" aria-pressed={c.id === selected.id} onClick={() => onSelect(c)}>
                  <img src={img(c)} alt="" loading="lazy" />
                  <span>
                    {c.set.toUpperCase()} #{c.collector_number}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
