/**
 * A pod session: one game tracked across several phones, one per player,
 * kept live in a single shared document. Seats are keyed by account id so
 * the record survives people joining in any order; the screen converts it
 * to the ordinary Game (seats numbered by join order) so every control the
 * one-phone counter has works unchanged, and converts changes back as a
 * patch of just what moved.
 */
import { COUNTERS, MAX_PLAYERS, SEAT_COLOURS, newGame, turnOrder, type Counter, type Game, type GameEvent, type Seat, type SeatColour } from './life.js'

export type SessionSeat = {
  name: string
  player_id: string
  colour: SeatColour
  life: number
  counters: Record<Counter, number>
  /** Commander damage taken, keyed by the attacker's account id. */
  commander: Record<string, number>
  ko: boolean
  commander_name: string | null
}

/** A log event with account ids in place of seat numbers. */
export type SessionEvent = Omit<GameEvent, 'seat' | 'from'> & { seat: string; from?: string }

export type LiveSession = {
  id: string
  pod_id: string
  host_id: string
  status: 'open' | 'ended'
  starting_life: number
  created_at: string
  /** Account ids in join order, which is also turn order. */
  order: string[]
  seats: Record<string, SessionSeat>
  monarch: string | null
  initiative: string | null
  first: string | null
  active: string | null
  turn: number
  startedAt: string | null
  log: SessionEvent[]
}

const PALETTE = Object.keys(SEAT_COLOURS) as SeatColour[]

/** A fresh seat for someone joining: starting life and the first colour nobody has. */
export function freshSessionSeat(uid: string, name: string, startingLife: number, taken: SeatColour[] = []): SessionSeat {
  return {
    name,
    player_id: uid,
    colour: PALETTE.find((c) => !taken.includes(c)) ?? PALETTE[taken.length % PALETTE.length],
    life: startingLife,
    counters: { poison: 0, energy: 0, experience: 0, tax: 0 },
    commander: {},
    ko: false,
    commander_name: null,
  }
}

/** What a host writes to start a session. */
export function newSession(podId: string, host: { id: string; name: string }, startingLife: number, now = new Date()): Omit<LiveSession, 'id'> {
  return {
    pod_id: podId,
    host_id: host.id,
    status: 'open',
    starting_life: startingLife,
    created_at: now.toISOString(),
    order: [host.id],
    seats: { [host.id]: freshSessionSeat(host.id, host.name, startingLife) },
    monarch: null,
    initiative: null,
    first: null,
    active: null,
    turn: 0,
    startedAt: null,
    log: [],
  }
}

/**
 * The session as a Game. By default seat i is the i-th account in join order
 * (the rest of the six are empty). `slots` puts join position k at seat
 * slots[k] instead, which handoffGame uses to lay people out clockwise.
 */
export function toGame(s: LiveSession, slots?: number[]): Game {
  const order = s.order.filter((uid) => s.seats[uid]).slice(0, MAX_PLAYERS)
  const idx = (uid: string | null | undefined) => {
    const k = uid ? order.indexOf(uid) : -1
    return k < 0 ? -1 : slots ? slots[k] : k
  }
  const at = (uid: string | null | undefined): number | null => {
    const i = idx(uid)
    return i >= 0 ? i : null
  }
  const base = newGame(Math.max(1, order.length), s.starting_life)
  const seats: Seat[] = base.seats.map((empty, i) => {
    const uid = order[slots ? slots.indexOf(i) : i]
    if (!uid) return empty
    const ss = s.seats[uid]
    const commander: Record<number, number> = {}
    for (const [from, n] of Object.entries(ss.commander ?? {})) {
      const j = idx(from)
      if (j >= 0 && typeof n === 'number') commander[j] = n
    }
    const counters = { poison: 0, energy: 0, experience: 0, tax: 0 }
    for (const c of COUNTERS) counters[c] = typeof ss.counters?.[c] === 'number' ? ss.counters[c] : 0
    return {
      ...empty,
      name: ss.name,
      colour: ss.colour in SEAT_COLOURS ? ss.colour : empty.colour,
      life: ss.life,
      counters,
      commander,
      ko: !!ss.ko,
      playerId: ss.player_id,
      commanderName: ss.commander_name ?? null,
    }
  })
  const log: GameEvent[] = []
  for (const e of s.log ?? []) {
    const seat = idx(e.seat)
    if (seat < 0) continue
    const { seat: _s, from, ...rest } = e
    const ev: GameEvent = { ...rest, seat }
    if (from !== undefined) {
      const f = idx(from)
      if (f >= 0) ev.from = f
    }
    log.push(ev)
  }
  return {
    ...base,
    players: order.length,
    seats,
    monarch: at(s.monarch),
    initiative: at(s.initiative),
    first: at(s.first),
    active: at(s.active),
    turn: s.turn ?? 0,
    startedAt: s.startedAt ?? null,
    log,
  }
}

/**
 * The session as a game for one phone to carry on with: the same totals,
 * counters, damage, markers, turn and log, with players placed around the
 * table so the one-phone clockwise order is the session's join order.
 */
export function handoffGame(s: LiveSession): Game {
  const n = Math.max(1, s.order.filter((uid) => s.seats[uid]).length)
  return toGame(s, turnOrder(n))
}

/** A Game seat back into session shape. */
export function toSessionSeat(seat: Seat, order: string[]): SessionSeat {
  const commander: Record<string, number> = {}
  for (const [j, n] of Object.entries(seat.commander)) {
    const uid = order[Number(j)]
    if (uid && n > 0) commander[uid] = n
  }
  return {
    name: seat.name,
    player_id: seat.playerId ?? order[seat.id],
    colour: seat.colour,
    life: seat.life,
    counters: { ...seat.counters },
    commander,
    ko: seat.ko,
    commander_name: seat.commanderName,
  }
}

export type SessionPatch = {
  /** Dotted field paths for an update, e.g. "seats.<uid>" and the game-level fields that moved. */
  fields: Record<string, unknown>
  /** Log events to append. */
  events: SessionEvent[]
}

/**
 * Just what changed between two Games, as a session update. Seats compare by
 * identity because every mutator copies the seat it touches; game-level
 * fields compare by value.
 */
export function sessionPatch(prev: Game, next: Game, order: string[]): SessionPatch {
  const fields: Record<string, unknown> = {}
  for (let i = 0; i < order.length; i++) if (next.seats[i] !== prev.seats[i]) fields[`seats.${order[i]}`] = toSessionSeat(next.seats[i], order)
  const uid = (i: number | null) => (i === null ? null : (order[i] ?? null))
  for (const k of ['monarch', 'initiative', 'first', 'active'] as const) if (next[k] !== prev[k]) fields[k] = uid(next[k])
  if (next.turn !== prev.turn) fields.turn = next.turn
  if (next.startedAt !== prev.startedAt) fields.startedAt = next.startedAt
  const events: SessionEvent[] = []
  for (const e of next.log.slice(prev.log.length)) {
    const { seat, from, ...rest } = e
    const ev: SessionEvent = { ...rest, seat: order[seat] }
    if (from !== undefined && order[from]) ev.from = order[from]
    events.push(ev)
  }
  return { fields, events }
}

/** Everyone back to the start for the next game, keeping names, colours and commanders. */
export function resetFields(s: LiveSession): Record<string, unknown> {
  const fields: Record<string, unknown> = { monarch: null, initiative: null, first: null, active: null, turn: 0, startedAt: null, log: [] }
  for (const uid of s.order) {
    const seat = s.seats[uid]
    if (!seat) continue
    fields[`seats.${uid}`] = { ...seat, life: s.starting_life, counters: { poison: 0, energy: 0, experience: 0, tax: 0 }, commander: {}, ko: false }
  }
  return fields
}

/** Guard a document from the wire. */
export function parseSession(id: string, raw: unknown): LiveSession | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<LiveSession>
  if (typeof s.pod_id !== 'string' || typeof s.host_id !== 'string' || !Array.isArray(s.order) || !s.seats || typeof s.seats !== 'object') return null
  return {
    id,
    pod_id: s.pod_id,
    host_id: s.host_id,
    status: s.status === 'ended' ? 'ended' : 'open',
    starting_life: typeof s.starting_life === 'number' ? s.starting_life : 40,
    created_at: typeof s.created_at === 'string' ? s.created_at : '',
    order: s.order.filter((x): x is string => typeof x === 'string'),
    seats: s.seats as Record<string, SessionSeat>,
    monarch: typeof s.monarch === 'string' ? s.monarch : null,
    initiative: typeof s.initiative === 'string' ? s.initiative : null,
    first: typeof s.first === 'string' ? s.first : null,
    active: typeof s.active === 'string' ? s.active : null,
    turn: typeof s.turn === 'number' ? s.turn : 0,
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : null,
    log: Array.isArray(s.log) ? (s.log as SessionEvent[]) : [],
  }
}
