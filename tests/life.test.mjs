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
  commanderTotal,
  inProgress,
  isDead,
  layout,
  newGame,
  opponents,
  parseGame,
  setFirst,
  toggleInitiative,
  toggleKO,
  toggleMonarch,
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

test('parseGame round-trips a game and rejects junk', () => {
  let g = newGame(5, 30, null, ['A'])
  g = adjustCommander(g, 0, 1, 4)
  g = adjustCounter(g, 2, 'energy', 3)
  g = toggleMonarch(g, 4)
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
})
