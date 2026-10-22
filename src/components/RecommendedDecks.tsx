import { useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import { errorText, useToast } from './ui'
import { artFor, averageDeck, cardPage, clearCache, commanderPage, edhrecUrl, ownedFor, pickCards, scoreCommanders, throttled, type Suggestion } from '../lib/edhrec'
import { fromPoolCard } from '../lib/deck'
import { collection, namedExact, toPoolCard } from '../lib/scryfall'
import { uid } from '../lib/uid'
import type { Deck, DeckCard } from '../lib/types'

type Idea = Suggestion & { colours: string[]; decks: number; owned: string[]; borrow: string[]; recommended: number }

const SHOW = 8

/** EDHREC's average deck for a commander as deck cards, via Scryfall for the card data; null if EDHREC has none. */
async function fullDeck(slug: string): Promise<DeckCard[] | null> {
  const avg = await averageDeck(slug)
  if (!avg) return null
  const found = await collection(avg.cards.map((c) => ({ id: c.id })))
  const byId = new Map(found.found.map((c) => [c.id, c]))
  const cards: DeckCard[] = []
  for (const entry of avg.cards) {
    const sc = byId.get(entry.id)
    if (!sc) continue
    const p = toPoolCard(sc, entry.quantity)
    cards.push({
      scryfall_id: p.scryfall_id,
      name: p.name,
      quantity: entry.quantity,
      type_line: p.type_line,
      mana_cost: p.mana_cost,
      cmc: p.cmc,
      color_identity: p.color_identity,
      image_small: p.image_small,
      commander: entry.commander,
    })
  }
  return cards.length >= 60 ? cards : null
}

/**
 * Decks the pod could build, from EDHREC and every card in the pool. Each
 * card you own or a friend has spare is asked which commanders it is a
 * signature card for; the commanders those point at most are checked for
 * how much of their usual list is already at hand, split into what you own
 * and what the pod can lend. Collapsed until asked, since it is one request
 * per card (kept for a week).
 */
export default function RecommendedDecks({ onOpen }: { onOpen: (deckId: string) => void }) {
  const pool = usePool()
  const toast = useToast()
  const me = pool.me
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  const mine = useMemo(() => pool.cards.filter((c) => c.owner_id === me?.id), [pool.cards, me])
  const podCards = useMemo(() => pool.cards.filter((c) => c.owner_id !== me?.id), [pool.cards, me])
  const myDecks = useMemo(() => pool.decks.filter((d) => d.owner_id === me?.id), [pool.decks, me])
  // Everything you own: deck cards first (they say more about what you build), then the spares you lend.
  const owned = useMemo(() => [...myDecks.flatMap((d) => d.cards), ...mine], [myDecks, mine])
  // Then everything the rest of the pod has spare: the whole point is building from each other's piles.
  const everything = useMemo(() => [...owned, ...podCards], [owned, podCards])
  const built = useMemo(() => myDecks.flatMap((d) => d.cards.filter((c) => c.commander).map((c) => c.name)), [myDecks])

  async function run() {
    const names = pickCards(everything)
    if (!names.length) {
      setIdeas([])
      return
    }
    setBusy(`Checking 0 of ${names.length} cards…`)
    try {
      const pages = await throttled(names, async (name) => ({ name, page: await cardPage(name) }), (n) => setBusy(`Checking ${n} of ${names.length} cards…`))
      const top = scoreCommanders(pages, built).slice(0, SHOW)
      setBusy(`Sizing up ${top.length} commanders…`)
      const ownedNames = owned.map((c) => c.name)
      const podNames = podCards.map((c) => c.name)
      const full = await throttled(top, async (s) => {
        const page = await commanderPage(s.slug)
        const yours = page ? ownedFor(page, ownedNames) : s.cards
        const have = new Set(yours.map((n) => n.toLowerCase()))
        const borrow = page ? ownedFor(page, podNames).filter((n) => !have.has(n.toLowerCase())) : []
        return { ...s, colours: page?.colours ?? [], decks: page?.decks ?? 0, owned: yours, borrow, recommended: page?.cards.length ?? 0 }
      })
      setIdeas(full.sort((a, b) => b.owned.length + b.borrow.length - (a.owned.length + a.borrow.length) || b.score - a.score))
    } catch (e) {
      toast(errorText(e), 'error')
      setIdeas([])
    } finally {
      setBusy(null)
    }
  }

  function show() {
    setOpen(true)
    if (ideas === null && !busy) void run()
  }

  /**
   * A new deck named for the commander: EDHREC's full average deck for it,
   * so the deck's coverage shows what is yours, what the pod can lend and
   * what is still to find. If EDHREC has no average deck, it falls back to
   * the commander plus every card at hand.
   */
  async function start(idea: Idea) {
    if (!me) return
    setStarting(idea.slug)
    try {
      const full = await fullDeck(idea.slug)
      if (full) {
        const now = new Date().toISOString()
        const deck: Deck = { id: uid(), owner_id: me.id, name: idea.name, cards: full, created_at: now, updated_at: now }
        await pool.saveDeck(deck)
        const n = full.reduce((t, c) => t + c.quantity, 0)
        toast(`Started ${idea.name}: EDHREC's ${n}-card list. The deck shows what is yours, borrowable and still to find.`)
        onOpen(deck.id)
        return
      }
      const cards: DeckCard[] = []
      try {
        const c = await namedExact(idea.name)
        cards.push({
          scryfall_id: c.id,
          name: c.name,
          quantity: 1,
          type_line: c.type_line ?? '',
          mana_cost: c.mana_cost ?? '',
          cmc: c.cmc ?? 0,
          color_identity: c.color_identity ?? [],
          image_small: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? '',
          commander: true,
        })
      } catch {
        /* Scryfall could not find it by that name; the deck still starts, add the commander by hand */
      }
      const seen = new Set(cards.map((c) => c.name.toLowerCase()))
      for (const name of [...idea.owned, ...idea.borrow]) {
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        const fromDeck = myDecks.flatMap((d) => d.cards).find((c) => c.name.toLowerCase() === key)
        const fromPool = mine.find((c) => c.name.toLowerCase() === key) ?? podCards.find((c) => c.name.toLowerCase() === key)
        const card = fromDeck ? { ...fromDeck, quantity: 1, commander: false } : fromPool ? fromPoolCard(fromPool) : null
        if (!card) continue
        seen.add(key)
        cards.push(card)
      }
      const now = new Date().toISOString()
      const deck: Deck = { id: uid(), owner_id: me.id, name: idea.name, cards, created_at: now, updated_at: now }
      await pool.saveDeck(deck)
      toast(`Started ${idea.name} with ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`)
      onOpen(deck.id)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setStarting(null)
    }
  }

  if (!me) return null

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row between">
        <h2 className="section-h" style={{ margin: 0 }}>
          Recommended decks
        </h2>
        <button className="btn sm quiet" onClick={() => (open ? setOpen(false) : show())} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          <p className="small muted">
            Commanders that the pod's cards are signature cards for, from EDHREC, and how much of each one's usual list is already between you:
            what you own, and what friends can lend.
          </p>
          {busy && <div className="notice">{busy}</div>}
          {!busy && ideas && ideas.length === 0 && (
            <div className="notice">
              {everything.length ? 'Nothing stood out. As the pool grows, try again.' : 'Add some cards to the pool or a deck first.'}
            </div>
          )}
          {!busy && ideas && ideas.length > 0 && (
            <div className="reco-list">
              {ideas.map((idea) => (
                <div key={idea.slug} className="reco">
                  <img className="reco-art" src={artFor(idea.id)} alt="" loading="lazy" draggable={false} />
                  <div className="reco-body">
                    <div className="row between" style={{ alignItems: 'baseline' }}>
                      <strong>{idea.name}</strong>
                      {idea.colours.length > 0 && <span className="small faint">{idea.colours.join('')}</span>}
                    </div>
                    <div className="small muted">
                      {idea.owned.length + idea.borrow.length} of {idea.recommended || 'its'} recommended {idea.recommended === 1 ? 'card' : 'cards'} at hand:{' '}
                      <span className="yours">{idea.owned.length} yours</span>
                      {idea.borrow.length > 0 && (
                        <>
                          , <span className="borrow">{idea.borrow.length} to borrow</span>
                        </>
                      )}
                      {idea.decks ? ` · ${idea.decks.toLocaleString()} decks on EDHREC` : ''}
                    </div>
                    {idea.owned.length > 0 && (
                      <div className="small faint reco-cards">
                        Yours: {idea.owned.slice(0, 5).join(', ')}
                        {idea.owned.length > 5 ? ` and ${idea.owned.length - 5} more` : ''}
                      </div>
                    )}
                    {idea.borrow.length > 0 && (
                      <div className="small faint reco-cards">
                        Borrow: {idea.borrow.slice(0, 5).join(', ')}
                        {idea.borrow.length > 5 ? ` and ${idea.borrow.length - 5} more` : ''}
                      </div>
                    )}
                    <div className="row" style={{ gap: 8, marginTop: 4 }}>
                      <button
                        className="btn sm primary"
                        disabled={starting !== null}
                        onClick={() => void start(idea)}
                        title="Make a deck from EDHREC's average 100-card list, so you can see what is left to find"
                      >
                        {starting === idea.slug ? 'Building…' : 'Start this deck'}
                      </button>
                      <a className="btn sm quiet" href={edhrecUrl(idea.slug)} target="_blank" rel="noreferrer">
                        EDHREC
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!busy && ideas && (
            <div className="row between">
              <p className="small faint" style={{ margin: 0 }}>
                From all {pickCards(everything).length} non-land cards you and the pod have. Card data from EDHREC, kept for a week.
              </p>
              <button
                className="btn sm quiet"
                title="Fetch the latest from EDHREC and look again at the cards you own now"
                onClick={() => {
                  clearCache()
                  void run()
                }}
              >
                Refresh
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
