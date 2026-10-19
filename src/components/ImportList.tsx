import { useState } from 'react'
import { parseList, type ParsedLine } from '../lib/parseList'
import { namedFuzzy, toPoolCard, type ScryfallCard } from '../lib/scryfall'
import { resolveLines } from '../lib/resolve'
import { usePool } from '../lib/store'
import { errorText, useToast } from './ui'

type Row = { line: ParsedLine; card: ScryfallCard | null; quantity: number; retry: string }

const EXAMPLE = `1 Sol Ring (C21) 263
1 Arcane Signet
2x Command Tower
Rhystic Study`

export default function ImportList({ onDone }: { onDone: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function check() {
    const parsed = parseList(text)
    setSkipped(parsed.skipped)
    if (parsed.lines.length === 0) {
      toast('No card lines found in that text', 'error')
      return
    }
    setBusy(`Looking up ${parsed.lines.length} cards…`)
    try {
      const resolved = await resolveLines(parsed.lines)
      setRows(parsed.lines.map((line, i) => ({ line, card: resolved[i], quantity: line.quantity, retry: line.name })))
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function retryRow(i: number) {
    const row = rows![i]
    setBusy('Looking up…')
    try {
      const card = await namedFuzzy(row.retry)
      setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, card } : r)))
    } catch {
      toast(`Still no match for “${row.retry}”`, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function addAll() {
    const ready = rows!.filter((r) => r.card && r.quantity > 0)
    setBusy(`Adding ${ready.length} cards…`)
    try {
      await pool.addCards(ready.map((r) => toPoolCard(r.card!, r.quantity, '', !!r.line.foil)))
      toast(`Added ${ready.reduce((n, r) => n + r.quantity, 0)} cards to the pool`)
      setRows(null)
      setText('')
      onDone()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function fromFile(file: File) {
    setText(await file.text())
  }

  if (rows) {
    const found = rows.filter((r) => r.card).length
    const missing = rows.length - found
    return (
      <div className="stack">
        <div className="row between">
          <span className="muted">
            {found} of {rows.length} matched{missing ? `, ${missing} to fix` : ''}
          </span>
          <button className="btn quiet sm" onClick={() => setRows(null)}>
            Edit list
          </button>
        </div>
        <div className="review">
          {rows.map((r, i) => (
            <div key={i} className={`review-row ${r.card ? '' : 'missing'}`}>
              {r.card ? <img src={r.card.image_uris?.small ?? r.card.card_faces?.[0]?.image_uris?.small} alt="" loading="lazy" /> : <div className="ph" />}
              {r.card ? (
                <div>
                  <div className="n">{r.card.name}</div>
                  <div className="s">
                    {r.card.set.toUpperCase()} #{r.card.collector_number}
                    {r.line.foil ? ' · foil' : ''}
                  </div>
                </div>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="s">Not found: “{r.line.raw}”</div>
                  <div className="row">
                    <input
                      className="input sm"
                      value={r.retry}
                      onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, retry: e.target.value } : x)))}
                      aria-label="Corrected card name"
                    />
                    <button className="btn sm" onClick={() => void retryRow(i)} disabled={!!busy}>
                      Retry
                    </button>
                  </div>
                </div>
              )}
              <input
                className="input sm"
                type="number"
                min={0}
                value={r.quantity}
                style={{ width: 60, textAlign: 'center' }}
                onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, quantity: Math.max(0, parseInt(e.target.value, 10) || 0) } : x)))}
                aria-label="Quantity"
              />
            </div>
          ))}
        </div>
        {skipped.length > 0 && (
          <p className="small faint">Ignored {skipped.length} line{skipped.length > 1 ? 's' : ''} that did not look like cards.</p>
        )}
        <button className="btn primary block" onClick={() => void addAll()} disabled={!!busy || found === 0}>
          {busy ?? `Add ${found} card${found === 1 ? '' : 's'} to the pool`}
        </button>
        {missing > 0 && <p className="small faint">Unmatched rows are left out. Fix the name and retry, or add them by search later.</p>}
      </div>
    )
  }

  return (
    <div className="stack">
      <p className="small muted">
        Paste from Moxfield, Archidekt, TappedOut, MTGO or a plain list. Quantities, set codes and foil flags are picked up when present.
      </p>
      <textarea
        className="textarea"
        placeholder={EXAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Card list"
      />
      <div className="row between">
        <label className="btn quiet" style={{ cursor: 'pointer' }}>
          Open a .txt or .csv
          <input type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])} />
        </label>
        <button className="btn primary" onClick={() => void check()} disabled={!text.trim() || !!busy}>
          {busy ?? 'Check the list'}
        </button>
      </div>
    </div>
  )
}
