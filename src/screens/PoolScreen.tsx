import { useEffect, useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import type { PoolCard } from '../lib/types'
import { Icons, Pip, Pips } from '../components/ui'
import CardDetail from '../components/CardDetail'
import { audRate, formatAud, usdPrices, type Price } from '../lib/prices'

const PRICES_KEY = 'yipfc/show-prices'

type Pricing = { rate: number; date: string; prices: Record<string, Price | null> }

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'] as const

export default function PoolScreen() {
  const pool = usePool()
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState<string | 'all'>('all')
  const [set, setSet] = useState<string>('all')
  const [type, setType] = useState<string>('all')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [colors, setColors] = useState<string[]>([])
  const [open, setOpen] = useState<PoolCard | null>(null)
  const [showPrices, setShowPrices] = useState(() => localStorage.getItem(PRICES_KEY) === '1')
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [sort, setSort] = useState<'name' | 'price-desc' | 'price-asc'>('name')

  // Fetch today's rate and any prices we do not have yet whenever prices are shown.
  const idKey = pool.cards.map((c) => c.scryfall_id).sort().join(',')
  useEffect(() => {
    localStorage.setItem(PRICES_KEY, showPrices ? '1' : '0')
    if (!showPrices || !idKey) return
    let cancelled = false
    setPriceError(null)
    Promise.all([audRate(), usdPrices(idKey.split(','))])
      .then(([r, prices]) => !cancelled && setPricing({ rate: r.rate, date: r.date, prices }))
      .catch((e) => !cancelled && setPriceError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [showPrices, idKey])

  const audFor = (c: PoolCard): number | null => {
    if (!showPrices || !pricing) return null
    const p = pricing.prices[c.scryfall_id]
    return p ? p.usd * pricing.rate : null
  }

  // Price sorting only makes sense while prices are shown; unpriced cards sink to the bottom.
  const shown = useMemo(() => {
    if (!showPrices || sort === 'name' || !pricing) return filtered
    const dir = sort === 'price-desc' ? -1 : 1
    return filtered
      .map((c) => ({ c, v: audFor(c) }))
      .sort((a, b) => {
        if (a.v === null && b.v === null) return a.c.name.localeCompare(b.c.name)
        if (a.v === null) return 1
        if (b.v === null) return -1
        return (a.v - b.v) * dir || a.c.name.localeCompare(b.c.name)
      })
      .map((x) => x.c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, showPrices, sort, pricing])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pool.cards
      .filter((c) => {
        if (owner !== 'all' && c.owner_id !== owner) return false
        if (set !== 'all' && c.set_code !== set) return false
        if (type !== 'all' && !c.type_line.split(' // ')[0].includes(type)) return false
        if (onlyAvailable && pool.activeLoanFor(c.id)) return false
        if (colors.includes('C') ? c.color_identity.length > 0 : colors.length && !colors.every((col) => c.color_identity.includes(col)))
          return false
        if (!needle) return true
        return (
          c.name.toLowerCase().includes(needle) ||
          c.type_line.toLowerCase().includes(needle) ||
          c.oracle_text.toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [pool.cards, pool.activeLoanFor, q, owner, set, type, onlyAvailable, colors])

  // Colourless is exclusive: a card cannot be both colourless and green.
  const toggleColor = (c: string) =>
    setColors((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : c === 'C' ? ['C'] : [...cs.filter((x) => x !== 'C'), c]))

  const sets = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of pool.cards) if (!m.has(c.set_code)) m.set(c.set_code, c.set_name || c.set_code.toUpperCase())
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [pool.cards])

  const anyFilter = colors.length > 0 || onlyAvailable || owner !== 'all' || set !== 'all' || type !== 'all' || !!q
  const clearAll = () => {
    setColors([])
    setOnlyAvailable(false)
    setOwner('all')
    setSet('all')
    setType('all')
    setQ('')
  }

  // Keep the open sheet pointed at fresh data after a loan changes.
  const openCard = open ? pool.cards.find((c) => c.id === open.id) ?? null : null

  return (
    <>
      <div className="search">
        <Icons.search />
        <input
          className="input"
          type="search"
          placeholder="Search the pool"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search cards by name, type or rules text"
        />
      </div>

      <div className="filters">
        <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="all">Everyone</option>
          {pool.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === pool.me?.id ? 'Mine' : p.name}
            </option>
          ))}
        </select>
        <select className="select" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Set">
          <option value="all">Any set</option>
          {sets.map(([code, name]) => (
            <option key={code} value={code}>
              {name} ({code.toUpperCase()})
            </option>
          ))}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Card type">
          <option value="all">Any type</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="chips">
        <button className="chip" aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable((v) => !v)}>
          Available now
        </button>
        {COLORS.map((c) => (
          <button key={c} className="chip" aria-pressed={colors.includes(c)} onClick={() => toggleColor(c)} aria-label={`Colour ${c}`}>
            <Pip c={c} />
          </button>
        ))}
        <button className="chip" aria-pressed={colors.includes('C')} onClick={() => toggleColor('C')} aria-label="Colourless">
          <Pip c="C" />
        </button>
        {anyFilter && (
          <button className="chip" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>

      <div className="row between wrap" style={{ marginTop: 10, gap: 8 }}>
        <label className="check">
          <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} />
          Show value in AUD
        </label>
        {showPrices && (
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
            <option value="name">Sort: name</option>
            <option value="price-desc">Sort: price, high to low</option>
            <option value="price-asc">Sort: price, low to high</option>
          </select>
        )}
        {showPrices && pricing && filtered.length > 0 && (
          <span className="small muted">
            Shown: {formatAud(filtered.reduce((n, c) => n + (audFor(c) ?? 0) * c.quantity, 0))}
            {' · '}1 USD = {pricing.rate.toFixed(3)} AUD on {pricing.date}
          </span>
        )}
        {showPrices && !pricing && !priceError && <span className="small faint">Fetching prices…</span>}
        {showPrices && priceError && <span className="small" style={{ color: 'var(--rose)' }}>Prices unavailable: {priceError}</span>}
      </div>

      {pool.cards.length === 0 ? (
        <div className="empty">
          <strong>The pool is empty</strong>
          <p>Add the spare cards you would lend out. Scan them with your camera or paste a list from Moxfield or Archidekt.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <strong>Nothing matches</strong>
          <p>Try fewer filters or a shorter search.</p>
        </div>
      ) : (
        <div className="grid">
          {shown.map((c) => (
            <Tile key={c.id} card={c} aud={audFor(c)} foil={pricing?.prices[c.scryfall_id]?.foil} onOpen={() => setOpen(c)} />
          ))}
        </div>
      )}

      {openCard && <CardDetail card={openCard} onClose={() => setOpen(null)} />}
    </>
  )
}

function Tile({ card, aud, foil, onOpen }: { card: PoolCard; aud: number | null; foil?: boolean; onOpen: () => void }) {
  const pool = usePool()
  const loan = pool.activeLoanFor(card.id)
  const owner = pool.playerById(card.owner_id)
  const borrower = loan ? pool.playerById(loan.borrower_id) : undefined
  const mine = card.owner_id === pool.me?.id
  const borrowerIsMe = loan?.borrower_id === pool.me?.id
  return (
    <button className={`tile ${loan?.status === 'lent' ? 'out' : ''}`} onClick={onOpen}>
      <div className="art">
        <img src={card.image_normal || card.image_small} alt="" loading="lazy" />
        {card.quantity > 1 && <span className="qty">×{card.quantity}</span>}
        {aud !== null && (
          <span className="price" title={foil ? 'Foil price; no non-foil price listed' : 'Scryfall price, converted to AUD'}>
            {formatAud(aud)}
            {foil ? ' ✦' : ''}
          </span>
        )}
        {loan?.status === 'lent' && <span className="tag">{borrowerIsMe ? 'With you' : `With ${borrower?.name ?? 'someone'}`}</span>}
        {loan?.status === 'requested' && (
          <span className="tag requested">{borrowerIsMe ? 'You asked' : `${borrower?.name ?? 'Someone'} asked`}</span>
        )}
      </div>
      <div className="name">{card.name}</div>
      <div className="owner row" style={{ gap: 6 }}>
        <Pips identity={card.color_identity} />
        {mine ? 'Yours' : owner?.name ?? 'Unknown'}
      </div>
    </button>
  )
}
