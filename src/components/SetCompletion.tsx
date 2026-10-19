import { useMemo } from 'react'
import { usePool } from '../lib/store'
import { setProgress } from '../lib/achievements'
import { useSetSizes } from '../lib/sets'

/**
 * How much of each set the pod holds between them. Tapping a set applies it
 * as the pool filter so you can see what is there and spot the gaps.
 */
export default function SetCompletion({ selected, onSelect }: { selected: string; onSelect: (code: string) => void }) {
  const pool = usePool()
  const sizes = useSetSizes(pool.cards.map((c) => c.set_code))
  const rows = useMemo(() => setProgress(pool.cards, sizes), [pool.cards, sizes])
  const loading = rows.some((r) => !sizes[r.code])

  if (rows.length === 0) return <p className="small faint">Add some cards and the sets will show up here.</p>

  return (
    <div className="set-list">
      {rows.map((r) => {
        const icon = sizes[r.code]?.icon
        const complete = r.size > 0 && r.have >= r.size
        return (
          <button
            key={r.code}
            className={`set-row ${complete ? 'complete' : ''}`}
            aria-pressed={selected === r.code}
            onClick={() => onSelect(selected === r.code ? 'all' : r.code)}
          >
            {icon ? <img src={icon} alt="" className="set-icon" loading="lazy" /> : <span className="set-icon" />}
            <span className="set-text">
              <strong>{r.name}</strong>
              <span className="small muted">
                {r.size ? `${r.have} of ${r.size} cards` : `${r.have} cards`}
                {complete ? ' · complete!' : ''}
              </span>
              <i className="ach-bar" aria-hidden="true">
                <b style={{ width: `${r.pct * 100}%` }} />
              </i>
            </span>
            <span className="set-pct">{r.size ? `${Math.floor(r.pct * 100)}%` : '…'}</span>
          </button>
        )
      })}
      {loading && <p className="small faint">Fetching set sizes…</p>}
    </div>
  )
}
