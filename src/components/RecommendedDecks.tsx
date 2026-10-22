import { useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import { errorText, useToast } from './ui'
import { artFor, cardPage, clearCache, commanderPage, edhrecUrl, ownedFor, pickCards, scoreCommanders, throttled, type Suggestion } from '../lib/edhrec'
import { fromPoolCard } from '../lib/deck'
import { namedExact } from '../lib/scryfall'
import { uid } from '../lib/uid'
import type { Deck, DeckCard } from '../lib/types'

type Idea = Suggestion & { colours: string[]; decks: number; owned: string[]; recommended: number }

const SHOW = 8

/**
 * Decks you could build, from EDHREC and the cards you already have. Each of
 * your cards is asked which commanders it is a signature card for; the
 * commanders those point at most are checked for how much of their usual
 * list you already own. Collapsed until asked, since it is a few dozen
 * requests (cached for a week).
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
  const myDecks = useMemo(() => pool.decks.filter((d) => d.owner_id === me?.id), [pool.decks, me])
  // Everything you own: deck cards first (they say more about what you build), then the spares you lend.
  const owned = useMemo(() => [...myDecks.flatMap((d) => d.cards), ...mine], [myDecks, mine])
  const built = useMemo(() => myDecks.flatMap((d) => d.cards.filter((c) => c.commander).map((c) => c.name)), [myDecks])

  async function run() {
    const names = pickCards(owned)
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
      const full = await throttled(top, async (s) => {
        const page = await commanderPage(s.slug)
        return {
          ...s,
          colours: page?.colours ?? [],
          decks: page?.decks ?? 0,
          owned: page ? ownedFor(page, ownedNames) : s.cards,
          recommended: page?.cards.length ?? 0,
        }
      })
      setIdeas(full.sort((a, b) => b.owned.length - a.owned.length || b.score - a.score))
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

  /** A new deck named for the commander, with the commander in it and every card of yours EDHREC lists for it. */
  async function start(idea: Idea) {
    if (!me) return
    setStarting(idea.slug)
    try {
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
      for (const name of idea.owned) {
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        const fromDeck = myDecks.flatMap((d) => d.cards).find((c) => c.name.toLowerCase() === key)
        const fromPool = mine.find((c) => c.name.toLowerCase() === key)
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
            Commanders that the cards you already own are signature cards for, from EDHREC, and how much of each one's usual list you have.
          </p>
          {busy && <div className="notice">{busy}</div>}
          {!busy && ideas && ideas.length === 0 && (
            <div className="notice">
              {owned.length ? 'Nothing stood out. Add more cards to your pool or decks and try again.' : 'Add some cards to your pool or a deck first.'}
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
                      You have {idea.owned.length} of {idea.recommended || 'its'} recommended {idea.recommended === 1 ? 'card' : 'cards'}
                      {idea.decks ? ` · ${idea.decks.toLocaleString()} decks on EDHREC` : ''}
                    </div>
                    {idea.owned.length > 0 && (
                      <div className="small faint reco-cards">
                        {idea.owned.slice(0, 6).join(', ')}
                        {idea.owned.length > 6 ? ` and ${idea.owned.length - 6} more` : ''}
                      </div>
                    )}
                    <div className="row" style={{ gap: 8, marginTop: 4 }}>
                      <button className="btn sm primary" disabled={starting !== null} onClick={() => void start(idea)}>
                        {starting === idea.slug ? 'Starting…' : 'Start this deck'}
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
                From {pickCards(owned).length} of your cards. Card data from EDHREC, kept for a week.
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
