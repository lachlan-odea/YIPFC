import { useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import { Sheet, errorText, useToast } from './ui'
import {
  SEAT_COLOURS,
  activeSeats,
  alive,
  commanderKey,
  commanderTally,
  eloRatings,
  gameRecord,
  isOver,
  playerTally,
  seatStats,
  type Game,
  type Tally,
} from '../lib/life'
import type { GameRecord } from '../lib/types'
import { uid } from '../lib/uid'

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`)
const one = (n: number | null) => (n === null ? '–' : n.toFixed(1))
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * The end of a game: who won, the numbers behind it, and a button to keep
 * the result. Opens on its own when one player is left, or from the menu to
 * end a game by hand (the winner can be changed either way).
 */
export function EndGameSheet({ game, onClose, onSaved }: { game: Game; onClose: () => void; onSaved: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const seats = activeSeats(game)
  const standing = alive(game)
  const over = isOver(game)
  const [winner, setWinner] = useState<number | null>(standing.length === 1 ? standing[0].id : null)
  const [busy, setBusy] = useState(false)
  const minutes = game.startedAt ? Math.max(1, Math.round((Date.now() - Date.parse(game.startedAt)) / 60000)) : null
  const champ = seats.find((s) => s.id === winner)

  async function save() {
    setBusy(true)
    try {
      await pool.saveGame(gameRecord(game, { id: uid(), pod_id: pool.pod?.id ?? null, created_by: pool.user?.id ?? 'local', winner }))
      toast(champ ? `Saved: ${champ.name} wins on turn ${game.turn}` : 'Game saved')
      onSaved()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} label={over ? 'Game over' : 'End game'}>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <h2 className="title" style={{ fontSize: 24 }}>
            {champ && over ? `${champ.name} wins!` : over ? 'Game over' : 'End game'}
          </h2>
          <p className="subtitle" style={{ marginTop: 4 }}>
            {game.turn > 0 ? `Turn ${game.turn}` : 'Turns were not tracked'}
            {minutes ? ` · ${minutes} min` : ''} · {game.players} players at {game.startingLife}
          </p>
        </div>

        <div className="field">
          <label>Winner</label>
          <div className="chips">
            {seats.map((s) => (
              <button key={s.id} className="chip" aria-pressed={winner === s.id} onClick={() => setWinner(s.id)}>
                <i className="swatch-dot" style={{ background: SEAT_COLOURS[s.colour] }} aria-hidden="true" />
                {s.name}
              </button>
            ))}
            <button className="chip" aria-pressed={winner === null} onClick={() => setWinner(null)}>
              No winner
            </button>
          </div>
        </div>

        <table className="stat-table">
          <thead>
            <tr>
              <th>Seat</th>
              <th className="num">Life ±</th>
              <th className="num">⚔ dealt</th>
              <th className="num">Out</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((s) => {
              const st = seatStats(game, s.id)
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.commanderName && <div className="small faint">{s.commanderName}</div>}
                  </td>
                  <td className="num">
                    <span className="up">+{st.gained}</span> <span className="down">−{st.lost}</span>
                  </td>
                  <td className="num">{st.dealt}</td>
                  <td className="num">{st.outTurn !== null ? `T${st.outTurn}` : winner === s.id ? 'Won' : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <button className="btn primary block" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save result & new game'}
        </button>
        <button className="btn quiet block" onClick={onClose}>
          {over ? 'Keep playing' : 'Cancel'}
        </button>
        <p className="small faint">Saved games build each commander's and player's record under Games &amp; stats.</p>
      </div>
    </Sheet>
  )
}

/** Saved games rolled up by commander and by player: record, averages and Elo, best first. */
export function useStatsRows(): { commanders: Row[]; players: Row[] } {
  const pool = usePool()
  const games = pool.games
  const commanders = useMemo(() => {
    const elo = eloRatings(games, (r) => (r.commander ? commanderKey(r.commander) : null))
    const seen = new Map<string, string>()
    for (const g of games) for (const r of g.players) if (r.commander && !seen.has(commanderKey(r.commander))) seen.set(commanderKey(r.commander), r.commander.trim())
    return [...seen].map(([id, name]) => ({ id, name, t: commanderTally(games, name), elo: elo.get(id)?.rating ?? null })).sort(byRating)
  }, [games])
  const players = useMemo(() => {
    const elo = eloRatings(games, (r) => r.player_id)
    const seen = new Map<string, string>()
    for (const g of games) for (const r of g.players) if (r.player_id && !seen.has(r.player_id)) seen.set(r.player_id, pool.playerById(r.player_id)?.name ?? r.name)
    return [...seen].map(([id, name]) => ({ id, name, t: playerTally(games, id), elo: elo.get(id)?.rating ?? null })).sort(byRating)
  }, [games, pool])
  return { commanders, players }
}

/** Every finished game the pod has saved, rolled up by commander and by player, then listed. */
export function StatsSheet({ onClose }: { onClose: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const games = pool.games
  const { commanders, players } = useStatsRows()

  return (
    <Sheet onClose={onClose} label="Games and stats">
      <div className="stack" style={{ gap: 6 }}>
        <h2 className="title" style={{ fontSize: 22 }}>
          Games &amp; stats
        </h2>
        <p className="subtitle">{pool.pod ? `Everything ${pool.pod.name} has saved.` : 'Games saved on this account.'}</p>

        {games.length === 0 && (
          <div className="empty">
            <strong>No games saved yet</strong>
            <p>Finish a game on the Life tab and save the result to start the record.</p>
          </div>
        )}

        {commanders.length > 0 && (
          <>
            <h3 className="section-h">
              Commanders <span>{commanders.length}</span>
            </h3>
            <TallyTable rows={commanders} />
          </>
        )}

        {players.length > 0 && (
          <>
            <h3 className="section-h">
              Players <span>{players.length}</span>
            </h3>
            <TallyTable rows={players} />
          </>
        )}

        {games.length > 0 && (
          <>
            <h3 className="section-h">
              Recent games <span>{games.length}</span>
            </h3>
            <div className="game-list">
              {games.slice(0, 30).map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  mine={g.created_by === pool.user?.id}
                  onRemove={() => {
                    if (!confirm('Remove this game from the record?')) return
                    void pool.removeGame(g.id).catch((e) => toast(errorText(e), 'error'))
                  }}
                />
              ))}
            </div>
          </>
        )}

        <button className="btn quiet block" style={{ marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  )
}

export type Row = { id: string; name: string; t: Tally; elo: number | null }
const byRating = (a: Row, b: Row) => (b.elo ?? -Infinity) - (a.elo ?? -Infinity) || b.t.games - a.t.games || a.name.localeCompare(b.name)

/** Elo rounded, in the badge colour when above the starting rating. */
function Elo({ value }: { value: number | null }) {
  if (value === null) return <>–</>
  return <span className={value >= 1000 ? 'elo up' : 'elo'}>{Math.round(value)}</span>
}

export function TallyTable({ rows, compact = false }: { rows: Row[]; compact?: boolean }) {
  return (
    <table className="stat-table">
      <thead>
        <tr>
          <th>Name</th>
          <th className="num" title="Elo rating, starting at 1000; every pair of players in a game is scored as a match">
            Elo
          </th>
          <th className="num">Games</th>
          <th className="num">Won</th>
          <th className="num">Win %</th>
          {!compact && (
            <>
              <th className="num" title="Average turns the game lasted">
                Turns
              </th>
              <th className="num" title="Average life lost">
                Lost
              </th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <strong>{r.name}</strong>
            </td>
            <td className="num">
              <Elo value={r.elo} />
            </td>
            <td className="num">{r.t.games}</td>
            <td className="num">{r.t.wins}</td>
            <td className="num">{pct(r.t.winRate)}</td>
            {!compact && (
              <>
                <td className="num">{one(r.t.avgTurns)}</td>
                <td className="num">{one(r.t.avgLost)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The commander table in brief, for the You tab: top few by Elo, with a
 * button to the full sheet. Shows a nudge instead until a game is saved.
 */
export function StatsSummary() {
  const pool = usePool()
  const { commanders } = useStatsRows()
  const [open, setOpen] = useState(false)
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2 className="section-h">
        Games &amp; stats <span>{pool.games.length === 1 ? '1 game' : `${pool.games.length} games`}</span>
      </h2>
      {commanders.length > 0 ? (
        <TallyTable rows={commanders.slice(0, 5)} compact />
      ) : (
        <p className="small muted">
          {pool.games.length ? 'No commanders named yet. Type one in each seat before saving a game.' : 'Save a game from the Life tab and the records start here.'}
        </p>
      )}
      <button className="btn block" onClick={() => setOpen(true)}>
        All games &amp; stats
      </button>
      {open && <StatsSheet onClose={() => setOpen(false)} />}
    </section>
  )
}

function GameRow({ game, mine, onRemove }: { game: GameRecord; mine: boolean; onRemove: () => void }) {
  const champ = game.players.find((p) => p.won)
  return (
    <div className="game-row">
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <strong>
          {champ ? `${champ.name} won` : 'No winner'}
          {champ?.commander ? <span className="muted"> with {champ.commander}</span> : ''}
        </strong>
        <span className="small faint">
          {when(game.ended_at)} · turn {game.turns} · {game.players.map((p) => p.name).join(', ')}
        </span>
      </div>
      {mine && (
        <button className="btn sm quiet" onClick={onRemove} aria-label="Remove this game">
          Remove
        </button>
      )}
    </div>
  )
}
