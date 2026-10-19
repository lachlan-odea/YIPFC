import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addToDeck, cardKey, coverage, deckToText, groupByType, primaryType, setDeckQty } from '../dist-tests/deck.js'

const dc = (name, quantity = 1, extra = {}) => ({
  scryfall_id: name.toLowerCase(),
  name,
  quantity,
  type_line: 'Artifact',
  mana_cost: '{1}',
  cmc: 1,
  color_identity: [],
  image_small: '',
  commander: false,
  ...extra,
})
const pc = (id, name, owner_id, quantity = 1) => ({
  id,
  owner_id,
  scryfall_id: id,
  name,
  set_code: 'x',
  set_name: '',
  collector_number: '',
  type_line: '',
  mana_cost: '',
  cmc: 0,
  color_identity: [],
  rarity: '',
  image_small: '',
  image_normal: '',
  oracle_text: '',
  quantity,
  notes: '',
  created_at: '',
})
const loan = (card_id, borrower_id, status) => ({ id: card_id + borrower_id, card_id, borrower_id, status, requested_at: '', updated_at: '' })

test('cardKey treats a double-faced card and its front face as the same', () => {
  assert.equal(cardKey('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki'), cardKey('fable of the mirror-breaker'))
})

test('coverage splits copies into yours, borrowable, pending and missing', () => {
  const deck = [dc('Sol Ring', 1), dc('Arcane Signet', 2), dc('Command Tower', 1), dc('Rhystic Study', 1)]
  const pool = [
    pc('a', 'Sol Ring', 'me'),
    pc('b', 'Arcane Signet', 'ann', 1),
    pc('c', 'Arcane Signet', 'bob', 1),
    pc('d', 'Command Tower', 'ann'),
  ]
  const loans = [loan('d', 'me', 'lent')]
  const cov = coverage(deck, pool, loans, 'me')
  assert.equal(cov.total, 5)
  assert.equal(cov.yours, 1)
  assert.equal(cov.borrowable, 2)
  assert.equal(cov.pending, 1)
  assert.equal(cov.missing, 1)
  const signet = cov.rows.find((r) => r.card.name === 'Arcane Signet')
  assert.equal(signet.otherRows.length, 2)
  const tower = cov.rows.find((r) => r.card.name === 'Command Tower')
  assert.equal(tower.pending, 1)
  assert.equal(tower.myLoan.status, 'lent')
})

test('a pool row out on loan to someone else is not borrowable', () => {
  const cov = coverage([dc('Sol Ring')], [pc('a', 'Sol Ring', 'ann')], [loan('a', 'bob', 'requested')], 'me')
  assert.equal(cov.borrowable, 0)
  assert.equal(cov.missing, 1)
})

test('your own card out on loan does not count as in your pile', () => {
  const cov = coverage([dc('Sol Ring')], [pc('a', 'Sol Ring', 'me')], [loan('a', 'bob', 'lent')], 'me')
  assert.equal(cov.yours, 0)
  assert.equal(cov.missing, 1)
})

test('addToDeck merges by name and setDeckQty removes at zero', () => {
  let cards = addToDeck([], dc('Sol Ring'))
  cards = addToDeck(cards, dc('Sol Ring', 2))
  assert.equal(cards.length, 1)
  assert.equal(cards[0].quantity, 3)
  assert.deepEqual(setDeckQty(cards, 'sol ring', 0), [])
})

test('groupByType orders sections and puts the commander first', () => {
  const rows = [
    { card: dc('Island', 1, { type_line: 'Basic Land — Island', cmc: 0 }) },
    { card: dc('Sol Ring') },
    { card: dc('Atraxa', 1, { type_line: 'Legendary Creature — Phyrexian Angel Horror', commander: true, cmc: 4 }) },
    { card: dc('Grizzly Bears', 1, { type_line: 'Creature — Bear', cmc: 2 }) },
  ]
  assert.deepEqual(
    groupByType(rows).map((g) => g.type),
    ['Commander', 'Creature', 'Artifact', 'Land'],
  )
  assert.equal(primaryType({ type_line: 'Artifact Creature — Golem', commander: false }), 'Creature')
})

test('deckToText lists the commander first', () => {
  const text = deckToText({ cards: [dc('Sol Ring'), dc('Atraxa', 1, { commander: true })] })
  assert.equal(text, 'Commander\n1 Atraxa\n\n1 Sol Ring')
})
