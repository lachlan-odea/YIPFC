import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LAST_WORDS,
  MAX_PLAYERS,
  LETHAL,
  lastWords,
  activeSeats,
  adjustCommander,
  adjustCounter,
  adjustLife,
  alive,
  commanderTotal,
  ELO_START,
  commanderKey,
  commanderTally,
  eloRatings,
  lifetime,
  placements,
  gameRecord,
  isOver,
  passTurn,
  playerTally,
  seatStats,
  startTurns,
  tally,
  turnOrder,
  undoPass,
  inProgress,
  innerSides,
  isDead,
  layout,
  newGame,
  opponents,
  parseGame,
  setFirst,
  toggleInitiative,
  toggleKO,
  toggleMonarch,
  toggleSolRing,
  updateSeat,
} from '../dist-tests/life.js'

test('newGame seats everyone at the starting life and keeps all six seats around', () => {
  const g = newGame(4, 40, null, ['Lachlan', 'Sam'])
  assert.equal(g.players, 4)
  assert.equal(g.seats.length, MAX_PLAYERS)
  assert.equal(activeSeats(g).length, 4)
  assert.deepEqual(
    activeSeats(g).map((s) => s.name),
    ['Lachlan', 'Sam', 'Player 3', 'Player 4'],
  )
  assert.ok(g.seats.every((s) => s.life === 40))
  assert.equal(new Set(activeSeats(g).map((s) => s.colour)).size, 4, 'distinct colours')
  assert.equal(inProgress(g), false)
})

test('newGame clamps players and life and carries names, colours and flips over', () => {
  let g = newGame(9, 0)
  assert.equal(g.players, MAX_PLAYERS)
  assert.equal(g.startingLife, 1)
  g = updateSeat(newGame(2, 20), 1, { name: 'Jo', colour: 'lime', flipped: true })
  g = adjustLife(g, 1, -7)
  const next = newGame(3, 40, g)
  assert.equal(next.seats[1].name, 'Jo')
  assert.equal(next.seats[1].colour, 'lime')
  assert.equal(next.seats[1].flipped, true)
  assert.equal(next.seats[1].life, 40)
  assert.equal(next.monarch, null)
})

test('life changes are per seat and the game counts as in progress', () => {
  let g = newGame(2, 20)
  g = adjustLife(g, 0, -3)
  g = adjustLife(g, 0, 1)
  assert.equal(g.seats[0].life, 18)
  assert.equal(g.seats[1].life, 20)
  assert.equal(inProgress(g), true)
  assert.equal(isDead(g.seats[0]), false)
  assert.equal(isDead(adjustLife(g, 0, -18).seats[0]), true)
})

test('counters never go below zero and ten poison is lethal', () => {
  let g = newGame(2, 20)
  g = adjustCounter(g, 0, 'poison', -4)
  assert.equal(g.seats[0].counters.poison, 0)
  g = adjustCounter(g, 0, 'poison', 9)
  assert.equal(isDead(g.seats[0]), false)
  g = adjustCounter(g, 0, 'poison', 1)
  assert.equal(g.seats[0].counters.poison, LETHAL.poison)
  assert.equal(isDead(g.seats[0]), true)
  assert.equal(g.seats[0].life, 20, 'poison does not touch life')
})

test('commander damage also comes off life, clamps at zero, and 21 is lethal', () => {
  let g = newGame(4, 40)
  g = adjustCommander(g, 0, 1, 5)
  assert.equal(g.seats[0].commander[1], 5)
  assert.equal(g.seats[0].life, 35)
  // Correcting an over-count gives the life back, but only what was applied.
  g = adjustCommander(g, 0, 1, -8)
  assert.equal(g.seats[0].commander[1], 0)
  assert.equal(g.seats[0].life, 40)
  g = adjustCommander(g, 0, 2, 21)
  assert.equal(commanderTotal(g.seats[0]), 21)
  assert.equal(isDead(g.seats[0]), true)
  assert.equal(g.seats[0].life, 19)
  // Without the life link, only the tally moves.
  const h = adjustCommander(newGame(2, 20), 1, 0, 3, false)
  assert.equal(h.seats[1].commander[0], 3)
  assert.equal(h.seats[1].life, 20)
  // Unknown seat: no change.
  assert.equal(adjustCommander(g, 42, 1, 3), g)
})

test('opponents are the other seats at the table only', () => {
  const g = newGame(3, 40)
  assert.deepEqual(
    opponents(g, 1).map((s) => s.id),
    [0, 2],
  )
})

test('monarch and initiative pass around and toggle off', () => {
  let g = newGame(4, 40)
  g = toggleMonarch(g, 2)
  assert.equal(g.monarch, 2)
  g = toggleMonarch(g, 3)
  assert.equal(g.monarch, 3)
  g = toggleMonarch(g, 3)
  assert.equal(g.monarch, null)
  g = toggleInitiative(g, 0)
  assert.equal(g.initiative, 0)
  assert.equal(inProgress(g), true)
})

test('a turn-one Sol Ring is marked per seat, counts as play, and does not outlive the game', () => {
  let g = newGame(4, 40)
  assert.ok(g.seats.every((s) => s.solRing === false))
  g = toggleSolRing(g, 1)
  g = toggleSolRing(g, 3)
  assert.equal(g.seats[1].solRing, true)
  assert.equal(g.seats[3].solRing, true, 'two seats can both have one')
  assert.equal(g.seats[0].solRing, false)
  assert.equal(inProgress(g), true)
  assert.equal(toggleSolRing(g, 1).seats[1].solRing, false, 'same seat again clears it')
  assert.equal(parseGame(JSON.parse(JSON.stringify(g))).seats[3].solRing, true)
  assert.equal(newGame(4, 40, g).seats[1].solRing, false)
})

test('the first player sticks until cleared or a new game', () => {
  let g = newGame(4, 40)
  assert.equal(g.first, null)
  g = setFirst(g, 3)
  assert.equal(g.first, 3)
  assert.equal(inProgress(g), false, 'choosing who starts is not yet a game in progress')
  assert.equal(setFirst(g, 1).first, 1)
  assert.equal(setFirst(g, 3).first, null, 'same seat again clears it')
  assert.equal(newGame(4, 40, g).first, null)
  assert.equal(parseGame(JSON.parse(JSON.stringify(g))).first, 3)
})

test('a seat can be knocked out by hand at any life total, and let back in', () => {
  let g = newGame(4, 40)
  assert.equal(isDead(g.seats[2]), false)
  g = toggleKO(g, 2)
  assert.equal(g.seats[2].ko, true)
  assert.equal(g.seats[2].life, 40, 'life is untouched')
  assert.equal(isDead(g.seats[2]), true)
  assert.equal(inProgress(g), true)
  g = toggleKO(g, 2)
  assert.equal(isDead(g.seats[2]), false)
  // A new game clears it.
  assert.equal(newGame(4, 40, toggleKO(g, 2)).seats[2].ko, false)
})

test('last words are short, non-empty, and any integer picks one', () => {
  assert.ok(LAST_WORDS.length >= 20)
  for (const w of LAST_WORDS) {
    assert.equal(w, w.trim())
    assert.ok(w.length > 0 && w.length <= 48, w)
  }
  assert.equal(lastWords(0), LAST_WORDS[0])
  assert.equal(lastWords(LAST_WORDS.length), LAST_WORDS[0])
  assert.equal(lastWords(-1), LAST_WORDS[LAST_WORDS.length - 1])
  assert.equal(lastWords(7.9), LAST_WORDS[7])
})

test('layouts seat everyone once and face the sides of the phone', () => {
  for (let n = 1; n <= MAX_PLAYERS; n++) {
    const l = layout(n)
    assert.equal(l.cells.length, n, `${n} players`)
    assert.deepEqual(
      l.cells.map((c) => c.seat).sort(),
      Array.from({ length: n }, (_, i) => i),
    )
    // Every cell fits the grid and no two overlap.
    const taken = new Set()
    for (const c of l.cells) {
      for (let r = c.row; r < c.row + c.rowSpan; r++)
        for (let k = c.col; k < c.col + c.colSpan; k++) {
          assert.ok(r >= 1 && r <= l.rows && k >= 1 && k <= l.cols, `cell inside grid for ${n}`)
          assert.ok(!taken.has(`${r},${k}`), `no overlap for ${n}`)
          taken.add(`${r},${k}`)
        }
    }
    assert.equal(taken.size, l.rows * l.cols, `grid is full for ${n}`)
  }
  assert.deepEqual(
    layout(2).cells.map((c) => c.rotate),
    [180, 0],
  )
  assert.deepEqual(
    layout(4).cells.map((c) => c.rotate),
    [90, 270, 90, 270],
  )
  const five = layout(5)
  assert.equal(five.cells[4].rotate, 0)
  assert.equal(five.cells[4].colSpan, 2)
})

test('innerSides names the side edges that face another seat, not the phone edge', () => {
  const four = layout(4)
  // Left column turned 90: own left is along the phone's top, own right along its bottom.
  assert.deepEqual(innerSides(four.cells[0], four), ['right'], 'top-left faces the row below with its right')
  assert.deepEqual(innerSides(four.cells[2], four), ['left'], 'bottom-left faces the row above with its left')
  assert.deepEqual(innerSides(four.cells[1], four), ['left'], 'top-right (270) faces the row below with its left')
  assert.deepEqual(innerSides(four.cells[3], four), ['right'])
  // A flipped seat swaps which edge is which.
  assert.deepEqual(innerSides(four.cells[0], four, 270), ['left'])
  const six = layout(6)
  assert.deepEqual(innerSides(six.cells[2], six), ['left', 'right'], 'middle row has seats on both sides')
  assert.deepEqual(innerSides(six.cells[4], six), ['left'])
  // Full-width seats have no inner side.
  const two = layout(2)
  assert.deepEqual(innerSides(two.cells[0], two), [])
  assert.deepEqual(innerSides(two.cells[1], two), [])
  const three = layout(3)
  assert.deepEqual(innerSides(three.cells[2], three), [])
  assert.deepEqual(innerSides(layout(1).cells[0], layout(1)), [])
})

test('turn order runs clockwise from the bottom of the phone', () => {
  assert.deepEqual(turnOrder(1), [0])
  assert.deepEqual(turnOrder(2), [1, 0], 'bottom seat, then the one opposite')
  assert.deepEqual(turnOrder(3), [2, 0, 1], 'bottom, up the left, then the right')
  assert.deepEqual(turnOrder(4), [2, 0, 1, 3])
  assert.deepEqual(turnOrder(5), [4, 2, 0, 1, 3])
  assert.deepEqual(turnOrder(6), [4, 2, 0, 1, 3, 5])
})

test('turns start with the chosen seat and pass clockwise, skipping the dead', () => {
  let g = newGame(4, 40)
  assert.equal(g.turn, 0)
  assert.equal(g.active, null)
  g = startTurns(g, 2, 1000)
  assert.equal(g.active, 2)
  assert.equal(g.first, 2)
  assert.equal(g.turn, 1)
  assert.equal(g.startedAt, new Date(1000).toISOString())
  g = passTurn(g)
  assert.equal(g.active, 0)
  assert.equal(g.turn, 1, 'still the first turn until play comes back round')
  g = toggleKO(g, 1)
  g = passTurn(g)
  assert.equal(g.active, 3, 'seat 1 is out, so play skips to 3')
  assert.equal(g.turn, 1)
  g = passTurn(g)
  assert.equal(g.active, 2)
  assert.equal(g.turn, 2, 'back round to the first player: turn two')
  // The round still ticks over when the first player is out.
  g = toggleKO(g, 2)
  g = passTurn(g) // -> 0
  g = passTurn(g) // -> 3
  assert.equal(g.turn, 2)
  g = passTurn(g) // past seat 2's place -> 0
  assert.equal(g.active, 0)
  assert.equal(g.turn, 3)
  // Spinning again mid-game only hands over the turn.
  const again = startTurns(g, 0)
  assert.equal(again.turn, 3)
  assert.equal(again.active, 0)
  // Before anyone has started, a pass starts with whoever goes first.
  const fresh = passTurn(newGame(4, 40))
  assert.equal(fresh.turn, 1)
  assert.equal(fresh.active, 2)
  // Once the game is over, passing does nothing.
  let done = startTurns(newGame(2, 20), 1)
  done = toggleKO(done, 0)
  assert.equal(isOver(done), true)
  assert.equal(passTurn(done), done)
})

test('undoPass takes back the last pass only, and the turn number with it', () => {
  let g = startTurns(newGame(3, 40), 2)
  g = passTurn(g) // 0, turn 1
  g = passTurn(g) // 1, turn 1
  g = passTurn(g) // 2, turn 2
  assert.equal(g.active, 2)
  assert.equal(g.turn, 2)
  g = undoPass(g)
  assert.equal(g.active, 1)
  assert.equal(g.turn, 1)
  g = undoPass(g)
  assert.equal(g.active, 0)
  assert.equal(g.turn, 1)
  g = undoPass(g)
  assert.equal(g.active, 2)
  assert.equal(g.turn, 1)
  assert.equal(undoPass(g), g, 'nothing left to undo')
})

test('the log drives per-seat stats: life, commander damage, turns, and the turn a seat went out', () => {
  let g = startTurns(newGame(3, 20), 0)
  g = adjustLife(g, 0, 3)
  g = adjustLife(g, 0, -5)
  g = adjustLife(g, 0, 0)
  g = adjustCommander(g, 0, 1, 4)
  g = passTurn(g)
  g = passTurn(g)
  g = passTurn(g) // back to seat 0: turn 2
  g = adjustLife(g, 0, -14) // 20 + 3 - 5 - 4 - 14 = 0: out on turn 2
  const s0 = seatStats(g, 0)
  assert.equal(s0.gained, 3)
  assert.equal(s0.lost, 23, 'commander damage counts as life lost too')
  assert.equal(s0.taken, 4)
  assert.equal(s0.dealt, 0)
  assert.equal(s0.turns, 2)
  assert.equal(s0.outTurn, 2)
  assert.equal(seatStats(g, 1).dealt, 4)
  assert.equal(seatStats(g, 1).turns, 1)
  // Coming back clears the elimination; a K.O. logs one again.
  g = adjustLife(g, 0, 1)
  assert.equal(seatStats(g, 0).outTurn, null)
  g = toggleKO(g, 0)
  assert.equal(seatStats(g, 0).outTurn, 2)
  assert.equal(g.log.filter((e) => e.kind === 'ko').length, 1)
  assert.equal(alive(g).length, 2)
})

test('gameRecord captures the table, and tallies roll it up by commander and player', () => {
  let g = startTurns(newGame(2, 20), 1, 5000)
  g = updateSeat(g, 0, { playerId: 'p-a', commanderName: 'Atraxa, Praetors\' Voice' })
  g = updateSeat(g, 1, { playerId: 'p-b', commanderName: 'Krenko' })
  g = adjustLife(g, 0, -20)
  g = passTurn(g)
  const rec = gameRecord(g, { id: 'g1', pod_id: 'pod', created_by: 'p-b', winner: 1, now: 65000 })
  assert.equal(rec.played_at, new Date(5000).toISOString())
  assert.equal(rec.ended_at, new Date(65000).toISOString())
  assert.equal(rec.turns, 1, 'the pass after the game ended did not count')
  assert.equal(rec.winner_seat, 1)
  assert.equal(rec.players.length, 2)
  assert.deepEqual(
    rec.players.map((p) => [p.name, p.commander, p.won, p.out_turn, p.life_lost]),
    [
      ['Player 1', "Atraxa, Praetors' Voice", false, 1, 20],
      ['Player 2', 'Krenko', true, null, 0],
    ],
  )
  // Another game the other way round.
  let h = startTurns(newGame(2, 20), 0)
  // Typed a little differently the second time: still the same commander.
  h = updateSeat(h, 0, { playerId: 'p-a', commanderName: " atraxa,  praetors' voice" })
  h = updateSeat(h, 1, { playerId: 'p-b', commanderName: 'Krenko' })
  h = passTurn(h)
  h = passTurn(h)
  h = adjustLife(h, 1, -20)
  const rec2 = gameRecord(h, { id: 'g2', pod_id: 'pod', created_by: 'p-a', winner: 0 })
  const atraxa = commanderTally([rec, rec2], "Atraxa, Praetors' Voice")
  assert.equal(atraxa.games, 2)
  assert.equal(atraxa.wins, 1)
  assert.equal(atraxa.winRate, 0.5)
  assert.equal(atraxa.avgTurns, 1.5)
  assert.equal(atraxa.avgLost, 10)
  assert.equal(atraxa.avgOutTurn, 1)
  assert.equal(atraxa.totalLost, 20, 'lifetime life lost adds up across games')
  assert.equal(atraxa.totalGained, 0)
  assert.equal(atraxa.totalTurns, 2, 'no turn in the first game (the other seat started and it ended), two in the second')
  assert.equal(playerTally([rec, rec2], 'p-b').wins, 1)
  assert.equal(commanderTally([rec, rec2], 'nope').games, 0)
  assert.equal(commanderTally([rec, rec2], '').games, 0, 'a blank commander matches nothing')
  assert.equal(commanderKey('  Atraxa,   Praetors\' Voice '), "atraxa, praetors' voice")
  assert.equal(tally([], () => true).winRate, null)
})

const result = (seat, name, extra = {}) => ({
  seat,
  name,
  player_id: `p-${name}`,
  commander: `c-${name}`,
  colour: 'pink',
  won: false,
  out_turn: null,
  final_life: 40,
  life_gained: 0,
  life_lost: 0,
  commander_dealt: 0,
  commander_taken: 0,
  poison: 0,
  turns: 1,
  ...extra,
})
const game = (id, ended, players) => ({
  id,
  pod_id: null,
  created_by: 'x',
  played_at: ended,
  ended_at: ended,
  turns: 5,
  starting_life: 40,
  winner_seat: players.find((p) => p.won)?.seat ?? null,
  players,
})

test('placements: winner first, survivors tie next, then by how long each lasted', () => {
  const g = game('g', '2026-01-01T00:00:00Z', [
    result(0, 'a', { out_turn: 3 }),
    result(1, 'b', { won: true }),
    result(2, 'c', { out_turn: 5 }),
    result(3, 'd'),
  ])
  assert.deepEqual([...placements(g)], [[1, 1], [3, 2], [2, 3], [0, 4]])
  const draw = game('h', '2026-01-01T00:00:00Z', [result(0, 'a'), result(1, 'b'), result(2, 'c', { out_turn: 2 })])
  assert.deepEqual([...placements(draw)], [[0, 1], [1, 1], [2, 3]])
})

test('Elo: a win gains what the loss loses, favourites gain less, and games sum to zero', () => {
  const byCommander = (r) => r.commander
  const one = game('1', '2026-01-01T00:00:00Z', [result(0, 'a', { won: true }), result(1, 'b', { out_turn: 4 })])
  let r = eloRatings([one], byCommander)
  assert.equal(r.get('c-a').rating, ELO_START + 16)
  assert.equal(r.get('c-b').rating, ELO_START - 16)
  assert.equal(r.get('c-a').games, 1)
  // The same two again: the favourite gains less than 16 this time.
  const two = game('2', '2026-01-02T00:00:00Z', [result(0, 'a', { won: true }), result(1, 'b', { out_turn: 4 })])
  r = eloRatings([two, one], byCommander)
  assert.ok(r.get('c-a').rating > ELO_START + 16 && r.get('c-a').rating < ELO_START + 32)
  assert.ok(Math.abs(r.get('c-a').rating + r.get('c-b').rating - 2 * ELO_START) < 1e-9, 'zero sum')
  // Four players: still zero sum, winner up, first out down the most.
  const four = game('4', '2026-01-03T00:00:00Z', [
    result(0, 'w', { won: true }),
    result(1, 'x', { out_turn: 6 }),
    result(2, 'y', { out_turn: 3 }),
    result(3, 'z', { out_turn: 8 }),
  ])
  r = eloRatings([four], byCommander)
  const total = ['w', 'x', 'y', 'z'].reduce((n, c) => n + r.get(`c-${c}`).rating, 0)
  assert.ok(Math.abs(total - 4 * ELO_START) < 1e-9)
  assert.equal(r.get('c-w').rating, ELO_START + 16, 'three wins at a third of K each')
  assert.ok(r.get('c-y').rating < r.get('c-x').rating && r.get('c-x').rating < r.get('c-z').rating)
  // A seat with nothing to rate sits the game out; a game with one rated seat changes nothing.
  const guest = game('5', '2026-01-04T00:00:00Z', [result(0, 'a', { won: true }), result(1, 'g', { commander: null, out_turn: 2 })])
  r = eloRatings([guest], byCommander)
  assert.equal(r.size, 0)
  // By player instead of commander.
  const rp = eloRatings([one], (x) => x.player_id)
  assert.equal(rp.get('p-a').rating, ELO_START + 16)
})

test('lifetime adds up the whole record', () => {
  assert.deepEqual(lifetime([]), { games: 0, turns: 0, gained: 0, lost: 0, commander: 0, eliminations: 0, longest: null, biggestLoss: null })
  const a = game('a', '2026-01-01T00:00:00Z', [
    result(0, 'a', { won: true, life_gained: 12, life_lost: 8, commander_dealt: 21 }),
    result(1, 'b', { out_turn: 6, life_lost: 61, commander_taken: 21 }),
  ])
  const b = { ...game('b', '2026-01-02T00:00:00Z', [result(0, 'a', { life_lost: 3 }), result(1, 'b', { won: true, life_gained: 5 })]), turns: 9 }
  const t = lifetime([a, b])
  assert.equal(t.games, 2)
  assert.equal(t.turns, 14)
  assert.equal(t.gained, 17)
  assert.equal(t.lost, 72)
  assert.equal(t.commander, 21)
  assert.equal(t.eliminations, 1)
  assert.equal(t.longest, 9)
  assert.deepEqual(t.biggestLoss, { name: 'b', commander: 'c-b', lost: 61 })
})

test('parseGame round-trips a game and rejects junk', () => {
  let g = newGame(5, 30, null, ['A'])
  g = startTurns(g, 4)
  g = adjustCommander(g, 0, 1, 4)
  g = adjustCounter(g, 2, 'energy', 3)
  g = toggleMonarch(g, 4)
  g = updateSeat(g, 1, { playerId: 'p', commanderName: 'Yuriko' })
  g = passTurn(g)
  assert.deepEqual(parseGame(JSON.parse(JSON.stringify(g))), g)
  assert.equal(parseGame(null), null)
  assert.equal(parseGame('nope'), null)
  assert.equal(parseGame({ players: 2 }), null)
  assert.equal(parseGame({ ...g, seats: g.seats.slice(0, 3) }), null)
  // Unknown colours and missing counters fall back rather than failing.
  const odd = JSON.parse(JSON.stringify(g))
  odd.seats[0].colour = 'mauve'
  delete odd.seats[0].counters
  const back = parseGame(odd)
  assert.equal(back.seats[0].colour, 'pink')
  assert.equal(back.seats[0].counters.poison, 0)
  assert.equal(back.seats[0].ko, false, 'rows stored before the flag existed are not out')
  assert.equal(back.seats[0].solRing, false, 'nor did they open with a Sol Ring')
  delete odd.log
  delete odd.turn
  const older = parseGame(odd)
  assert.deepEqual(older.log, [])
  assert.equal(older.turn, 0)
  assert.equal(older.seats[1].commanderName, 'Yuriko')
  // A save from when the field held a deck name carries it over as the commander.
  odd.seats[1].deckName = 'Old deck'
  delete odd.seats[1].commanderName
  assert.equal(parseGame(odd).seats[1].commanderName, 'Old deck')
})
