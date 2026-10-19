import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, parseFooter } from '../dist-tests/cardText.js'

test('cleanTitle keeps the longest line and strips noise', () => {
  assert.equal(cleanTitle('  Lightning Bolt\n(R)\n'), 'Lightning Bolt')
  assert.equal(cleanTitle("Urza's Saga 3"), "Urza's Saga")
  assert.equal(cleanTitle('--- Sol Ring ---'), 'Sol Ring')
  assert.equal(cleanTitle(''), '')
})

test('parseFooter reads a modern frame footer', () => {
  assert.deepEqual(parseFooter('0042/0281 U\nDMU · EN'), { set: 'dmu', number: '42' })
  assert.deepEqual(parseFooter('203/274 R\nCMM EN  ARTIST NAME'), { set: 'cmm', number: '203' })
  assert.deepEqual(parseFooter('0012/0350 M\nLTR-EN'), { set: 'ltr', number: '12' })
})

test('parseFooter copes with the set code on its own', () => {
  assert.deepEqual(parseFooter('88/264\nM21'), { set: 'm21', number: '88' })
  assert.deepEqual(parseFooter('88/264\nEN'), null)
})

test('parseFooter returns null when the collector number is missing', () => {
  assert.equal(parseFooter('DMU · EN'), null)
  assert.equal(parseFooter('garbage'), null)
})
