import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjustCommander, adjustLife, passTurn, startTurns, toggleMonarch, updateSeat } from '../dist-tests/life.js'
import { freshSessionSeat, handoffGame, newSession, parseSession, resetFields, sessionPatch, toGame, toSessionSeat } from '../dist-tests/session.js'
import { turnOrder } from '../dist-tests/life.js'

const host = { id: 'u-host', name: 'Lachlan' }

function table() {
  const s = { id: 's1', ...newSession('pod', host, 40, new Date(0)) }
  s.order.push('u-sam', 'u-jo')
  s.seats['u-sam'] = freshSessionSeat('u-sam', 'Sam', 40, ['pink'])
  s.seats['u-jo'] = freshSessionSeat('u-jo', 'Jo', 40, ['pink', 'cyan'])
  return s
}

test('a new session seats the host alone at the starting life; joiners get unused colours', () => {
  const s = newSession('pod', host, 30, new Date(0))
  assert.equal(s.status, 'open')
  assert.deepEqual(s.order, ['u-host'])
  assert.equal(s.seats['u-host'].life, 30)
  assert.equal(s.seats['u-host'].colour, 'pink')
  assert.equal(freshSessionSeat('x', 'X', 40, ['pink', 'cyan']).colour, 'lime')
  assert.equal(freshSessionSeat('x', 'X', 40, ['pink', 'cyan', 'lime', 'violet', 'orange', 'gold', 'rose', 'blue']).colour, 'pink', 'wraps when every colour is taken')
})

test('toGame numbers seats by join order and maps every id', () => {
  const s = table()
  s.seats['u-jo'].life = 31
  s.seats['u-jo'].commander = { 'u-sam': 9, 'u-nobody': 4 }
  s.seats['u-jo'].commander_name = 'Krenko'
  s.monarch = 'u-sam'
  s.active = 'u-jo'
  s.first = 'u-host'
  s.turn = 3
  s.log = [
    { at: 1, turn: 1, seat: 'u-host', kind: 'start' },
    { at: 2, turn: 1, seat: 'u-jo', kind: 'commander', from: 'u-sam', n: 9 },
    { at: 3, turn: 1, seat: 'u-gone', kind: 'life', n: -1 },
  ]
  const g = toGame(s)
  assert.equal(g.players, 3)
  assert.deepEqual(
    g.seats.slice(0, 3).map((x) => [x.name, x.playerId, x.life]),
    [
      ['Lachlan', 'u-host', 40],
      ['Sam', 'u-sam', 40],
      ['Jo', 'u-jo', 31],
    ],
  )
  assert.deepEqual(g.seats[2].commander, { 1: 9 }, 'damage from an unknown id is dropped')
  assert.equal(g.seats[2].commanderName, 'Krenko')
  assert.equal(g.monarch, 1)
  assert.equal(g.active, 2)
  assert.equal(g.first, 0)
  assert.equal(g.turn, 3)
  assert.deepEqual(
    g.log.map((e) => [e.kind, e.seat, e.from]),
    [
      ['start', 0, undefined],
      ['commander', 2, 1],
    ],
    'events for ids not at the table are dropped',
  )
  assert.equal(g.seats[3].name, 'Player 4', 'the unused seats are plain')
})

test('sessionPatch sends only the seats and fields that moved, with events keyed by id', () => {
  const s = table()
  const g = toGame(s)
  let n = adjustLife(g, 2, -5)
  n = adjustCommander(n, 0, 2, 4)
  n = toggleMonarch(n, 1)
  const p = sessionPatch(g, n, s.order)
  assert.deepEqual(Object.keys(p.fields).sort(), ['monarch', 'seats.u-host', 'seats.u-jo'])
  assert.equal(p.fields.monarch, 'u-sam')
  assert.equal(p.fields['seats.u-jo'].life, 35)
  assert.deepEqual(p.fields['seats.u-host'].commander, { 'u-jo': 4 })
  assert.equal(p.fields['seats.u-host'].life, 36)
  assert.deepEqual(
    p.events.map((e) => [e.kind, e.seat, e.from, e.n]),
    [
      ['life', 'u-jo', undefined, -5],
      ['commander', 'u-host', 'u-jo', 4],
      ['life', 'u-host', undefined, -4],
    ],
  )
  // Nothing changed: nothing sent.
  assert.deepEqual(sessionPatch(g, g, s.order), { fields: {}, events: [] })
  // Starting turns and passing in join order.
  let t = startTurns(g, 1, 1000)
  const p2 = sessionPatch(g, t, s.order)
  assert.deepEqual(Object.keys(p2.fields).sort(), ['active', 'first', 'startedAt', 'turn'])
  assert.equal(p2.fields.active, 'u-sam')
  assert.equal(p2.events[0].kind, 'start')
  const order = [0, 1, 2]
  t = passTurn(t, 2000, order)
  assert.equal(t.active, 2, 'join order, not the one-phone layout order')
  t = passTurn(t, 3000, order)
  assert.equal(t.active, 0)
  t = passTurn(t, 4000, order)
  assert.equal(t.active, 1)
  assert.equal(t.turn, 2, 'back round to the first player')
})

test('handoffGame seats the session around the one-phone table in play order, keeping everything', () => {
  const s = table()
  s.order.push('u-dane')
  s.seats['u-dane'] = freshSessionSeat('u-dane', 'Dane', 40, ['pink', 'cyan', 'lime'])
  s.seats['u-sam'].life = 33
  s.seats['u-sam'].counters.poison = 4
  s.seats['u-jo'].commander = { 'u-sam': 9 }
  s.seats['u-jo'].commander_name = 'Krenko'
  s.monarch = 'u-jo'
  s.first = 'u-host'
  s.active = 'u-jo'
  s.turn = 5
  s.log = [{ at: 1, turn: 1, seat: 'u-host', kind: 'start' }, { at: 2, turn: 3, seat: 'u-jo', kind: 'commander', from: 'u-sam', n: 9 }]
  const g = handoffGame(s)
  const order = turnOrder(4)
  // Join order host, sam, jo, dane lands on the seats the one-phone table visits clockwise.
  assert.deepEqual(order.map((id) => g.seats[id].name), ['Lachlan', 'Sam', 'Jo', 'Dane'])
  const by = (name) => g.seats.find((x) => x.name === name)
  assert.equal(by('Sam').life, 33)
  assert.equal(by('Sam').counters.poison, 4)
  assert.deepEqual(by('Jo').commander, { [by('Sam').id]: 9 })
  assert.equal(by('Jo').commanderName, 'Krenko')
  assert.equal(by('Jo').playerId, 'u-jo')
  assert.equal(g.monarch, by('Jo').id)
  assert.equal(g.first, by('Lachlan').id)
  assert.equal(g.active, by('Jo').id)
  assert.equal(g.turn, 5)
  assert.equal(g.players, 4)
  assert.deepEqual(
    g.log.map((e) => [e.kind, e.seat, e.from]),
    [
      ['start', by('Lachlan').id, undefined],
      ['commander', by('Jo').id, by('Sam').id],
    ],
  )
  // The empty seats are plain and come after the players.
  assert.equal(g.seats[4].name, 'Player 5')
  // Without slots the plain mapping is unchanged.
  assert.deepEqual(toGame(s).seats.slice(0, 4).map((x) => x.name), ['Lachlan', 'Sam', 'Jo', 'Dane'])
})

test('toSessionSeat keeps the player id and drops zero commander damage', () => {
  const s = table()
  const g = updateSeat(toGame(s), 1, { commanderName: 'Atraxa' })
  const seat = { ...g.seats[1], commander: { 0: 3, 2: 0 } }
  assert.deepEqual(toSessionSeat(seat, s.order), {
    name: 'Sam',
    player_id: 'u-sam',
    colour: 'cyan',
    life: 40,
    counters: { poison: 0, energy: 0, experience: 0, tax: 0 },
    commander: { 'u-host': 3 },
    ko: false,
    commander_name: 'Atraxa',
  })
})

test('resetFields clears the game but keeps who is sitting where', () => {
  const s = table()
  s.seats['u-jo'].life = 2
  s.seats['u-jo'].ko = true
  s.seats['u-jo'].commander_name = 'Krenko'
  s.seats['u-jo'].counters.poison = 7
  s.turn = 9
  const f = resetFields(s)
  assert.equal(f.turn, 0)
  assert.equal(f.active, null)
  assert.deepEqual(f.log, [])
  assert.equal(f['seats.u-jo'].life, 40)
  assert.equal(f['seats.u-jo'].ko, false)
  assert.equal(f['seats.u-jo'].counters.poison, 0)
  assert.equal(f['seats.u-jo'].commander_name, 'Krenko')
  assert.equal(f['seats.u-jo'].colour, 'lime')
})

test('parseSession accepts a real document and rejects junk', () => {
  const s = table()
  const { id, ...doc } = s
  const back = parseSession('s1', JSON.parse(JSON.stringify(doc)))
  assert.deepEqual(back, s)
  assert.equal(parseSession('x', null), null)
  assert.equal(parseSession('x', { pod_id: 'p' }), null)
  const sparse = parseSession('x', { pod_id: 'p', host_id: 'h', order: ['h', 3], seats: {} })
  assert.deepEqual(sparse.order, ['h'])
  assert.equal(sparse.status, 'open')
  assert.equal(sparse.starting_life, 40)
  assert.deepEqual(sparse.log, [])
})
