import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { usePool } from '../lib/store'
import { Icons, Sheet, useToast } from '../components/ui'
import { EndGameSheet, StatsSheet } from '../components/GameStats'
import {
  COUNTERS,
  COUNTER_LABEL,
  LETHAL,
  MAX_PLAYERS,
  SEAT_COLOURS,
  STARTING_LIFE,
  activeSeats,
  adjustCommander,
  adjustCounter,
  adjustLife,
  inProgress,
  innerSides,
  isDead,
  isOver,
  lastWords,
  layout,
  newGame,
  opponents,
  parseGame,
  passTurn,
  setFirst,
  startTurns,
  toggleInitiative,
  toggleKO,
  toggleMonarch,
  undoPass,
  updateSeat,
  type Cell,
  type Counter,
  type Game,
  type Layout,
  type Seat,
  type SeatColour,
} from '../lib/life'

const KEY = 'yipfc/life'
/** Hold a half this long to start stepping by ten, then every HOLD_REPEAT ms. */
const HOLD_DELAY = 420
const HOLD_REPEAT = 450
const HOLD_STEP = 10
/** How long the running +N / −N bubble stays after the last tap. */
const DELTA_LINGER = 1800
/** How far a finger must travel in from the seat's left edge to open its panel. */
const SWIPE_PX = 36

function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseGame(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function buzz(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

type Spot = { id: number; final: boolean } | null

/**
 * A LifeTap-style table: one panel per seat, turned to face the player on that
 * edge of the phone. Takes over the whole screen; the centre button opens the
 * game menu, which is also the way back to the rest of the app.
 */
export default function LifeScreen({ onExit }: { onExit: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const [game, setGame] = useState<Game>(() => {
    const saved = loadGame()
    if (saved) return saved
    const names = pool.me ? [pool.me.name, ...pool.players.filter((p) => p.id !== pool.me!.id).map((p) => p.name)] : []
    return newGame(4, 40, null, names)
  })
  const [menu, setMenu] = useState(false)
  const [end, setEnd] = useState(false)
  const [stats, setStats] = useState(false)
  const [spot, setSpot] = useState<Spot>(null)
  const spotTimers = useRef<number[]>([])

  // One player left: offer to save the result, once per game.
  const over = isOver(game)
  const endSeen = useRef(false)
  useEffect(() => {
    if (over && !endSeen.current) {
      endSeen.current = true
      setEnd(true)
    }
    if (!over) endSeen.current = false
  }, [over])

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(game))
    } catch {
      /* storage full or blocked: the game just will not survive a reload */
    }
  }, [game])

  useWakeLock()

  useEffect(
    () => () => {
      for (const t of spotTimers.current) clearTimeout(t)
    },
    [],
  )

  const start = useCallback(
    (players: number, startingLife: number) => {
      setGame((g) => newGame(players, startingLife, g))
      setMenu(false)
      toast(`New game: ${players} ${players === 1 ? 'player' : 'players'} at ${startingLife} life`)
    },
    [toast],
  )

  function changeSetup(players: number, startingLife: number) {
    if (inProgress(game) && !confirm('Start a new game? Current life totals will be lost.')) return
    start(players, startingLife)
  }

  /** Back to starting totals, one question, then spin for who goes first. */
  function resetGame() {
    if (inProgress(game) && !confirm('Reset everyone to starting life and clear all counters?')) return
    start(game.players, game.startingLife)
    pickFirst()
  }

  /** Spin a highlight around the table and land on someone. */
  function pickFirst() {
    setMenu(false)
    const ids = activeSeats(game).map((s) => s.id)
    for (const t of spotTimers.current) clearTimeout(t)
    spotTimers.current = []
    const steps = ids.length * 3 + Math.floor(Math.random() * ids.length)
    for (let i = 0; i <= steps; i++) {
      // Slow down towards the end, like a wheel.
      const delay = i * 90 + Math.max(0, i - steps + 6) ** 2 * 25
      spotTimers.current.push(
        window.setTimeout(() => {
          const final = i === steps
          const id = ids[i % ids.length]
          setSpot({ id, final })
          if (final) setGame((g) => startTurns(g, id))
          buzz(final ? 40 : 6)
        }, delay),
      )
    }
    spotTimers.current.push(window.setTimeout(() => setSpot(null), steps * 90 + 1000 + 4000))
  }

  function pass() {
    setGame((g) => passTurn(g))
    buzz(12)
  }

  /** After a saved result: same table, fresh totals, spin again. */
  function nextGame() {
    setEnd(false)
    start(game.players, game.startingLife)
    pickFirst()
  }

  const lay = layout(game.players)
  const style = { '--rows': lay.rows, '--cols': lay.cols } as CSSProperties
  const activeSeat = game.active !== null ? game.seats[game.active] : null

  return (
    <div className={`life ${game.players === 1 ? 'single' : ''}`} style={style} onContextMenu={(e) => e.preventDefault()}>
      {lay.cells.map((cell) => {
        const seat = game.seats[cell.seat]
        return (
          <Pane
            key={seat.id}
            seat={seat}
            game={game}
            cell={cell}
            lay={lay}
            spot={spot?.id === seat.id ? spot : null}
            onGame={setGame}
          />
        )
      })}
      <button className="life-menu-btn" onClick={() => setMenu(true)} aria-label="Game menu" title="Game menu">
        <Icons.dice />
      </button>
      {game.players > 1 &&
        (activeSeat ? (
          <button
            className="turn-pill"
            style={{ '--seat': SEAT_COLOURS[activeSeat.colour] } as CSSProperties}
            onClick={pass}
            aria-label={`${activeSeat.name}'s turn, turn ${game.turn}. Pass the turn`}
            title="Pass the turn"
          >
            <i className="swatch-dot" aria-hidden="true" />
            <b>{activeSeat.name}</b>
            <span>Turn {game.turn}</span>
            <Icons.next />
          </button>
        ) : (
          <button className="turn-pill idle" onClick={pickFirst} title="Spin for who goes first">
            Who goes first?
          </button>
        ))}
      {menu && (
        <Menu
          game={game}
          onClose={() => setMenu(false)}
          onSetup={changeSetup}
          onReset={resetGame}
          onPickFirst={pickFirst}
          onUndoPass={() => setGame((g) => undoPass(g))}
          onEndGame={() => {
            setMenu(false)
            setEnd(true)
          }}
          onStats={() => {
            setMenu(false)
            setStats(true)
          }}
          onExit={onExit}
        />
      )}
      {end && <EndGameSheet game={game} onClose={() => setEnd(false)} onSaved={nextGame} />}
      {stats && <StatsSheet onClose={() => setStats(false)} />}
    </div>
  )
}

/* ---------- one seat ---------- */

function Pane({
  seat,
  game,
  cell,
  lay,
  spot,
  onGame,
}: {
  seat: Seat
  game: Game
  cell: Cell
  lay: Layout
  spot: Spot
  onGame: (fn: (g: Game) => Game) => void
}) {
  const [delta, setDelta] = useState<number | null>(null)
  const deltaTimer = useRef(0)
  const [drawer, setDrawer] = useState<DrawerKind | null>(null)
  const dead = isDead(seat)
  // Picked once when the seat goes down, so it does not change on every tap.
  const [epitaph, setEpitaph] = useState<string | null>(null)
  useEffect(() => {
    setEpitaph(dead ? lastWords(Math.floor(Math.random() * 1000)) : null)
  }, [dead])

  useEffect(() => () => clearTimeout(deltaTimer.current), [])

  const bump = useCallback(
    (n: number) => {
      onGame((g) => adjustLife(g, seat.id, n))
      setDelta((d) => (d ?? 0) + n)
      clearTimeout(deltaTimer.current)
      deltaTimer.current = window.setTimeout(() => setDelta(null), DELTA_LINGER)
      buzz()
    },
    [onGame, seat.id],
  )
  const hold = useHold(bump)

  const rotate = ((cell.rotate + (seat.flipped ? 180 : 0)) % 360) as Cell['rotate']
  const hasOpponents = game.players > 1
  const openDamage = () => setDrawer(hasOpponents ? 'damage' : 'counters')
  const topEdge = useSwipeEdge(rotate, 'down', () => setDrawer('counters'), (left) => bump(left ? -1 : 1))
  const leftIn = useSwipeEdge(rotate, 'right', openDamage, () => bump(-1))
  const rightIn = useSwipeEdge(rotate, 'left', openDamage, () => bump(1))
  // Damage opens from the side that faces the table. A full-width seat has none, so it
  // falls back to both sides with the grab bar held in from the phone's edge.
  const inner = innerSides(cell, lay, rotate)
  const sides = inner.length ? inner : (['left', 'right'] as const)
  const fullWidth = cell.colSpan === lay.cols
  // Counters stack down the outer side edge, away from the table; a seat with
  // both sides inner (the middle of a six-player table) uses its left.
  const outer = inner.includes('left') && !inner.includes('right') ? 'right' : 'left'
  const counters = COUNTERS.filter((c) => seat.counters[c] > 0)
  // Commander damage per attacker, so the badges say who has dealt what.
  const cmdr = opponents(game, seat.id)
    .map((o) => ({ from: o, n: seat.commander[o.id] ?? 0 }))
    .filter((d) => d.n > 0)
  const paneStyle = {
    gridRow: `${cell.row} / span ${cell.rowSpan}`,
    gridColumn: `${cell.col} / span ${cell.colSpan}`,
    '--seat': SEAT_COLOURS[seat.colour],
  } as CSSProperties

  return (
    <section
      className={`pane ${dead ? 'dead' : ''} ${game.active === seat.id ? 'active' : ''} ${game.monarch === seat.id ? 'monarch' : ''} ${game.initiative === seat.id ? 'initiative' : ''} ${spot ? (spot.final ? 'spot final' : 'spot') : ''}`}
      style={paneStyle}
      aria-label={`${seat.name}, ${seat.life} life`}
    >
      <div className={`face r${rotate}`}>
        <button className="half minus" {...hold(-1)} aria-label={`${seat.name} loses life`} />
        <button className="half plus" {...hold(1)} aria-label={`${seat.name} gains life`} />
        <div className={`swipe-edge top ${fullWidth ? 'full' : ''}`} {...topEdge} title="Swipe down for counters">
          <i aria-hidden="true" />
        </div>
        {sides.map((side) => (
          <div
            key={side}
            className={`swipe-edge side ${side} ${inner.length ? '' : 'outer'}`}
            {...(side === 'left' ? leftIn : rightIn)}
            title="Swipe in for commander damage"
          >
            <i aria-hidden="true" />
          </div>
        ))}

        <div className="pane-mid">
          <button className="pane-name" onClick={() => setDrawer('seat')} title="Name and colour">
            {game.monarch === seat.id && (
              <span title="Monarch" aria-label="Monarch">
                👑
              </span>
            )}
            {game.initiative === seat.id && (
              <span title="Has the initiative" aria-label="Has the initiative">
                🗡️
              </span>
            )}
            {game.first === seat.id && (
              <span className="first-tag" title="Went first" aria-label="Went first">
                1st
              </span>
            )}
            {game.active === seat.id && (
              <span className="turn-tag" title="Their turn" aria-label="Their turn">
                ▶
              </span>
            )}
            {seat.name}
          </button>
          {seat.deckName && <span className="deck-tag">{seat.deckName}</span>}
          <div className="life-wrap">
            <span className="sign" aria-hidden="true">
              −
            </span>
            <output className={`life-n ${dead ? 'skull' : ''}`} aria-live="off" aria-label={dead ? `${seat.name} is out, ${seat.life} life` : undefined}>
              {dead ? <Skull /> : seat.life}
            </output>
            <span className="sign" aria-hidden="true">
              +
            </span>
            {delta !== null && delta !== 0 && (
              <span className={`delta ${delta > 0 ? 'up' : 'down'}`} aria-hidden="true">
                {delta > 0 ? `+${delta}` : `−${-delta}`}
              </span>
            )}
          </div>
          {dead && epitaph && <q className="epitaph">{epitaph}</q>}
          <div className="pane-badges">
            {dead && <span className="pane-badge out">{seat.life} life</span>}
            {cmdr.map(({ from, n }) => (
              <span
                key={from.id}
                className={`pane-badge cmdr ${n >= LETHAL.commander ? 'lethal' : ''}`}
                title={`${n} commander damage from ${from.name}`}
                aria-label={`${n} commander damage from ${from.name}`}
              >
                <i className="swatch-dot" style={{ background: SEAT_COLOURS[from.colour] }} aria-hidden="true" />⚔ {n}
              </span>
            ))}
          </div>
          {spot?.final && <span className="goes-first">Goes first</span>}
        </div>

        {counters.length > 0 && (
          <div className={`counter-stack ${outer} ${inner.length ? '' : 'clear'}`} aria-label="Counters">
            {counters.map((c) => (
              <span
                key={c}
                className={`pane-badge ${c === 'poison' && seat.counters[c] >= LETHAL.poison ? 'lethal' : ''}`}
                title={`${seat.counters[c]} ${COUNTER_LABEL[c].toLowerCase()}`}
              >
                {COUNTER_ICON[c]} {seat.counters[c]}
              </span>
            ))}
          </div>
        )}

        {drawer === 'damage' && <DamageDrawer seat={seat} game={game} rotate={rotate} onGame={onGame} onClose={() => setDrawer(null)} />}
        {drawer === 'counters' && <CountersDrawer seat={seat} game={game} rotate={rotate} onGame={onGame} onClose={() => setDrawer(null)} />}
        {drawer === 'seat' && <SeatCard seat={seat} game={game} rotate={rotate} onGame={onGame} onClose={() => setDrawer(null)} />}
      </div>
    </section>
  )
}

/** Skull and crossbones in thin strokes, so it stays legible at life-total size. */
function Skull() {
  return (
    <svg className="skull-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 18.5 18.5 5.5M5.5 5.5l13 13" />
      <circle cx="4.6" cy="4.6" r="1.3" />
      <circle cx="19.4" cy="4.6" r="1.3" />
      <circle cx="4.6" cy="19.4" r="1.3" />
      <circle cx="19.4" cy="19.4" r="1.3" />
      <path className="cranium" d="M12 3.2c-4.1 0-7.2 3-7.2 6.8 0 2.3 1.1 4.1 2.7 5.2V17a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1.8c1.6-1.1 2.7-2.9 2.7-5.2 0-3.8-3.1-6.8-7.2-6.8z" />
      <circle cx="9.4" cy="10.3" r="1.6" />
      <circle cx="14.6" cy="10.3" r="1.6" />
      <path d="M12 12.4l-.9 1.8h1.8zM10 18v-2M12 18v-2M14 18v-2" />
    </svg>
  )
}

/**
 * Tap for one, hold for `holdStep` every `repeat` ms. Pointer capture keeps the gesture
 * on the half it started on; a keyboard "click" (detail 0) counts as a tap.
 */
function useHold(apply: (n: number) => void, { holdStep = HOLD_STEP, repeat: every = HOLD_REPEAT } = {}) {
  const delay = useRef(0)
  const repeat = useRef(0)
  const held = useRef(false)
  const stop = useCallback(() => {
    clearTimeout(delay.current)
    clearInterval(repeat.current)
  }, [])
  useEffect(() => stop, [stop])

  return (sign: 1 | -1) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic or already-released pointer: the tap still counts */
      }
      held.current = false
      stop()
      delay.current = window.setTimeout(() => {
        held.current = true
        apply(sign * holdStep)
        repeat.current = window.setInterval(() => apply(sign * holdStep), every)
      }, HOLD_DELAY)
    },
    onPointerUp: () => {
      stop()
      if (!held.current) apply(sign)
      held.current = true // so the trailing click is ignored
    },
    onPointerCancel: stop,
    onClick: (e: ReactMouseEvent) => {
      if (e.detail === 0) apply(sign)
    },
  })
}

/**
 * Drag detection in the seat's own frame: a drag of SWIPE_PX in direction
 * `dir` fires onSwipe; a plain tap fires onTap with whether it was on the left.
 * The face may be turned, so pointer positions are mapped into its frame.
 */
function useSwipeEdge(rotate: Cell['rotate'], dir: Swipe, onSwipe: () => void, onTap: (leftHalf: boolean) => void, capture = true) {
  const start = useRef<{ x: number; y: number; w: number } | null>(null)
  const swiped = useRef(false)
  const point = (e: ReactPointerEvent<HTMLElement>) => localPoint(e.currentTarget.getBoundingClientRect(), rotate, e.clientX, e.clientY)
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      if (capture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* fine */
        }
      }
      start.current = point(e)
      swiped.current = false
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current || swiped.current) return
      const p = point(e)
      const dx = p.x - start.current.x
      const dy = p.y - start.current.y
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
      if (along > SWIPE_PX) {
        swiped.current = true
        buzz(15)
        onSwipe()
      }
    },
    onPointerUp: () => {
      if (start.current && !swiped.current) onTap(start.current.x < start.current.w / 2)
      start.current = null
    },
    onPointerCancel: () => {
      start.current = null
    },
  }
}

/**
 * A screen point in the frame of an element turned `rotate` degrees clockwise:
 * x grows towards the element's own right, y towards its own bottom, and w is
 * its own width. The element's bounding box is exact for quarter turns.
 */
function localPoint(r: DOMRect, rotate: Cell['rotate'], cx: number, cy: number) {
  switch (rotate) {
    case 90:
      return { x: cy - r.top, y: r.right - cx, w: r.height }
    case 180:
      return { x: r.right - cx, y: r.bottom - cy, w: r.width }
    case 270:
      return { x: r.bottom - cy, y: cx - r.left, w: r.height }
    default:
      return { x: cx - r.left, y: cy - r.top, w: r.width }
  }
}

/* ---------- per-seat drawers: commander damage, counters, seat ---------- */

type DrawerKind = 'damage' | 'counters' | 'seat'
type Swipe = 'right' | 'up' | 'left' | 'down'

type DrawerProps = { seat: Seat; game: Game; rotate: Cell['rotate']; onGame: (fn: (g: Game) => Game) => void; onClose: () => void }

/**
 * A panel inside the seat's face, so it reads the same way up as the seat.
 * Slides in from `side`; closes on a swipe down anywhere on it (once its body
 * is scrolled to the top), a tap on the dimmed rest of the seat, the Escape
 * key, or a drag on its header back the way it came.
 */
function Drawer({
  side,
  title,
  rotate,
  onClose,
  children,
  footer,
}: {
  side: 'left' | 'top' | 'full'
  title: string
  rotate: Cell['rotate']
  onClose: () => void
  children: ReactNode
  /** Pinned under the scrolling body, for the one action that must stay reachable. */
  footer?: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const downTarget = useRef<Element | null>(null)
  const closeDrag = useSwipeEdge(rotate, side === 'left' ? 'left' : 'up', onClose, () => {})
  const down = useSwipeEdge(
    rotate,
    'down',
    () => {
      // A drag down inside a list that is scrolled is a scroll, not a dismiss.
      for (let n = downTarget.current; n && n !== panel.current; n = n.parentElement) if (n.scrollTop > 0) return
      onClose()
    },
    () => {},
    false,
  )
  const swipeDown = {
    ...down,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      downTarget.current = e.target as Element
      down.onPointerDown(e)
    },
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <section ref={panel} className={`drawer ${side}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} {...swipeDown}>
        <header className="drawer-head" {...closeDrag}>
          <strong>{title}</strong>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </section>
    </div>
  )
}

/** Commander damage taken from each opponent, in from the seat's left edge. */
function DamageDrawer({ seat, game, rotate, onGame, onClose }: DrawerProps) {
  const others = opponents(game, seat.id)
  return (
    <Drawer side="left" title="Commander damage" rotate={rotate} onClose={onClose}>
      <div className="ctiles">
        {others.map((o) => {
          const n = seat.commander[o.id] ?? 0
          return (
            <Tile
              key={o.id}
              label={o.name}
              swatch={SEAT_COLOURS[o.colour]}
              value={n}
              lethal={n >= LETHAL.commander}
              onDelta={(d) => onGame((g) => adjustCommander(g, seat.id, o.id, d))}
            />
          )
        })}
      </div>
      <p className="drawer-note">Damage taken from each commander. It comes off life too, and {LETHAL.commander} from one is lethal.</p>
    </Drawer>
  )
}

/** Poison and the other counters, plus monarch and initiative, down from the seat's top edge. */
function CountersDrawer({ seat, game, rotate, onGame, onClose }: DrawerProps) {
  return (
    <Drawer
      side="top"
      title="Counters"
      rotate={rotate}
      onClose={onClose}
      footer={
        <button
          className={`btn block ko-btn ${seat.ko ? '' : 'danger'}`}
          onClick={() => {
            onGame((g) => toggleKO(g, seat.id))
            buzz(seat.ko ? 10 : 40)
            onClose()
          }}
        >
          {seat.ko ? 'Back in the game' : '☠ K.O.'}
        </button>
      }
    >
      <div className="ctiles two">
        {COUNTERS.map((c) => (
          <Tile
            key={c}
            label={`${COUNTER_ICON[c]} ${TILE_LABEL[c]}`}
            value={seat.counters[c]}
            lethal={c === 'poison' && seat.counters[c] >= LETHAL.poison}
            axis="horizontal"
            onDelta={(d) => onGame((g) => adjustCounter(g, seat.id, c, d))}
          />
        ))}
      </div>
      <div className="row wrap drawer-chips">
        <button className="chip" aria-pressed={game.monarch === seat.id} onClick={() => onGame((g) => toggleMonarch(g, seat.id))}>
          👑 Monarch
        </button>
        <button className="chip" aria-pressed={game.initiative === seat.id} onClick={() => onGame((g) => toggleInitiative(g, seat.id))}>
          🗡️ Initiative
        </button>
      </div>
    </Drawer>
  )
}

/**
 * Who sits here, their colour and which way the seat faces, from a tap on the
 * name. Fills the seat: the pod's players scroll in a list on the left (a
 * native drop-down would not turn with the seat), colour and the toggles sit
 * on the right. Swipe down to put it away.
 */
function SeatCard({ seat, game, rotate, onGame, onClose }: DrawerProps) {
  const pool = usePool()
  const podNames = pool.players.map((p) => p.name)
  const [guest, setGuest] = useState(() => !podNames.includes(seat.name))
  // Focus the guest field only when it was just asked for, not when the card opens on a guest seat.
  const [focusGuest, setFocusGuest] = useState(false)
  const names = [...new Set(guest ? podNames : [...podNames, seat.name])].sort((a, b) => a.localeCompare(b))
  const setName = (name: string) => onGame((g) => updateSeat(g, seat.id, { name }))
  const pickPlayer = (name: string) =>
    onGame((g) => updateSeat(g, seat.id, { name, playerId: pool.players.find((p) => p.name === name)?.id ?? null }))
  // That player's decks first; a guest can pick from anything in the pod.
  const decks = pool.decks
    .filter((d) => !seat.playerId || d.owner_id === seat.playerId)
    .sort((a, b) => a.name.localeCompare(b.name))
  const setDeck = (d: { id: string; name: string } | null) => onGame((g) => updateSeat(g, seat.id, { deckId: d?.id ?? null, deckName: d?.name ?? null }))
  return (
    <Drawer side="full" title="This seat" rotate={rotate} onClose={onClose}>
      <div className="seat-grid">
        <div className="name-list" role="radiogroup" aria-label="Who sits here">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              className="name-row"
              aria-checked={!guest && seat.name === n}
              onClick={() => {
                setGuest(false)
                pickPlayer(n)
              }}
            >
              {n}
              {!guest && seat.name === n && <Icons.check />}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            className="name-row other"
            aria-checked={guest}
            onClick={() => {
              setGuest(true)
              setFocusGuest(true)
              onGame((g) => updateSeat(g, seat.id, { playerId: null }))
            }}
          >
            Someone else…
            {guest && <Icons.check />}
          </button>
        </div>
        <div className="name-list decks" role="radiogroup" aria-label="Deck">
          <button type="button" role="radio" className="name-row other" aria-checked={!seat.deckId} onClick={() => setDeck(null)}>
            No deck
            {!seat.deckId && <Icons.check />}
          </button>
          {seat.deckId && !decks.some((d) => d.id === seat.deckId) && (
            <button type="button" role="radio" className="name-row" aria-checked onClick={() => {}}>
              {seat.deckName}
              <Icons.check />
            </button>
          )}
          {decks.map((d) => (
            <button key={d.id} type="button" role="radio" className="name-row" aria-checked={seat.deckId === d.id} onClick={() => setDeck(d)}>
              {d.name}
              {seat.deckId === d.id && <Icons.check />}
            </button>
          ))}
          {decks.length === 0 && <span className="name-row faint">No decks on the Decks tab yet</span>}
        </div>
        <div className="seat-side">
          {guest && (
            <input
              className="input"
              value={podNames.includes(seat.name) ? '' : seat.name}
              maxLength={24}
              placeholder="Guest's name"
              aria-label="Guest's name"
              autoFocus={focusGuest}
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => {
                if (!e.target.value.trim()) setName(`Player ${seat.id + 1}`)
              }}
            />
          )}
          <div className="swatches" role="radiogroup" aria-label="Seat colour">
            {(Object.keys(SEAT_COLOURS) as SeatColour[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                className="swatch"
                style={{ background: SEAT_COLOURS[k] }}
                aria-checked={seat.colour === k}
                aria-label={k}
                onClick={() => onGame((g) => updateSeat(g, seat.id, { colour: k }))}
              />
            ))}
          </div>
          <div className="row wrap">
            <button className="chip" aria-pressed={game.first === seat.id} onClick={() => onGame((g) => setFirst(g, seat.id))}>
              1st Goes first
            </button>
            <button className="chip" aria-pressed={seat.flipped} onClick={() => onGame((g) => updateSeat(g, seat.id, { flipped: !seat.flipped }))}>
              ⟲ Flip seat
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}

/** Tile captions: short enough for a narrow seat, with ⚔ left to commander damage. */
const COUNTER_ICON: Record<Counter, string> = { poison: '☠', energy: '⚡', experience: '✦', tax: '🪙' }
const TILE_LABEL: Record<Counter, string> = { ...COUNTER_LABEL, tax: 'Tax' }

/**
 * One counter as a tile split in two: vertical tiles add on the top half and
 * take away on the bottom, like the seat itself; horizontal tiles take away on
 * the left and add on the right. Hold to run. The name and number sit in the
 * middle and let taps through.
 */
function Tile({
  label,
  swatch,
  value,
  lethal,
  axis = 'vertical',
  onDelta,
}: {
  label: string
  swatch?: string
  value: number
  lethal?: boolean
  axis?: 'vertical' | 'horizontal'
  onDelta: (d: number) => void
}) {
  const hold = useHold(onDelta, { holdStep: 1, repeat: 110 })
  return (
    <div className={`ctile ${swatch ? 'tinted' : ''} ${lethal ? 'lethal' : ''}`} style={swatch ? ({ '--tile': swatch } as CSSProperties) : undefined}>
      <button className={`ctile-half plus ${axis}`} {...hold(1)} aria-label={`More ${label}`}>
        <span aria-hidden="true">+</span>
      </button>
      <button className={`ctile-half minus ${axis}`} {...hold(-1)} disabled={value === 0} aria-label={`Less ${label}`}>
        <span aria-hidden="true">−</span>
      </button>
      <div className="ctile-mid">
        <span className="ctile-label">
          {swatch && <i className="swatch-dot" style={{ background: swatch }} aria-hidden="true" />}
          {label}
        </span>
        <output aria-live="polite">{value}</output>
      </div>
    </div>
  )
}

/* ---------- centre menu ---------- */

function Menu({
  game,
  onClose,
  onSetup,
  onReset,
  onPickFirst,
  onUndoPass,
  onEndGame,
  onStats,
  onExit,
}: {
  game: Game
  onClose: () => void
  onSetup: (players: number, startingLife: number) => void
  onReset: () => void
  onPickFirst: () => void
  onUndoPass: () => void
  onEndGame: () => void
  onStats: () => void
  onExit: () => void
}) {
  const passes = game.log.filter((e) => e.kind === 'pass').length
  const [result, setResult] = useState<string | null>(null)
  const roll = (sides: number) => setResult(`d${sides}: ${1 + Math.floor(Math.random() * sides)}`)
  const custom = STARTING_LIFE.includes(game.startingLife as (typeof STARTING_LIFE)[number]) ? null : game.startingLife

  function otherLife() {
    const v = prompt('Starting life', String(game.startingLife))
    if (v === null) return
    const n = Number(v)
    if (!Number.isFinite(n) || n < 1) return
    onSetup(game.players, Math.round(n))
  }

  return (
    <Sheet onClose={onClose} label="Game menu">
      <div className="stack" style={{ gap: 18 }}>
        <h2 className="title" style={{ fontSize: 22 }}>
          Life counter
        </h2>

        <div className="field">
          <label>Players</label>
          <div className="segmented">
            {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => (
              <button key={n} aria-pressed={n === game.players} onClick={() => n !== game.players && onSetup(n, game.startingLife)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Starting life</label>
          <div className="segmented">
            {STARTING_LIFE.map((n) => (
              <button key={n} aria-pressed={n === game.startingLife} onClick={() => n !== game.startingLife && onSetup(game.players, n)}>
                {n}
              </button>
            ))}
            <button aria-pressed={custom !== null} onClick={otherLife}>
              {custom ?? 'Other'}
            </button>
          </div>
        </div>

        <div className="row wrap">
          <button className="btn" onClick={onPickFirst}>
            Who goes first?
          </button>
          <button className="btn" onClick={() => roll(6)}>
            Roll d6
          </button>
          <button className="btn" onClick={() => roll(20)}>
            Roll d20
          </button>
          <button className="btn" onClick={() => setResult(Math.random() < 0.5 ? 'Heads' : 'Tails')}>
            Flip a coin
          </button>
        </div>
        {result && (
          <div className="notice" role="status" style={{ fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
            {result}
          </div>
        )}

        <div className="row wrap">
          <button className="btn" onClick={onUndoPass} disabled={passes === 0} title="Take back the last pass">
            Undo last pass
          </button>
          <button className="btn" onClick={onEndGame} disabled={game.players < 2}>
            End game…
          </button>
          <button className="btn" onClick={onStats}>
            Games &amp; stats
          </button>
        </div>

        <button className="btn danger block" onClick={onReset}>
          Reset game
        </button>

        <p className="small faint">
          Tap the right half of a seat to gain life and the left half to lose it. Hold for ten at a time. Swipe in from the edge of a seat
          that faces the table for commander damage, swipe down from its top edge for poison and the other counters, or tap its
          name to rename or recolour it. Swipe down on a drawer to put it away. The pill under the dice
          passes the turn; turns, life gained and lost, and commander damage are kept for the result. The screen stays on while
          the counter is open.
        </p>

        <button className="btn quiet block" onClick={onExit}>
          Back to the pool
        </button>
      </div>
    </Sheet>
  )
}

/* ---------- keep the screen on ---------- */

/** Holds a screen wake lock while mounted, taking it again when the tab comes back. */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    const grab = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
        if (gone) await lock.release()
      } catch {
        /* low battery, background tab, or not allowed: nothing to do */
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void grab()
    }
    void grab()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])
}
