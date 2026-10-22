import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePool } from '../lib/store'
import { Icons, Sheet, errorText, useToast } from '../components/ui'
import { EndGameSheet, StatsSheet } from '../components/GameStats'
import { DiceButton, type RadialItem } from '../components/DiceButton'
import { LETHAL, SEAT_COLOURS, activeSeats, adjustCommander, alive, isDead, isOver, opponents, passTurn, startTurns, undoPass, type Game, type Seat } from '../lib/life'
import { freshSessionSeat, resetFields, sessionPatch, toGame, type LiveSession } from '../lib/session'
import { Pane, buzz, useHold, useOrientationLock, usePortrait, useWakeLock } from './LifeScreen'

/**
 * Pod mode: this phone is one seat at the table. Held sideways, the other
 * players' totals run along the top so everyone can see the state of play,
 * and the big panel below is your own seat with every control the one-phone
 * counter has. The session lives in one shared document; each phone writes
 * only its own seat and the turn.
 */
export default function LifeSession({ id, onLeave, onExit }: { id: string; onLeave: () => void; onExit: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const live = pool.live
  const uid = pool.user?.id ?? ''
  const [session, setSession] = useState<LiveSession | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const gameRef = useRef<Game | null>(null)
  const [menu, setMenu] = useState(false)
  const [end, setEnd] = useState(false)
  const [stats, setStats] = useState(false)
  const [gone, setGone] = useState<string | null>(null)
  const joining = useRef(false)
  // Commander damage mode: the cards along the top switch to what each player has dealt me.
  const [cmdrMode, setCmdrMode] = useState(false)

  useWakeLock()
  useOrientationLock('landscape')
  // No OS rotation (a locked phone, iOS Safari): draw the screen turned a quarter so it is sideways anyway.
  const sideways = usePortrait()

  // Follow the session. Our own local edits are applied optimistically and then overwritten by the next snapshot.
  useEffect(() => {
    if (!live) return
    return live.watchSession(id, (s) => {
      if (!s) {
        setGone('That session has been removed.')
        return
      }
      if (s.status === 'ended') {
        setGone('The session has ended.')
        return
      }
      setSession(s)
      const g = toGame(s)
      gameRef.current = g
      setGame(g)
    })
  }, [live, id])

  // Not seated yet (opened from a share, or the host's seat vanished): take the next seat.
  useEffect(() => {
    if (!live || !session || !pool.me || joining.current) return
    if (session.order.includes(uid) && session.seats[uid]) return
    if (session.order.length >= 6) {
      setGone('That table is full.')
      return
    }
    joining.current = true
    const taken = session.order.map((u) => session.seats[u]?.colour).filter((c): c is NonNullable<typeof c> => !!c)
    live
      .joinSession(id, uid, freshSessionSeat(uid, pool.me.name, session.starting_life, taken))
      .catch((e) => toast(errorText(e), 'error'))
      .finally(() => (joining.current = false))
  }, [live, session, pool.me, uid, id, toast])

  useEffect(() => {
    if (gone) {
      toast(gone)
      onLeave()
    }
  }, [gone, toast, onLeave])

  /** Apply a change locally at once, then send just the difference. */
  const onGame = useCallback(
    (fn: (g: Game) => Game) => {
      const cur = gameRef.current
      if (!cur || !session || !live) return
      const next = fn(cur)
      if (next === cur) return
      gameRef.current = next
      setGame(next)
      const patch = sessionPatch(cur, next, session.order)
      if (!Object.keys(patch.fields).length && !patch.events.length) return
      live.updateSession(id, patch.fields, patch.events).catch((e) => toast(errorText(e), 'error'))
    },
    [session, live, id, toast],
  )

  const over = game ? isOver(game) : false
  const endSeen = useRef(false)
  useEffect(() => {
    if (over && !endSeen.current) {
      endSeen.current = true
      setEnd(true)
    }
    if (!over) endSeen.current = false
  }, [over])

  if (!live) {
    return <Empty text="Pod mode needs the shared pool." onExit={onExit} />
  }
  if (!session || !game) {
    return <Empty text="Joining the table…" onExit={onLeave} />
  }

  const myIdx = session.order.indexOf(uid)
  const mySeat = myIdx >= 0 ? game.seats[myIdx] : null
  const roll = (sides: number) => toast(`d${sides}: ${1 + Math.floor(Math.random() * sides)}`)
  const shortcuts: RadialItem[] = [
    { label: '1st', icon: '🎲', onPick: () => pickFirst() },
    { label: 'Undo', icon: '↶', onPick: () => onGame((g) => undoPass(g)), disabled: !game.log.some((e) => e.kind === 'pass') },
    { label: 'End', icon: '🏁', onPick: () => setEnd(true), disabled: game.players < 2 },
    { label: 'd6', icon: <Icons.d6 />, onPick: () => roll(6) },
    { label: 'd20', icon: <Icons.d20 />, onPick: () => roll(20) },
    { label: 'Coin', icon: '🪙', onPick: () => toast(Math.random() < 0.5 ? 'Heads' : 'Tails') },
  ]
  const others = activeSeats(game).filter((s) => s.id !== myIdx)
  const activeSeat = game.active !== null ? game.seats[game.active] : null
  const host = pool.playerById(session.host_id)?.name ?? 'someone'

  function pass() {
    onGame((g) => passTurn(g, Date.now(), g.seats.slice(0, g.players).map((s) => s.id)))
    buzz(12)
  }

  function pickFirst() {
    setMenu(false)
    const ids = alive(game!).map((s) => s.id)
    if (!ids.length) return
    const id = ids[Math.floor(Math.random() * ids.length)]
    onGame((g) => startTurns(g, id))
    buzz(40)
  }

  async function nextGame() {
    setEnd(false)
    try {
      await live!.updateSession(id, resetFields(session!), [], true)
      toast('New game. Spin for who goes first from the menu.')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  async function endSession() {
    if (!confirm('End the session for everyone at the table?')) return
    try {
      await live!.updateSession(id, { status: 'ended' }, [])
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className={`life session ${sideways ? 'sideways' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      <div className="strip-wrap">
      <div className="strip" aria-label="Other players">
        {others.map((s) => {
          const dead = isDead(s)
          if (cmdrMode && mySeat) return <DamageCard key={s.id} seat={s} dealt={mySeat.commander[s.id] ?? 0} onDelta={(d) => onGame((g) => adjustCommander(g, mySeat.id, s.id, d))} />
          // Commander damage this player has taken, per attacker, so the table can see who is close to 21.
          const cmdr = opponents(game, s.id)
            .map((o) => ({ from: o, n: s.commander[o.id] ?? 0 }))
            .filter((d) => d.n > 0)
          return (
            <div
              key={s.id}
              className={`strip-card ${dead ? 'dead' : ''} ${game.active === s.id ? 'active' : ''}`}
              style={{ '--seat': SEAT_COLOURS[s.colour] } as CSSProperties}
            >
              <span className="strip-name">
                {game.monarch === s.id && '👑 '}
                {game.initiative === s.id && '🗡️ '}
                {game.active === s.id && <span className="turn-tag">▶</span>} {s.name}
              </span>
              <strong className="strip-life">{dead ? '☠' : s.life}</strong>
              <span className="strip-sub">
                {s.commanderName ?? ''}
                {s.counters.poison > 0 && ` · ☠ ${s.counters.poison}`}
              </span>
              {cmdr.length > 0 && (
                <span className="strip-badges">
                  {cmdr.map(({ from, n }) => (
                    <span
                      key={from.id}
                      className={`pane-badge cmdr ${n >= LETHAL.commander ? 'lethal' : ''}`}
                      title={`${n} commander damage from ${from.id === myIdx ? 'you' : from.name}`}
                    >
                      <i className="swatch-dot" style={{ background: SEAT_COLOURS[from.colour] }} aria-hidden="true" />⚔ {n}
                    </span>
                  ))}
                </span>
              )}
            </div>
          )
        })}
        {others.length === 0 && <div className="strip-card empty">Waiting for the pod to join…</div>}
        <div className="session-bar">
          <DiceButton onTap={() => setMenu(true)} items={shortcuts} />
          {activeSeat ? (
            <button className="turn-pill" style={{ '--seat': SEAT_COLOURS[activeSeat.colour] } as CSSProperties} onClick={pass} title="Pass the turn">
              <i className="swatch-dot" aria-hidden="true" />
              <b>{activeSeat.id === myIdx ? 'You' : activeSeat.name}</b>
              <span>Turn {game.turn}</span>
              <Icons.next />
            </button>
          ) : (
            <button className="turn-pill idle" onClick={pickFirst} title="Pick who goes first">
              Who goes first?
            </button>
          )}
        </div>
      </div>
      </div>

      <div className="session-main">
        {mySeat ? (
          <Pane
            seat={mySeat}
            game={game}
            cell={{ seat: mySeat.id, row: 1, col: 1, rowSpan: 1, colSpan: 1, rotate: sideways ? 90 : 0 }}
            lay={{ rows: 1, cols: 1, cells: [{ seat: mySeat.id, row: 1, col: 1, rowSpan: 1, colSpan: 1, rotate: sideways ? 90 : 0 }] }}
            spot={null}
            onGame={onGame}
            damage={cmdrMode ? { victim: mySeat.id, onDone: () => setCmdrMode(false) } : null}
            onDamageMode={() => setCmdrMode(true)}
          />
        ) : (
          <div className="empty">
            <strong>Taking a seat…</strong>
          </div>
        )}
      </div>

      {menu && (
        <Sheet onClose={() => setMenu(false)} label="Session menu">
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h2 className="title" style={{ fontSize: 22 }}>
                Pod session
              </h2>
              <p className="subtitle" style={{ marginTop: 4 }}>
                {host}'s table · {session.order.length} {session.order.length === 1 ? 'player' : 'players'} at {session.starting_life}
                {game.turn > 0 ? ` · turn ${game.turn}` : ''}
              </p>
            </div>
            <div className="chips">
              {activeSeats(game).map((s) => (
                <span key={s.id} className="chip" aria-pressed={s.id === myIdx}>
                  <i className="swatch-dot" style={{ background: SEAT_COLOURS[s.colour] }} aria-hidden="true" />
                  {s.name} · {s.life}
                </span>
              ))}
            </div>
            <div className="row wrap">
              <button className="btn" onClick={pickFirst}>
                Who goes first?
              </button>
              <button className="btn" onClick={() => onGame((g) => undoPass(g))} disabled={!game.log.some((e) => e.kind === 'pass')}>
                Undo last pass
              </button>
              <button
                className="btn"
                onClick={() => {
                  setMenu(false)
                  setEnd(true)
                }}
                disabled={game.players < 2}
              >
                End game…
              </button>
              <button
                className="btn"
                onClick={() => {
                  setMenu(false)
                  setStats(true)
                }}
              >
                Games &amp; stats
              </button>
            </div>
            <p className="small faint">
              Everyone in {pool.pod?.name ?? 'the pod'} can join this table from the Life tab's menu on their own phone. Hold the phone sideways: the others'
              totals run along the top and your seat fills the rest.
            </p>
            <button className="btn danger block" onClick={() => void endSession()}>
              End session for everyone
            </button>
            <button className="btn quiet block" onClick={onLeave}>
              Leave session (back to one phone)
            </button>
            <button className="btn quiet block" onClick={onExit}>
              Back to the pool
            </button>
          </div>
        </Sheet>
      )}
      {end && <EndGameSheet game={game} onClose={() => setEnd(false)} onSaved={() => void nextGame()} />}
      {stats && <StatsSheet onClose={() => setStats(false)} />}
    </div>
  )
}

/** One opponent's card while marking commander damage: what they have dealt me, left half less, right half more. */
function DamageCard({ seat, dealt, onDelta }: { seat: Seat; dealt: number; onDelta: (d: number) => void }) {
  const hold = useHold((n) => {
    if (dealt + n < 0) return
    onDelta(n)
    buzz()
  }, { holdStep: 1, repeat: 110 })
  return (
    <div className={`strip-card dmg ${dealt >= LETHAL.commander ? 'lethal' : ''}`} style={{ '--seat': SEAT_COLOURS[seat.colour] } as CSSProperties}>
      <button className="strip-half minus" {...hold(-1)} disabled={dealt === 0} aria-label={`Less damage from ${seat.name}`} />
      <button className="strip-half plus" {...hold(1)} aria-label={`More damage from ${seat.name}`} />
      <span className="strip-name">{seat.name}</span>
      <strong className="strip-life">⚔ {dealt}</strong>
      <span className="strip-sub">dealt to you</span>
    </div>
  )
}

function Empty({ text, onExit }: { text: string; onExit: () => void }) {
  return (
    <div className="life session">
      <div className="empty" style={{ margin: 'auto' }}>
        <strong>{text}</strong>
        <button className="btn quiet" onClick={onExit} style={{ marginTop: 12 }}>
          Back
        </button>
      </div>
    </div>
  )
}

/** Which pod a session belongs to: the active pod, or a stand-in when a dev build fakes sessions on one device. */
export function sessionPodId(pool: { pod: { id: string } | null; mode: 'local' | 'shared'; live: unknown }): string | null {
  return pool.pod?.id ?? (pool.mode === 'local' && pool.live ? 'local' : null)
}

/** Hook for the one-phone menu: open sessions in this pod, live. */
export function useOpenSessions(): LiveSession[] {
  const pool = usePool()
  const [list, setList] = useState<LiveSession[]>([])
  const podId = sessionPodId(pool)
  useEffect(() => {
    if (!pool.live || !podId) {
      setList([])
      return
    }
    return pool.live.watchOpenSessions(podId, setList)
  }, [pool.live, podId])
  return useMemo(() => list, [list])
}
