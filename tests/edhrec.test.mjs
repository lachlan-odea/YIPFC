import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAPLE, edhrecSlug, ownedFor, parseCardPage, parseCommanderPage, pickCards, scoreCommanders, throttled } from '../dist-tests/edhrec.js'

test('edhrecSlug matches the slugs EDHREC uses', () => {
  assert.equal(edhrecSlug("Atraxa, Praetors' Voice"), 'atraxa-praetors-voice')
  assert.equal(edhrecSlug("Kozilek's Return"), 'kozileks-return')
  assert.equal(edhrecSlug("K'rrik, Son of Yawgmoth"), 'krrik-son-of-yawgmoth')
  assert.equal(edhrecSlug('Lim-Dûl the Necromancer'), 'lim-dul-the-necromancer')
  assert.equal(edhrecSlug('Fire // Ice'), 'fire', 'front face only for a split card page')
  assert.equal(edhrecSlug('The Ur-Dragon'), 'the-ur-dragon')
  assert.equal(edhrecSlug('Yawgmoth, Thran Physician'), 'yawgmoth-thran-physician')
  assert.equal(edhrecSlug('Minsc & Boo, Timeless Heroes'), 'minsc-and-boo-timeless-heroes')
})

const cardPageRaw = (decks, potential, commanders) => ({
  container: {
    json_dict: {
      card: { name: 'x', num_decks: decks, potential_decks: potential },
      cardlists: [
        { tag: 'newcommanders', cardviews: [{ name: 'Ignored', slug: 'ignored', id: 'i', num_decks: 1, potential_decks: 1 }] },
        { tag: 'topcommanders', cardviews: commanders },
      ],
    },
  },
})
const cv = (name, slug, decks, potential) => ({ name, slug, id: `id-${slug}`, num_decks: decks, potential_decks: potential })
/** A parsed commander reference, as scoreCommanders consumes. */
const ref = (name, slug, decks, potential) => ({ name, slug, id: `id-${slug}`, decks, potential })

test('parseCardPage keeps the inclusion rate and the top commanders only', () => {
  const p = parseCardPage(cardPageRaw(50, 1000, [cv('Atraxa, Praetors\' Voice', 'atraxa-praetors-voice', 300, 1000), { name: 'No id', slug: 'x' }]))
  assert.equal(p.inclusion, 0.05)
  assert.deepEqual(p.commanders, [{ slug: 'atraxa-praetors-voice', name: "Atraxa, Praetors' Voice", id: 'id-atraxa-praetors-voice', decks: 300, potential: 1000 }])
  assert.equal(parseCardPage({}), null)
  assert.equal(parseCardPage(null), null)
})

test('parseCommanderPage flattens every list into one set of names', () => {
  const p = parseCommanderPage({
    container: {
      json_dict: {
        card: { name: 'Krenko, Mob Boss', id: 'k', num_decks: 12000, color_identity: ['R'] },
        cardlists: [
          { tag: 'topcards', cardviews: [{ name: 'Skirk Prospector' }, { name: 'Goblin Chieftain' }] },
          { tag: 'creatures', cardviews: [{ name: 'Goblin Chieftain' }, { name: 'Siege-Gang Commander' }] },
        ],
      },
    },
  })
  assert.equal(p.name, 'Krenko, Mob Boss')
  assert.deepEqual(p.colours, ['R'])
  assert.deepEqual(p.cards, ['Skirk Prospector', 'Goblin Chieftain', 'Siege-Gang Commander'])
})

test('pickCards drops lands and duplicates and keeps deck order', () => {
  const names = pickCards(
    [
      { name: 'Sol Ring', type_line: 'Artifact' },
      { name: 'Command Tower', type_line: 'Land' },
      { name: 'Dryad Arbor', type_line: 'Land Creature — Dryad' },
      { name: 'sol ring', type_line: 'Artifact' },
      { name: 'Doubling Season', type_line: 'Enchantment' },
    ],
    2,
  )
  assert.deepEqual(names, ['Sol Ring', 'Doubling Season'])
})

test('scoreCommanders weights by inclusion, skips staples and built commanders, and lists the cards behind each', () => {
  const pages = [
    { name: 'Doubling Season', page: { inclusion: 0.03, commanders: [ref('Atraxa', 'atraxa-praetors-voice', 600, 1000), ref('Ghave', 'ghave-guru-of-spores', 300, 1000)] } },
    { name: 'Deepglow Skate', page: { inclusion: 0.01, commanders: [ref('Atraxa', 'atraxa-praetors-voice', 500, 1000)] } },
    { name: 'Sol Ring', page: { inclusion: 0.83, commanders: [ref('Jace', 'jace-multiverse-architect', 900, 1000)] } },
    { name: 'Skullclamp', page: { inclusion: 0.1, commanders: [ref('Krenko, Mob Boss', 'krenko-mob-boss', 400, 1000), ref('Ghave', 'ghave-guru-of-spores', 100, 1000)] } },
    { name: 'Missing', page: null },
  ]
  const out = scoreCommanders(pages, ['Krenko, Mob Boss'])
  assert.deepEqual(
    out.map((s) => [s.slug, Math.round(s.score * 100) / 100, s.cards]),
    [
      ['atraxa-praetors-voice', 1.1, ['Doubling Season', 'Deepglow Skate']],
      ['ghave-guru-of-spores', 0.4, ['Doubling Season', 'Skullclamp']],
    ],
  )
  assert.ok(!out.some((s) => s.slug === 'jace-multiverse-architect'), 'a staple points at nothing')
  assert.ok(STAPLE > 0.1 && STAPLE < 0.83)
})

test('ownedFor matches your cards against the page, ignoring case and duplicates', () => {
  const page = { name: 'x', id: 'x', colours: [], decks: 0, cards: ['Doubling Season', 'Sol Ring', 'Deepglow Skate'] }
  assert.deepEqual(ownedFor(page, ['sol ring', 'Doubling Season', 'Sol Ring', 'Krenko, Mob Boss']), ['sol ring', 'Doubling Season'])
})

test('throttled runs everything, in order, a few at a time, and reports progress', async () => {
  let running = 0
  let peak = 0
  const seen = []
  const out = await throttled(
    [1, 2, 3, 4, 5, 6, 7],
    async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return n * 2
    },
    (d) => seen.push(d),
    3,
  )
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14])
  assert.ok(peak <= 3)
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7])
})
