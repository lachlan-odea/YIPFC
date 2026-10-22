import { useMemo, useState, type FormEvent } from 'react'
import { usePool } from '../lib/store'
import type { Deck } from '../lib/types'
import { coverage, deckSize } from '../lib/deck'
import { uid } from '../lib/uid'
import { errorText, useToast } from '../components/ui'
import DeckEditor from '../components/DeckEditor'
import { StatsSheet } from '../components/GameStats'
import RecommendedDecks from '../components/RecommendedDecks'

export default function DecksScreen() {
  const pool = usePool()
  const toast = useToast()
  const me = pool.me!
  const [openId, setOpenId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState(false)
  const [showPod, setShowPod] = useState(false)

  const mine = pool.decks.filter((d) => d.owner_id === me.id)
  const others = pool.decks.filter((d) => d.owner_id !== me.id)
  const open = openId ? pool.decks.find((d) => d.id === openId) ?? null : null

  async function create(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const deck: Deck = { id: uid(), owner_id: me.id, name, cards: [], created_at: now, updated_at: now }
    try {
      await pool.saveDeck(deck)
      setNewName('')
      setCreating(false)
      setOpenId(deck.id)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  if (open) return <DeckEditor deck={open} onBack={() => setOpenId(null)} />

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h1 className="title">Decks</h1>
          <p className="subtitle" style={{ marginTop: 6 }}>
            Build from the pool, or paste a list and see what the pod can cover.
          </p>
        </div>
        {!creating && (
          <div className="row">
            <button className="btn quiet" onClick={() => setStats(true)} title="Commander and player records from saved games">
              Records
            </button>
            <button className="btn primary" onClick={() => setCreating(true)}>
              New deck
            </button>
          </div>
        )}
      </div>
      {stats && <StatsSheet onClose={() => setStats(false)} />}

      {creating && (
        <form onSubmit={create} className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Deck name, e.g. Atraxa superfriends"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            aria-label="Deck name"
          />
          <button className="btn primary" disabled={!newName.trim()}>
            Create
          </button>
          <button type="button" className="btn quiet" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {mine.length === 0 && !creating && (
        <div className="empty">
          <strong>No decks yet</strong>
          <p>Start one and add cards from the pool, or paste a list from Moxfield or Archidekt to see what is already covered.</p>
        </div>
      )}

      {mine.length > 0 && (
        <div className="deck-list">
          {mine.map((d) => (
            <DeckTile key={d.id} deck={d} onOpen={() => setOpenId(d.id)} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          <div className="row between">
            <h2 className="section-h" style={{ margin: 0 }}>
              Pod decks <span>{others.length}</span>
            </h2>
            <button className="btn sm quiet" onClick={() => setShowPod((v) => !v)} aria-expanded={showPod}>
              {showPod ? 'Hide' : 'Show'}
            </button>
          </div>
          {showPod && (
            <div className="deck-list">
              {others.map((d) => (
                <DeckTile key={d.id} deck={d} onOpen={() => setOpenId(d.id)} />
              ))}
            </div>
          )}
        </>
      )}

      <RecommendedDecks onOpen={setOpenId} />
    </div>
  )
}

function DeckTile({ deck, onOpen }: { deck: Deck; onOpen: () => void }) {
  const pool = usePool()
  const owner = pool.playerById(deck.owner_id)
  const mine = deck.owner_id === pool.me?.id
  const cov = useMemo(() => coverage(deck.cards, pool.cards, pool.loans, pool.me?.id ?? null), [deck.cards, pool.cards, pool.loans, pool.me])
  const size = deckSize(deck)
  const pct = (n: number) => (cov.total ? `${(n / cov.total) * 100}%` : '0%')
  // The commander (or partners) fronts the tile; a deck without one shows a blank card.
  const commanders = deck.cards.filter((c) => c.commander)
  return (
    <button className="deck-tile" onClick={onOpen}>
      <div className={`deck-cmdr ${commanders.length > 1 ? 'pair' : ''}`} aria-hidden="true">
        {commanders.length ? (
          commanders.slice(0, 2).map((c) => <img key={c.scryfall_id} src={c.image_small} alt="" loading="lazy" draggable={false} />)
        ) : (
          <span className="deck-cmdr-none">No commander</span>
        )}
      </div>
      <div className="deck-tile-body">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <strong>{deck.name}</strong>
          <span className="small muted">
            {size} {size === 1 ? 'card' : 'cards'}
          </span>
        </div>
        <div className="small muted">
          {mine ? 'Yours' : `${owner?.name ?? 'Someone'}'s`}
          {commanders.length > 0 && ` · ${commanders.map((c) => c.name).join(' & ')}`}
        </div>
        {size > 0 && (
          <>
            <div className="cover-bar" aria-hidden="true">
              <i className="yours" style={{ width: pct(cov.yours) }} />
              <i className="pending" style={{ width: pct(cov.pending) }} />
              <i className="borrow" style={{ width: pct(cov.borrowable) }} />
            </div>
            <div className="small muted cover-legend">
              {cov.yours > 0 && <span className="yours">{cov.yours} in your pile</span>}
              {cov.pending > 0 && <span className="pending">{cov.pending} on loan to you</span>}
              {cov.borrowable > 0 && <span className="borrow">{cov.borrowable} borrowable</span>}
              {cov.missing > 0 ? <span className="missing">{cov.missing} missing</span> : <span className="yours">All covered</span>}
            </div>
          </>
        )}
      </div>
    </button>
  )
}
