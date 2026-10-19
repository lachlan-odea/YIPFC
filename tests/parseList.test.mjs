import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseList, parseLine } from '../dist-tests/parseList.js'

test('plain names and counts', () => {
  const { lines, skipped } = parseList(`Sol Ring\n2 Arcane Signet\n1x Command Tower\nCommander\n// Lands\n3x Island`)
  assert.equal(skipped.length, 0)
  assert.deepEqual(
    lines.map((l) => [l.quantity, l.name]),
    [
      [1, 'Sol Ring'],
      [2, 'Arcane Signet'],
      [1, 'Command Tower'],
      [3, 'Island'],
    ],
  )
})

test('moxfield export with set, number and foil flag', () => {
  const l = parseLine('1 Sol Ring (C21) 263 *F*')
  assert.equal(l.name, 'Sol Ring')
  assert.equal(l.set, 'c21')
  assert.equal(l.collector_number, '263')
  assert.equal(l.foil, true)
})

test('archidekt tags are stripped', () => {
  const l = parseLine('4 Lightning Bolt (2X2) 117 #Burn ^Have^')
  assert.equal(l.name, 'Lightning Bolt')
  assert.equal(l.set, '2x2')
  assert.equal(l.quantity, 4)
})

test('square-bracket set codes', () => {
  const l = parseLine('1 Rhystic Study [PCY]')
  assert.equal(l.set, 'pcy')
  assert.equal(l.collector_number, undefined)
})

test('double-faced names survive', () => {
  const l = parseLine('1 Valki, God of Lies // Tibalt, Cosmic Impostor (KHM) 114')
  assert.equal(l.name, 'Valki, God of Lies // Tibalt, Cosmic Impostor')
  assert.equal(l.set, 'khm')
})

test('duplicates merge', () => {
  const { lines } = parseList(`1 Sol Ring\n2 Sol Ring\n1 Sol Ring (C21) 263`)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].quantity, 3)
})

test('csv export', () => {
  const csv = `Count,Name,Edition,Collector Number,Foil\n2,"Thassa's Oracle",THB,73,\n1,Demonic Consultation,ICE,,foil`
  const { lines } = parseList(csv)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].name, "Thassa's Oracle")
  assert.equal(lines[0].set, 'thb')
  assert.equal(lines[0].collector_number, '73')
  assert.equal(lines[0].quantity, 2)
  assert.equal(lines[1].foil, true)
})

test('junk lines are reported, not silently dropped', () => {
  const { lines, skipped } = parseList(`1 Sol Ring\n---\n12345`)
  assert.equal(lines.length, 1)
  assert.equal(skipped.length, 2)
})
