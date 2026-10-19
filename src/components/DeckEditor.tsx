import { useEffect, useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import type { Deck, DeckCard, PoolCard } from '../lib/types'
import { addToDeck, coverage, deckSize, deckToText, fromPoolCard, groupByType, setDeckQty, type CardCoverage } from '../lib/deck'
import { autocomplete, namedExact, type ScryfallCard } from '../lib/scryfall'
import { parseList } from '../lib/parseList'
import { resolveLines } from '../lib/resolve'
import { Icons, Pips, errorText, useToast } from './ui'
import CardDetail from './CardDetail'

type Filter = 'all' | 'missing' | 'borrow' | 'yours'
type AddMode = 'pool' | 'search' | 'paste'

/**
 * One deck: its cards grouped by type, each line marked with where the copies
 * would come from (your own pile, a loan, someone else's spares, or nowhere),
 * plus three ways to add cards. Other players' decks open read-only, with the
 * coverage worked out from the viewer's side so they can see how to help.
 */
export default function DeckEditor({ deck, onBack }: { deck: Deck; onBack: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const me = pool.me!
  const readOnly = deck.owner_id !== me.id
  const owner = pool.playerById(deck.owner_id)

  const [name, setName] = useState(deck.name)
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState<AddMode | null>(null)
  const [detail, setDetail] = useState<PoolCard | null>(null)
  const [busy, setBusy] = useState(false)

  const cov = useMemo(() => coverage(deck.cards, pool.cards, pool.loans, me.id), [deck.cards, pool.cards, pool.loans, me.id])
  const visible = cov.rows.filter((r) => {
    if (filter === 'missing') return r.missing > 0
    if (filter === 'borrow') return r.borrowable > 0 || r.pending > 0
    if (filter === 'yours') return r.yours > 0
    return true
  })
  const groups = groupByType(visible)
  const size = deckSize(deck)

  async function save(cards: DeckCard[], nextName = deck.name) {
    try {
      await pool.saveDeck({ ...deck, name: nextName, cards, updated_at: new Date().toISOString() })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  function add(card: DeckCard, label = card.name) {
    void save(addToDeck(deck.cards, card))
    toast(`Added ${label}`)
  }

  async function addMany(cards: DeckCard[]) {
    let next = deck.cards
    for (const c of cards) next = addToDeck(next, c)
    await save(next)
  }

  function rename() {
    const n = name.trim()
    if (!n || n === deck.name) return setName(deck.name)
    void save(deck.cards, n)
  }

  async function removeDeck() {
    if (!confirm(`Delete “${deck.name}”? This cannot be undone.`)) return
    try {
      await pool.removeDeck(deck.id)
      onBack()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(deckToText(deck))
      toast('Copied the list')
    } catch {
      toast('Could not copy. Your browser blocked clipboard access.', 'error')
    }
  }

  async function borrow(r: CardCoverage) {
    const src = r.otherRows[0]
    if (!src) return
    setBusy(true)
    try {
      await pool.requestLoan(src.row.id)
      toast(`Asked ${pool.playerById(src.row.owner_id)?.name ?? 'the owner'} for ${r.card.name}`)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Ask for every missing-but-borrowable card in one go. */
  async function borrowAll() {
    const todo = cov.rows.filter((r) => r.borrowable > 0)
    if (!todo.length) return
    if (!confirm(`Ask to borrow ${todo.length} ${todo.length === 1 ? 'card' : 'cards'} from the pod?`)) return
    setBusy(true)
    let ok = 0
    for (const r of todo) {
      try {
        await pool.requestLoan(r.otherRows[0].row.id)
        ok++
      } catch {
        /* keep going; the row stays borrowable so it can be retried */
      }
    }
    setBusy(false)
    toast(`Asked for ${ok} ${ok === 1 ? 'card' : 'cards'}`)
  }

  const pct = (n: number) => (cov.total ? `${(n / cov.total) * 100}%` : '0%')
  const openDetail = detail ? pool.cards.find((c) => c.id === detail.id) ?? null : null

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn quiet sm icon" onClick={onBack} aria-label="Back to decks">
          <Icons.back />
        </button>
        {readOnly ? (
          <h1 className="title" style={{ flex: 1 }}>
            {deck.name}
          </h1>
        ) : (
          <input
            className="input deck-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Deck name"
          />
        )}
      </div>
      {readOnly && <p className="small muted">{owner?.name ?? 'Someone'}'s deck. Coverage below is from your side of the table.</p>}

      {size > 0 && (
        <div className="deck-summary">
          <div className="cover-bar" aria-hidden="true">
            <i className="yours" style={{ width: pct(cov.yours) }} />
            <i className="pending" style={{ width: pct(cov.pending) }} />
            <i className="borrow" style={{ width: pct(cov.borrowable) }} />
          </div>
          <div className="chips">
            <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All {size}
            </button>
            <button className="chip yours" aria-pressed={filter === 'yours'} onClick={() => setFilter('yours')}>
              In your pile {cov.yours}
            </button>
            <button className="chip borrow" aria-pressed={filter === 'borrow'} onClick={() => setFilter('borrow')}>
              Borrowable {cov.borrowable + cov.pending}
            </button>
            <button className="chip missing" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>
              Missing {cov.missing}
            </button>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="segmented" role="tablist" aria-label="Add cards">
          {(['pool', 'search', 'paste'] as AddMode[]).map((m) => (
            <button key={m} role="tab" aria-pressed={adding === m} onClick={() => setAdding(adding === m ? null : m)}>
              {m === 'pool' ? 'From the pool' : m === 'search' ? 'Search' : 'Paste a list'}
            </button>
          ))}
        </div>
      )}
      {adding === 'pool' && <PoolPicker onPick={(p) => add(fromPoolCard(p))} />}
      {adding === 'search' && <ScryfallPicker onPick={(c) => add(fromScryfall(c))} />}
      {adding === 'paste' && (
        <PasteList
          onAdd={async (cards) => {
            await addMany(cards)
            setAdding(null)
          }}
        />
      )}

      {size === 0 ? (
        <div className="empty">
          <strong>Empty deck</strong>
          <p>{readOnly ? 'Nothing in here yet.' : 'Add cards from the pool, search Scryfall, or paste a list to see what the pod can cover.'}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <strong>Nothing in this view</strong>
          <p>{filter === 'missing' ? 'Every card is covered by you or the pod.' : 'Try another filter.'}</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.type}>
            <h2 className="section-h">
              {g.type} <span>{g.count}</span>
            </h2>
            <div className="deck-rows">
              {g.rows.map((r) => (
                <DeckRow
                  key={r.card.scryfall_id + r.card.name}
                  r={r}
                  readOnly={readOnly}
                  busy={busy}
                  onQty={(q) => void save(setDeckQty(deck.cards, r.card.name, q))}
                  onCommander={() =>
                    void save(deck.cards.map((c) => (c.name === r.card.name ? { ...c, commander: !c.commander } : c)))
                  }
                  onBorrow={() => void borrow(r)}
                  onOpen={(p) => setDetail(p)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {size > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {!readOnly && cov.borrowable > 0 && (
            <button className="btn primary block" disabled={busy} onClick={() => void borrowAll()}>
              Ask to borrow all {cov.borrowable} borrowable {cov.borrowable === 1 ? 'card' : 'cards'}
            </button>
          )}
          <button className="btn block" onClick={() => void copyList()}>
            Copy as a decklist
          </button>
          {!readOnly && (
            <button className="btn quiet block" onClick={() => void removeDeck()}>
              Delete this deck
            </button>
          )}
        </div>
      )}

      {openDetail && <CardDetail card={openDetail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function DeckRow({
  r,
  readOnly,
  busy,
  onQty,
  onCommander,
  onBorrow,
  onOpen,
}: {
  r: CardCoverage
  readOnly: boolean
  busy: boolean
  onQty: (q: number) => void
  onCommander: () => void
  onBorrow: () => void
  onOpen: (p: PoolCard) => void
}) {
  const pool = usePool()
  const c = r.card
  const status =
    r.missing === 0 && r.yours === r.need
      ? 'yours'
      : r.missing === 0
        ? 'covered'
        : r.yours + r.pending + r.borrowable > 0
          ? 'partial'
          : 'missing'
  const lender = r.otherRows[0] ? pool.playerById(r.otherRows[0].row.owner_id)?.name : undefined
  const poolRow = r.yourRows[0] ?? r.otherRows[0]?.row ?? (r.myLoan ? pool.cards.find((p) => p.id === r.myLoan!.card_id) : undefined)
  return (
    <div className={`deck-row ${status}`}>
      <button className="thumb" onClick={() => poolRow && onOpen(poolRow)} disabled={!poolRow} aria-label={poolRow ? `Open ${c.name} in the pool` : c.name}>
        {c.image_small ? <img src={c.image_small} alt="" loading="lazy" /> : <div className="ph" />}
      </button>
      <div className="deck-row-text">
        <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
          <strong>{c.name}</strong>
          {c.commander && <span className="tag-sm">Commander</span>}
        </div>
        <div className="small muted row wrap" style={{ gap: 6 }}>
          <Pips identity={c.color_identity} />
          {r.yours > 0 && <span className="pill yours">{r.yours} in your pile</span>}
          {r.pending > 0 && <span className="pill pending">{r.myLoan?.status === 'lent' ? `${r.pending} with you` : `asked for ${r.pending}`}</span>}
          {r.borrowable > 0 && <span className="pill borrow">{r.borrowable} from {lender}</span>}
          {r.missing > 0 && <span className="pill missing">{r.missing} missing</span>}
        </div>
      </div>
      <div className="deck-row-actions">
        {r.borrowable > 0 && !busy && (
          <button className="btn sm" onClick={onBorrow}>
            Ask
          </button>
        )}
        {readOnly ? (
          <span className="qty-static">×{c.quantity}</span>
        ) : (
          <span className="stepper" role="group" aria-label="Copies">
            <button type="button" onClick={() => onQty(c.quantity - 1)} aria-label="Fewer">
              −
            </button>
            <output>{c.quantity}</output>
            <button type="button" onClick={() => onQty(c.quantity + 1)} aria-label="More">
              +
            </button>
          </span>
        )}
        {!readOnly && (
          <button className="btn quiet sm" onClick={onCommander} title={c.commander ? 'Not the commander' : 'Make this the commander'} aria-label="Toggle commander">
            ★
          </button>
        )}
      </div>
    </div>
  )
}

/** Pick straight from what the pod already has. */
function PoolPicker({ onPick }: { onPick: (p: PoolCard) => void }) {
  const pool = usePool()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      pool.cards
        .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.type_line.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 60),
    [pool.cards, needle],
  )
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="search">
        <Icons.search />
        <input className="input" type="search" placeholder="Search the pool" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search the pool" />
      </div>
      {rows.length === 0 ? (
        <p className="small faint">Nothing in the pool matches.</p>
      ) : (
        <div className="pick-list">
          {rows.map((c) => {
            const loan = pool.activeLoanFor(c.id)
            const mine = c.owner_id === pool.me?.id
            return (
              <button key={c.id} className="pick-row" onClick={() => onPick(c)}>
                <img src={c.image_small} alt="" loading="lazy" />
                <span className="pick-text">
                  <strong>{c.name}</strong>
                  <span className="small muted">
                    {mine ? 'Yours' : pool.playerById(c.owner_id)?.name}
                    {c.quantity > 1 ? ` · ${c.quantity} spare` : ''}
                    {loan ? ' · out on loan' : ''}
                  </span>
                </span>
                <span className="small">Add</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Any card at all, via Scryfall autocomplete. */
function ScryfallPicker({ onPick }: { onPick: (c: ScryfallCard) => void }) {
  const [q, setQ] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      autocomplete(q)
        .then(setNames)
        .catch(() => setNames([]))
    }, 180)
    return () => clearTimeout(t)
  }, [q])
  async function pick(name: string) {
    setErr(null)
    try {
      onPick(await namedExact(name))
      setQ('')
      setNames([])
    } catch (e) {
      setErr(errorText(e))
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="search">
        <Icons.search />
        <input
          className="input"
          placeholder="Card name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && names[0] && void pick(names[0])}
          autoFocus
          aria-label="Search Scryfall"
        />
      </div>
      {err && <div className="notice warn">{err}</div>}
      {names.length > 0 && (
        <div className="suggestions">
          {names.slice(0, 8).map((n) => (
            <button key={n} className="suggestion" onClick={() => void pick(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Paste a whole list; it is resolved against Scryfall and merged into the deck. */
function PasteList({ onAdd }: { onAdd: (cards: DeckCard[]) => Promise<void> }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])

  async function run() {
    const parsed = parseList(text)
    if (parsed.lines.length === 0) {
      toast('No card lines found in that text', 'error')
      return
    }
    setBusy(`Looking up ${parsed.lines.length} cards…`)
    try {
      const resolved = await resolveLines(parsed.lines)
      const cards: DeckCard[] = []
      const miss: string[] = []
      parsed.lines.forEach((line, i) => {
        const c = resolved[i]
        if (c) cards.push(fromScryfall(c, line.quantity))
        else miss.push(line.raw)
      })
      setUnmatched(miss)
      if (cards.length) {
        await onAdd(cards)
        toast(`Added ${cards.reduce((n, c) => n + c.quantity, 0)} cards to the deck`)
        setText('')
      }
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea
        className="textarea"
        placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Command Tower'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Deck list"
      />
      <div className="row between">
        <label className="btn quiet" style={{ cursor: 'pointer' }}>
          Open a .txt or .csv
          <input type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={(e) => e.target.files?.[0] && void e.target.files[0].text().then(setText)} />
        </label>
        <button className="btn primary" onClick={() => void run()} disabled={!text.trim() || !!busy}>
          {busy ?? 'Add to deck'}
        </button>
      </div>
      {unmatched.length > 0 && (
        <div className="notice warn">
          Could not match {unmatched.length} {unmatched.length === 1 ? 'line' : 'lines'}: {unmatched.slice(0, 6).join('; ')}
          {unmatched.length > 6 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

function fromScryfall(c: ScryfallCard, quantity = 1): DeckCard {
  const face = c.card_faces?.[0]
  return {
    scryfall_id: c.id,
    name: c.name,
    quantity,
    type_line: c.type_line ?? face?.type_line ?? '',
    mana_cost: c.mana_cost ?? face?.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    color_identity: c.color_identity ?? [],
    image_small: c.image_uris?.small ?? face?.image_uris?.small ?? '',
    commander: false,
  }
}
