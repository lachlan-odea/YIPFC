import { test } from 'node:test'
import assert from 'node:assert/strict'
import { achievements, setProgress } from '../dist-tests/achievements.js'

const card = (id, owner_id, set_code, collector_number, extra = {}) => ({
  id,
  owner_id,
  scryfall_id: id,
  name: id,
  set_code,
  set_name: set_code,
  collector_number,
  type_line: '',
  mana_cost: '',
  cmc: 0,
  color_identity: [],
  rarity: '',
  image_small: '',
  image_normal: '',
  oracle_text: '',
  quantity: 1,
  notes: '',
  foil: false,
  created_at: '',
  ...extra,
})

test('setProgress counts distinct collector numbers per set, best first', () => {
  const cards = [card('a', 'me', 'dmu', '1'), card('b', 'me', 'dmu', '1', { foil: true }), card('c', 'ann', 'dmu', '2'), card('d', 'ann', 'ltr', '5')]
  const p = setProgress(cards, { dmu: { code: 'dmu', name: 'Dominaria United', size: 4 }, ltr: { code: 'ltr', name: 'LTR', size: 100 } })
  assert.deepEqual(
    p.map((s) => [s.code, s.have, s.size, s.pct]),
    [
      ['dmu', 2, 4, 0.5],
      ['ltr', 1, 100, 0.01],
    ],
  )
})

test('first card and lender achievements derive from pool and loans', () => {
  const cards = [card('a', 'me', 'dmu', '1', { quantity: 2 })]
  const loans = [{ id: 'l1', card_id: 'a', borrower_id: 'ann', status: 'returned', requested_at: '', updated_at: '' }]
  const list = achievements({ meId: 'me', cards, loans, decks: [], playerCount: 2, sets: [] })
  const byId = Object.fromEntries(list.map((x) => [x.id, x]))
  assert.equal(byId['first-card'].earned, true)
  assert.equal(byId['neighbour'].earned, true)
  assert.equal(byId['shelf'].earned, false)
  assert.deepEqual(byId['shelf'].progress, { n: 2, of: 25 })
  assert.equal(byId['borrower'].earned, false)
  assert.equal(byId['pod-of-four'].earned, false)
})

test('pod set achievements use the best set', () => {
  const sets = [{ code: 'dmu', name: 'Dominaria United', have: 281, size: 281, pct: 1 }]
  const list = achievements({ meId: 'me', cards: [], loans: [], decks: [], playerCount: 4, sets })
  const byId = Object.fromEntries(list.map((x) => [x.id, x]))
  assert.equal(byId['set-complete'].earned, true)
  assert.equal(byId['set-half'].earned, true)
  assert.equal(byId['pod-of-four'].earned, true)
})
