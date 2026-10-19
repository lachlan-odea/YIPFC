import { useEffect, useMemo, useState } from 'react'
import { usePool } from '../lib/store'
import type { PoolCard } from '../lib/types'
import { Icons, Pips } from '../components/ui'
import CardDetail from '../components/CardDetail'
import { audRate, formatAud, usdPrices, type Price } from '../lib/prices'

const PRICES_KEY = 'yipfc/show-prices'

type Pricing = { rate: number; date: string; prices: Record<string, Price | null> }

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

export default function PoolScreen() {
  const pool = usePool()
  const [q, setQ] = useState('')
  const [owner, setOwner] = useState<string | 'all' | 'others'>('all')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [colors, setColors] = useState<string[]>([])
  const [open, setOpen] = useState<PoolCard | null>(null)
  const [showPrices, setShowPrices] = useState(() => localStorage.getItem(PRICES_KEY) === '1')
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pool.cards
      .filter((c) => {
        if (owner === 'others' && c.owner_id === pool.me?.id) return false
        if (owner !== 'all' && owner !== 'others' && c.owner_id !== owner) return false
        if (onlyAvailable && pool.activeLoanFor(c.id)) return false
        if (colors.length && !colors.every((col) => c.color_identity.includes(col))) return false
        if (!needle) return true
        return (
          c.name.toLowerCase().includes(needle) ||
          c.type_line.toLowerCase().includes(needle) ||
          c.oracle_text.toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [pool.cards, pool.me, pool.activeLoanFor, q, owner, onlyAvailable, colors])

  const toggleColor = (c: string) => setColors((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))

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

      <div className="chips" style={{ marginTop: 10 }}>
        <button className="chip" aria-pressed={owner === 'all'} onClick={() => setOwner('all')}>
          Everyone
        </button>
        <button className="chip" aria-pressed={owner === 'others'} onClick={() => setOwner('others')}>
          Not mine
        </button>
        {pool.players.map((p) => (
          <button key={p.id} className="chip" aria-pressed={owner === p.id} onClick={() => setOwner(p.id)}>
            {p.id === pool.me?.id ? 'Mine' : p.name}
          </button>
        ))}
      </div>
      <div className="chips">
        <button className="chip" aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable((v) => !v)}>
          Available now
        </button>
        {COLORS.map((c) => (
          <button key={c} className="chip" aria-pressed={colors.includes(c)} onClick={() => toggleColor(c)} aria-label={`Colour ${c}`}>
            <i className={`pip ${c}`} />
          </button>
        ))}
        {(colors.length > 0 || onlyAvailable || owner !== 'all' || q) && (
          <button
            className="chip"
            onClick={() => {
              setColors([])
              setOnlyAvailable(false)
              setOwner('all')
              setQ('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="row between wrap" style={{ marginTop: 10, gap: 8 }}>
        <label className="check">
          <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} />
          Show value in AUD
        </label>
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
          {filtered.map((c) => (
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
