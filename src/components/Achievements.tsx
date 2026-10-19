import { useEffect, useMemo, useRef } from 'react'
import { usePool } from '../lib/store'
import { achievements, setProgress, type Achievement } from '../lib/achievements'
import { useSetSizes } from '../lib/sets'
import { useToast } from './ui'

const SEEN_KEY = 'yipfc/achievements-seen'

/** Everything you and the pod have earned, recomputed live from the pool. */
export function useAchievements(): Achievement[] {
  const pool = usePool()
  const sizes = useSetSizes(pool.cards.map((c) => c.set_code))
  return useMemo(() => {
    if (!pool.me) return []
    const sets = setProgress(pool.cards, sizes)
    return achievements({ meId: pool.me.id, cards: pool.cards, loans: pool.loans, decks: pool.decks, playerCount: pool.players.length, sets })
  }, [pool.me, pool.cards, pool.loans, pool.decks, pool.players.length, sizes])
}

/** Badge grid for the You tab. */
export default function Achievements() {
  const list = useAchievements()
  const earned = list.filter((a) => a.earned).length
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2 className="section-h">
        Achievements <span>{earned} of {list.length}</span>
      </h2>
      <div className="ach-grid">
        {list.map((a) => (
          <div key={a.id} className={`ach ${a.earned ? 'earned' : ''} ${a.pod ? 'pod' : ''}`} title={a.hint}>
            <span className="ach-icon" aria-hidden="true">
              {a.icon}
            </span>
            <strong>{a.title}</strong>
            <span className="small">
              {a.earned ? (a.pod ? 'Pod achievement' : 'Earned') : a.progress ? `${a.progress.n} / ${a.progress.of}` : a.hint}
            </span>
            {!a.earned && a.progress && (
              <i className="ach-bar" aria-hidden="true">
                <b style={{ width: `${Math.min(100, (a.progress.n / a.progress.of) * 100)}%` }} />
              </i>
            )}
          </div>
        ))}
      </div>
      <p className="small faint">Pod achievements count everyone's cards together. Tap a badge to see what it takes.</p>
    </section>
  )
}

/**
 * Mounted once inside the app shell: toasts newly earned achievements. The
 * first time it runs on a device it records what is already earned quietly,
 * so nobody gets fifteen toasts on install.
 */
export function AchievementWatcher() {
  const list = useAchievements()
  const toast = useToast()
  const seeded = useRef(false)
  useEffect(() => {
    if (!list.length) return
    const earned = list.filter((a) => a.earned).map((a) => a.id)
    let seen: string[] | null = null
    try {
      const raw = localStorage.getItem(SEEN_KEY)
      seen = raw ? (JSON.parse(raw) as string[]) : null
    } catch {
      seen = null
    }
    if (seen && seeded.current) {
      const fresh = earned.filter((id) => !seen!.includes(id))
      for (const id of fresh.slice(0, 2)) {
        const a = list.find((x) => x.id === id)!
        toast(`${a.icon} Achievement: ${a.title}`)
      }
    }
    seeded.current = true
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen ? [...new Set([...seen, ...earned])] : earned))
    } catch {
      /* fine */
    }
  }, [list, toast])
  return null
}
