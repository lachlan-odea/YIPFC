/**
 * Life counter state: pure functions over a Game, used by the Life screen and
 * tested on their own. Nothing here touches the DOM or storage.
 *
 * Seats are numbered 0..5 and all six always exist in the state, so a seat's
 * name and colour survive dropping the player count and raising it again;
 * `players` says how many are at the table right now.
 */

import type { GameRecord, SeatResult } from './types'

export const MAX_PLAYERS = 6
export const STARTING_LIFE = [20, 25, 30, 40] as const

export const COUNTERS = ['poison', 'energy', 'experience', 'tax'] as const
export type Counter = (typeof COUNTERS)[number]
export const COUNTER_LABEL: Record<Counter, string> = {
  poison: 'Poison',
  energy: 'Energy',
  experience: 'Experience',
  tax: 'Commander tax',
}

/** Lose at ten poison or 21 combat damage from one commander. */
export const LETHAL = { poison: 10, commander: 21 }

export const SEAT_COLOURS = {
  pink: '#ff2fa4',
  cyan: '#28d7f0',
  lime: '#8ee63a',
  violet: '#8a2be2',
  orange: '#ff8a3d',
  gold: '#ffd23f',
  rose: '#ff4d6d',
  blue: '#3f8fd1',
} as const
export type SeatColour = keyof typeof SEAT_COLOURS
const DEFAULT_COLOURS: SeatColour[] = ['pink', 'cyan', 'lime', 'violet', 'orange', 'gold']

export type Seat = {
  id: number
  name: string
  colour: SeatColour
  life: number
  counters: Record<Counter, number>
  /** Commander damage taken, keyed by the attacking seat's id. */
  commander: Record<number, number>
  /** Turn this seat's panel a half-turn from where the layout puts it. */
  flipped: boolean
  /** Knocked out by hand: conceded, or lost to something the counters do not track. */
  ko: boolean
  /** The pod player in this seat, when picked from the pod; null for a guest. */
  playerId: string | null
  /** The commander they are playing, typed in, so results can be tallied against it. */
  commanderName: string | null
  /** Played a Sol Ring on turn one. The table's favourite grudge, so it is worth marking. */
  solRing: boolean
}

/**
 * One thing that happened, with the turn it happened on. Everything the
 * stats report is derived from this log, so nothing is tallied twice.
 */
export type GameEvent = {
  at: number
  turn: number
  seat: number
  kind: 'life' | 'counter' | 'commander' | 'ko' | 'out' | 'back' | 'start' | 'pass'
  /** Applied change for life, counter and commander; 1 / 0 for ko on / off; 1 for a pass that began a new turn. */
  n?: number
  counter?: Counter
  /** Attacker for commander damage; previous active seat for a pass. */
  from?: number
}

export type Game = {
  players: number
  startingLife: number
  /** Always MAX_PLAYERS long; the first `players` are at the table. */
  seats: Seat[]
  monarch: number | null
  initiative: number | null
  /** Who went first this game, from the spinner or set by hand. */
  first: number | null
  /** Turn number: goes up each time play comes back round to whoever went first. 0 until someone starts. */
  turn: number
  /** Whose turn it is. */
  active: number | null
  startedAt: string | null
  log: GameEvent[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function freshSeat(id: number, life: number, prev?: Seat, name?: string): Seat {
  return {
    id,
    name: prev?.name ?? name ?? `Player ${id + 1}`,
    colour: prev?.colour ?? DEFAULT_COLOURS[id],
    life,
    counters: { poison: 0, energy: 0, experience: 0, tax: 0 },
    commander: {},
    flipped: prev?.flipped ?? false,
    ko: false,
    playerId: prev?.playerId ?? null,
    commanderName: prev?.commanderName ?? null,
    solRing: false,
  }
}

/**
 * Start a game. Names and colours carry over from the previous game when
 * there is one; otherwise `names` (say, the pod's players) seed the seats.
 */
export function newGame(players: number, startingLife: number, prev?: Game | null, names: string[] = []): Game {
  const n = clamp(Math.round(players), 1, MAX_PLAYERS)
  const life = clamp(Math.round(startingLife), 1, 999)
  return {
    players: n,
    startingLife: life,
    seats: Array.from({ length: MAX_PLAYERS }, (_, id) => freshSeat(id, life, prev?.seats[id], names[id])),
    monarch: null,
    initiative: null,
    first: null,
    turn: 0,
    active: null,
    startedAt: null,
    log: [],
  }
}

/** The seats at the table, in seat order. */
export const activeSeats = (game: Game): Seat[] => game.seats.slice(0, game.players)

/** Everyone at the table except `seatId`. */
export const opponents = (game: Game, seatId: number): Seat[] => activeSeats(game).filter((s) => s.id !== seatId)

/** True once anything has changed since the starting totals. */
export function inProgress(game: Game): boolean {
  return (
    game.monarch !== null ||
    game.initiative !== null ||
    activeSeats(game).some(
      (s) =>
        s.ko || s.solRing || s.life !== game.startingLife || COUNTERS.some((c) => s.counters[c] > 0) || Object.values(s.commander).some((n) => n > 0),
    )
  )
}

function mapSeat(game: Game, seatId: number, fn: (s: Seat) => Seat): Game {
  return { ...game, seats: game.seats.map((s) => (s.id === seatId ? fn(s) : s)) }
}

const stamp = (game: Game, seat: number, e: Omit<GameEvent, 'at' | 'turn' | 'seat'>): GameEvent => ({ at: Date.now(), turn: game.turn, seat, ...e })

/**
 * Change one seat and log it, plus an "out" or "back" event when the change
 * takes the seat across the line, so the turn they were eliminated is known.
 */
function change(game: Game, seatId: number, fn: (s: Seat) => Seat, event: Omit<GameEvent, 'at' | 'turn' | 'seat'> | null): Game {
  const before = game.seats.find((s) => s.id === seatId)
  if (!before) return game
  const next = mapSeat(game, seatId, fn)
  const after = next.seats.find((s) => s.id === seatId)!
  const log = [...game.log]
  if (event) log.push(stamp(game, seatId, event))
  const wasDead = isDead(before)
  const nowDead = isDead(after)
  if (!wasDead && nowDead) log.push(stamp(game, seatId, { kind: 'out' }))
  if (wasDead && !nowDead) log.push(stamp(game, seatId, { kind: 'back' }))
  return { ...next, log }
}

export function adjustLife(game: Game, seatId: number, delta: number): Game {
  const seat = game.seats.find((s) => s.id === seatId)
  if (!seat) return game
  const applied = clamp(seat.life + delta, -999, 999) - seat.life
  if (applied === 0) return game
  return change(game, seatId, (s) => ({ ...s, life: s.life + applied }), { kind: 'life', n: applied })
}

/** Counters never go below zero; the returned game reflects the clamped change. */
export function adjustCounter(game: Game, seatId: number, counter: Counter, delta: number): Game {
  const seat = game.seats.find((s) => s.id === seatId)
  if (!seat) return game
  const applied = clamp(seat.counters[counter] + delta, 0, 999) - seat.counters[counter]
  if (applied === 0) return game
  return change(game, seatId, (s) => ({ ...s, counters: { ...s.counters, [counter]: s.counters[counter] + applied } }), { kind: 'counter', counter, n: applied })
}

/**
 * Commander damage dealt to `seatId` by `fromId`. Combat damage is also life
 * loss, so the seat's life moves by the same (clamped) amount unless
 * `alsoLife` is false, for corrections.
 */
export function adjustCommander(game: Game, seatId: number, fromId: number, delta: number, alsoLife = true): Game {
  const seat = game.seats.find((s) => s.id === seatId)
  if (!seat) return game
  const before = seat.commander[fromId] ?? 0
  const after = clamp(before + delta, 0, 999)
  const applied = after - before
  if (applied === 0) return game
  const next = change(game, seatId, (s) => ({ ...s, commander: { ...s.commander, [fromId]: after } }), { kind: 'commander', from: fromId, n: applied })
  return alsoLife ? adjustLife(next, seatId, -applied) : next
}

export function updateSeat(game: Game, seatId: number, patch: Partial<Pick<Seat, 'name' | 'colour' | 'flipped' | 'playerId' | 'commanderName'>>): Game {
  return mapSeat(game, seatId, (s) => ({ ...s, ...patch }))
}

/** The crown passes to the seat, or leaves the table if it already has it. */
export function toggleMonarch(game: Game, seatId: number): Game {
  return { ...game, monarch: game.monarch === seatId ? null : seatId }
}

export function toggleInitiative(game: Game, seatId: number): Game {
  return { ...game, initiative: game.initiative === seatId ? null : seatId }
}

/** Mark (or unmark) a turn-one Sol Ring. Per seat: more than one player can manage it. */
export function toggleSolRing(game: Game, seatId: number): Game {
  return mapSeat(game, seatId, (s) => ({ ...s, solRing: !s.solRing }))
}

/** Mark who goes first; the same seat again clears it. */
export function setFirst(game: Game, seatId: number | null): Game {
  return { ...game, first: game.first === seatId ? null : seatId }
}

/** Knock a seat out by hand, or let them back in. */
export function toggleKO(game: Game, seatId: number): Game {
  const seat = game.seats.find((s) => s.id === seatId)
  if (!seat) return game
  return change(game, seatId, (s) => ({ ...s, ko: !s.ko }), { kind: 'ko', n: seat.ko ? 0 : 1 })
}

export const commanderTotal = (seat: Seat): number => Object.values(seat.commander).reduce((n, d) => n + d, 0)

/** Out of the game: knocked out by hand, no life, ten poison, or lethal damage from one commander. */
export function isDead(seat: Seat): boolean {
  return seat.ko || seat.life <= 0 || seat.counters.poison >= LETHAL.poison || Object.values(seat.commander).some((d) => d >= LETHAL.commander)
}

/** Seats still in the game. */
export const alive = (game: Game): Seat[] => activeSeats(game).filter((s) => !isDead(s))

/** One player left standing (or none), with at least two at the table. */
export const isOver = (game: Game): boolean => game.players > 1 && alive(game).length <= 1

/* ---------- turns ---------- */

/**
 * Seat ids clockwise around the table, starting from the bottom of the phone:
 * up the left side, across the top, down the right. Play passes to the left,
 * which is clockwise seen from above.
 */
export function turnOrder(players: number): number[] {
  const lay = layout(players)
  const cx = (lay.cols + 2) / 2
  const cy = (lay.rows + 2) / 2
  const angle = (c: Cell) => {
    const dx = c.col + c.colSpan / 2 - cx
    const dy = c.row + c.rowSpan / 2 - cy
    const a = Math.atan2(-dx, dy) // 0 at the bottom, growing towards the left
    return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  }
  return lay.cells
    .slice()
    .sort((a, b) => angle(a) - angle(b))
    .map((c) => c.seat)
}

/** Turn 1 begins with `seatId`; on a game already under way this only hands them the turn. */
export function startTurns(game: Game, seatId: number, now = Date.now()): Game {
  if (game.turn > 0) return { ...game, first: seatId, active: seatId }
  return {
    ...game,
    first: seatId,
    active: seatId,
    turn: 1,
    startedAt: new Date(now).toISOString(),
    log: [...game.log, { at: now, turn: 1, seat: seatId, kind: 'start' }],
  }
}

/**
 * The next living seat clockwise takes the turn. The turn number only goes up
 * when play comes back round to the first player's place (whether or not
 * they are still in). Before anyone has started, starts with whoever goes first.
 */
export function passTurn(game: Game, now = Date.now()): Game {
  if (game.active === null) return startTurns(game, game.first ?? turnOrder(game.players)[0], now)
  if (isOver(game)) return game
  const order = turnOrder(game.players)
  const i = order.indexOf(game.active)
  const firstAt = order.indexOf(game.first ?? order[0])
  let next = game.active
  let newRound = false
  for (let k = 1; k <= order.length; k++) {
    const at = (i + k) % order.length
    if (at === firstAt) newRound = true
    if (!isDead(game.seats[order[at]])) {
      next = order[at]
      break
    }
  }
  const turn = game.turn + (newRound ? 1 : 0)
  return { ...game, active: next, turn, log: [...game.log, { at: now, turn, seat: next, kind: 'pass', from: game.active, n: newRound ? 1 : 0 }] }
}

/** Take back the last pass, for when someone tapped it twice. */
export function undoPass(game: Game): Game {
  let i = game.log.length - 1
  while (i >= 0 && game.log[i].kind !== 'pass') i--
  if (i < 0) return game
  const ev = game.log[i]
  return { ...game, active: ev.from ?? game.active, turn: Math.max(1, game.turn - (ev.n ?? 0)), log: game.log.filter((_, k) => k !== i) }
}

/* ---------- stats ---------- */

export type SeatStats = {
  gained: number
  lost: number
  /** Commander damage dealt to others and taken from them. */
  dealt: number
  taken: number
  turns: number
  /** The turn they went out, or null if still in. */
  outTurn: number | null
}

/** Everything the log says about one seat. */
export function seatStats(game: Game, seatId: number): SeatStats {
  const s: SeatStats = { gained: 0, lost: 0, dealt: 0, taken: 0, turns: 0, outTurn: null }
  for (const e of game.log) {
    const n = e.n ?? 0
    if (e.kind === 'life' && e.seat === seatId) {
      if (n > 0) s.gained += n
      else s.lost -= n
    } else if (e.kind === 'commander') {
      if (e.from === seatId) s.dealt += n
      if (e.seat === seatId) s.taken += n
    } else if ((e.kind === 'start' || e.kind === 'pass') && e.seat === seatId) s.turns++
    else if (e.kind === 'out' && e.seat === seatId) s.outTurn = e.turn
    else if (e.kind === 'back' && e.seat === seatId) s.outTurn = null
  }
  return s
}

/** The finished game as a record to keep: who played what, who won, and the numbers behind it. */
export function gameRecord(game: Game, meta: { id: string; pod_id: string | null; created_by: string; winner: number | null; now?: number }): GameRecord {
  const ended = new Date(meta.now ?? Date.now()).toISOString()
  const players: SeatResult[] = activeSeats(game).map((seat) => {
    const st = seatStats(game, seat.id)
    return {
      seat: seat.id,
      name: seat.name,
      player_id: seat.playerId,
      commander: seat.commanderName,
      colour: seat.colour,
      won: seat.id === meta.winner,
      out_turn: st.outTurn,
      final_life: seat.life,
      life_gained: st.gained,
      life_lost: st.lost,
      commander_dealt: st.dealt,
      commander_taken: st.taken,
      poison: seat.counters.poison,
      turns: st.turns,
    }
  })
  return {
    id: meta.id,
    pod_id: meta.pod_id,
    created_by: meta.created_by,
    played_at: game.startedAt ?? ended,
    ended_at: ended,
    turns: game.turn,
    starting_life: game.startingLife,
    winner_seat: meta.winner,
    players,
  }
}

export type Tally = {
  games: number
  wins: number
  /** 0..1, or null with no games. */
  winRate: number | null
  avgTurns: number | null
  avgGained: number | null
  avgLost: number | null
  avgDealt: number | null
  /** Average turn eliminated on, over the games that were lost by elimination. */
  avgOutTurn: number | null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Roll up every seat result that `pick` accepts across the records. */
export function tally(records: GameRecord[], pick: (r: SeatResult, g: GameRecord) => boolean): Tally {
  const hits: Array<{ r: SeatResult; g: GameRecord }> = []
  for (const g of records) for (const r of g.players) if (pick(r, g)) hits.push({ r, g })
  const wins = hits.filter((h) => h.r.won).length
  const outs = hits.map((h) => h.r.out_turn).filter((t): t is number => t !== null)
  return {
    games: hits.length,
    wins,
    winRate: hits.length ? wins / hits.length : null,
    avgTurns: mean(hits.map((h) => h.g.turns)),
    avgGained: mean(hits.map((h) => h.r.life_gained)),
    avgLost: mean(hits.map((h) => h.r.life_lost)),
    avgDealt: mean(hits.map((h) => h.r.commander_dealt)),
    avgOutTurn: mean(outs),
  }
}

/** Commanders are typed by hand, so "Atraxa" and "atraxa " are the same one. */
export const commanderKey = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/* ---------- Elo ---------- */

export const ELO_START = 1000
const ELO_K = 32

/**
 * Finishing order for one game, 1 being best, with ties. The winner comes
 * first; anyone still in at the end but not the winner shares the next
 * place; everyone else ranks by how long they lasted.
 */
export function placements(record: GameRecord): Map<number, number> {
  const rank = (r: SeatResult) => (r.won ? [0, 0] : r.out_turn === null ? [1, 0] : [2, -r.out_turn])
  const sorted = record.players.slice().sort((a, b) => {
    const [a0, a1] = rank(a)
    const [b0, b1] = rank(b)
    return a0 - b0 || a1 - b1
  })
  const out = new Map<number, number>()
  let place = 0
  let prev: string | null = null
  sorted.forEach((r, i) => {
    const k = rank(r).join(':')
    if (k !== prev) place = i + 1
    prev = k
    out.set(r.seat, place)
  })
  return out
}

export type Rating = { rating: number; games: number }

/**
 * Elo across saved games, oldest first, as a round-robin inside each game:
 * every pair of players is scored as a match (win, loss or tie by finishing
 * place) with K shared between the opponents, so a four-player win is worth
 * about the same as a two-player one. `key` names what is being rated for
 * a seat (a commander, a player); seats without one sit the game out.
 */
export function eloRatings(records: GameRecord[], key: (r: SeatResult) => string | null, k = ELO_K): Map<string, Rating> {
  const ratings = new Map<string, Rating>()
  const get = (id: string) => ratings.get(id) ?? { rating: ELO_START, games: 0 }
  const ordered = records.slice().sort((a, b) => a.ended_at.localeCompare(b.ended_at))
  for (const g of ordered) {
    const places = placements(g)
    const seats = g.players.map((r) => ({ id: key(r), place: places.get(r.seat) ?? 1 })).filter((x): x is { id: string; place: number } => !!x.id)
    if (seats.length < 2) continue
    const before = new Map(seats.map((s) => [s.id, get(s.id).rating]))
    const delta = new Map<string, number>()
    const share = k / (seats.length - 1)
    for (let i = 0; i < seats.length; i++)
      for (let j = i + 1; j < seats.length; j++) {
        const a = seats[i]
        const b = seats[j]
        if (a.id === b.id) continue
        const score = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5
        const expected = 1 / (1 + 10 ** ((before.get(b.id)! - before.get(a.id)!) / 400))
        const d = share * (score - expected)
        delta.set(a.id, (delta.get(a.id) ?? 0) + d)
        delta.set(b.id, (delta.get(b.id) ?? 0) - d)
      }
    for (const id of new Set(seats.map((s) => s.id))) {
      const cur = get(id)
      ratings.set(id, { rating: cur.rating + (delta.get(id) ?? 0), games: cur.games + 1 })
    }
  }
  return ratings
}

export const commanderTally = (records: GameRecord[], commander: string): Tally => {
  const key = commanderKey(commander)
  return tally(records, (r) => !!key && commanderKey(r.commander) === key)
}
export const playerTally = (records: GameRecord[], playerId: string): Tally => tally(records, (r) => r.player_id === playerId)

/* ---------- last words ---------- */

/** Shown under the skull when a seat goes down. Short, so they fit a side seat. */
export const LAST_WORDS: readonly string[] = [
  "I'll be back.",
  "'Tis but a scratch.",
  "I'm not dead yet!",
  "It's just a flesh wound.",
  'I regret nothing!',
  'Game over, man! Game over!',
  'Hasta la vista, baby.',
  'Fly, you fools.',
  'You shall not pass.',
  'Et tu, Brute?',
  'So long, and thanks for all the fish.',
  'Oh no, not again.',
  'Rosebud.',
  "I'm melting! Melting!",
  "He's dead, Jim.",
  'I have been, and always shall be, your friend.',
  "Mr. Stark, I don't feel so good.",
  "I don't want to go.",
  'Not like this.',
  'Inconceivable!',
  'Mostly dead is slightly alive.',
  'Goodnight, sweet prince.',
  'Hodor.',
  'What is dead may never die.',
  'Valar morghulis.',
  'You died.',
  'Wasted.',
  'Fatality.',
  'Snake? Snake?! SNAAAKE!',
  'Press F to pay respects.',
  'My precious…',
  'I am Groot.',
  'Say hello to my little friend!',
  'This is fine.',
  'Tell my wife I said… hello.',
  'So this is how liberty dies.',
  'The cake is a lie.',
  'Avenge me!',
]

/** The n-th last words, wrapping, so any random integer picks one. */
export const lastWords = (n: number): string => LAST_WORDS[((Math.floor(n) % LAST_WORDS.length) + LAST_WORDS.length) % LAST_WORDS.length]

/* ---------- layout ---------- */

/**
 * Where each seat sits on a portrait phone and which way its panel faces.
 * `rotate` is the clockwise turn that makes the panel read upright for the
 * person on that edge: 90 for the left side, 270 for the right, 180 for the
 * far end, 0 for the player holding the phone.
 */
export type Cell = { seat: number; row: number; col: number; rowSpan: number; colSpan: number; rotate: 0 | 90 | 180 | 270 }
export type Layout = { rows: number; cols: number; cells: Cell[] }

const cell = (seat: number, row: number, col: number, rotate: Cell['rotate'], rowSpan = 1, colSpan = 1): Cell => ({
  seat,
  row,
  col,
  rowSpan,
  colSpan,
  rotate,
})

/** Two columns of side-facing seats, left then right, row by row. */
const sides = (count: number): Cell[] =>
  Array.from({ length: count }, (_, i) => cell(i, Math.floor(i / 2) + 1, (i % 2) + 1, i % 2 === 0 ? 90 : 270))

export function layout(players: number): Layout {
  switch (clamp(Math.round(players), 1, MAX_PLAYERS)) {
    case 1:
      return { rows: 1, cols: 1, cells: [cell(0, 1, 1, 0)] }
    case 2:
      return { rows: 2, cols: 1, cells: [cell(0, 1, 1, 180), cell(1, 2, 1, 0)] }
    case 3:
      return { rows: 2, cols: 2, cells: [...sides(2), cell(2, 2, 1, 0, 1, 2)] }
    case 4:
      return { rows: 2, cols: 2, cells: sides(4) }
    case 5:
      return { rows: 3, cols: 2, cells: [...sides(4), cell(4, 3, 1, 0, 1, 2)] }
    default:
      return { rows: 3, cols: 2, cells: sides(6) }
  }
}

export type Side = 'left' | 'right'

/**
 * Which of a seat's own side edges face another seat rather than the edge of
 * the phone. Phone edges are where the system's back and home gestures live,
 * so swipes should start from these instead. Empty for a seat that spans the
 * whole width (two players, or the bottom seat with three or five).
 */
export function innerSides(cell: Cell, lay: Layout, rotate: Cell['rotate'] = cell.rotate): Side[] {
  const above = cell.row > 1
  const below = cell.row + cell.rowSpan - 1 < lay.rows
  const leftOf = cell.col > 1
  const rightOf = cell.col + cell.colSpan - 1 < lay.cols
  // A seat turned 90 has its own left along the phone's top; 270 the reverse; 180 swaps left and right.
  const [l, r] = rotate === 90 ? [above, below] : rotate === 270 ? [below, above] : rotate === 180 ? [rightOf, leftOf] : [leftOf, rightOf]
  return [...(l ? (['left'] as const) : []), ...(r ? (['right'] as const) : [])]
}

/* ---------- persistence ---------- */

/** Rebuild a Game from stored JSON, or null if it is not one we recognise. */
export function parseGame(raw: unknown): Game | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<Game>
  if (typeof g.players !== 'number' || typeof g.startingLife !== 'number' || !Array.isArray(g.seats)) return null
  if (g.seats.length !== MAX_PLAYERS) return null
  const seats: Seat[] = []
  for (let id = 0; id < MAX_PLAYERS; id++) {
    const s = g.seats[id] as Partial<Seat> | undefined
    if (!s || typeof s.life !== 'number' || typeof s.name !== 'string') return null
    const colour = s.colour && s.colour in SEAT_COLOURS ? s.colour : DEFAULT_COLOURS[id]
    const counters = { poison: 0, energy: 0, experience: 0, tax: 0 }
    for (const c of COUNTERS) counters[c] = typeof s.counters?.[c] === 'number' ? s.counters[c] : 0
    const commander: Record<number, number> = {}
    for (const [k, v] of Object.entries(s.commander ?? {})) if (typeof v === 'number') commander[Number(k)] = v
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    seats.push({
      id,
      name: s.name,
      colour,
      life: s.life,
      counters,
      commander,
      flipped: !!s.flipped,
      ko: !!s.ko,
      playerId: str(s.playerId),
      // Saves from before the field was a commander name carried a deck name instead.
      commanderName: str(s.commanderName) ?? str((s as { deckName?: unknown }).deckName),
      solRing: !!s.solRing,
    })
  }
  const log: GameEvent[] = Array.isArray(g.log)
    ? (g.log as unknown[]).filter((e): e is GameEvent => {
        const x = e as Partial<GameEvent>
        return !!x && typeof x.at === 'number' && typeof x.turn === 'number' && typeof x.seat === 'number' && typeof x.kind === 'string'
      })
    : []
  return {
    players: clamp(Math.round(g.players), 1, MAX_PLAYERS),
    startingLife: g.startingLife,
    seats,
    monarch: typeof g.monarch === 'number' ? g.monarch : null,
    initiative: typeof g.initiative === 'number' ? g.initiative : null,
    first: typeof g.first === 'number' ? g.first : null,
    turn: typeof g.turn === 'number' ? g.turn : 0,
    active: typeof g.active === 'number' ? g.active : null,
    startedAt: typeof g.startedAt === 'string' ? g.startedAt : null,
    log,
  }
}
