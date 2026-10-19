import { useEffect, useState } from 'react'
import { usePool } from '../lib/store'
import type { PoolCard } from '../lib/types'
import { Pips, Sheet, Stepper, errorText, useToast } from './ui'
import PrintingPicker from './PrintingPicker'
import { toPoolCard, type ScryfallCard } from '../lib/scryfall'

export default function CardDetail({
  card,
  onClose,
  onReplaced,
}: {
  card: PoolCard
  onClose: () => void
  /** Called when the owner swaps printing or finish, which gives the row a new id. */
  onReplaced?: (next: PoolCard) => void
}) {
  const pool = usePool()
  const toast = useToast()
  const loan = pool.activeLoanFor(card.id)
  const owner = pool.playerById(card.owner_id)
  const borrower = loan ? pool.playerById(loan.borrower_id) : undefined
  const mine = card.owner_id === pool.me?.id
  const iAsked = loan?.borrower_id === pool.me?.id
  const [notes, setNotes] = useState(card.notes)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      toast(label)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} label={card.name}>
      <div className="detail">
        {card.image_back ? (
          <button className={`flip ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the front face' : 'Show the back face'}>
            <span className="flip-inner">
              <img className="face front" src={card.image_normal || card.image_small} alt={`${card.name} front face`} />
              <img className="face back" src={card.image_back} alt={`${card.name} back face`} loading="lazy" />
            </span>
            <span className="flip-hint">{flipped ? 'Tap to flip back' : 'Tap to flip'}</span>
          </button>
        ) : (
          <img src={card.image_normal || card.image_small} alt={`${card.name} card`} />
        )}
        <div>
          <h2>{card.name}</h2>
          <div className="meta">{card.type_line}</div>
          <div className="meta row" style={{ gap: 8, marginTop: 6 }}>
            <Pips identity={card.color_identity} />
            <span>
              {card.set_name} · #{card.collector_number}
            </span>
          </div>
          <div className="meta" style={{ marginTop: 10 }}>
            {mine ? 'Yours' : `${owner?.name ?? 'Unknown'}'s`}
            {card.quantity > 1 ? ` · ${card.quantity} spare` : ' · 1 spare'}
            {card.foil ? ' · Foil' : ''}
          </div>

          <div style={{ marginTop: 14 }}>
            {!loan && <span className="status available">Available to borrow</span>}
            {loan?.status === 'requested' && (
              <span className="status requested">{iAsked ? 'You asked to borrow this' : `${borrower?.name} asked to borrow this`}</span>
            )}
            {loan?.status === 'lent' && (
              <span className="status lent">{iAsked ? 'You have this one' : `With ${borrower?.name}`}</span>
            )}
          </div>
        </div>
      </div>

      {card.notes && !mine && <p className="oracle">{card.notes}</p>}

      <div className="stack" style={{ marginTop: 20 }}>
        {/* Borrower side */}
        {!mine && !loan && (
          <button className="btn primary block" disabled={busy} onClick={() => run('Asked to borrow', () => pool.requestLoan(card.id))}>
            Ask {owner?.name ?? 'the owner'} to borrow it
          </button>
        )}
        {!mine && loan && iAsked && loan.status === 'requested' && (
          <button className="btn quiet block" disabled={busy} onClick={() => run('Request withdrawn', () => pool.setLoanStatus(loan.id, 'declined'))}>
            Withdraw request
          </button>
        )}
        {!mine && loan && iAsked && loan.status === 'lent' && (
          <button className="btn block" disabled={busy} onClick={() => run('Marked as returned', () => pool.setLoanStatus(loan.id, 'returned'))}>
            I gave it back
          </button>
        )}

        {/* Owner side */}
        {mine && loan?.status === 'requested' && (
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => run(`Lent to ${borrower?.name}`, () => pool.setLoanStatus(loan.id, 'lent'))}>
              Hand it to {borrower?.name}
            </button>
            <button className="btn quiet" disabled={busy} onClick={() => run('Declined', () => pool.setLoanStatus(loan.id, 'declined'))}>
              Decline
            </button>
          </div>
        )}
        {mine && loan?.status === 'lent' && (
          <button className="btn block" disabled={busy} onClick={() => run('Back in the pool', () => pool.setLoanStatus(loan.id, 'returned'))}>
            {borrower?.name} gave it back
          </button>
        )}
        {mine && (
          <>
            <div className="row between">
              <span className="muted">Spare copies</span>
              <Stepper value={card.quantity} onChange={(n) => void pool.updateCard(card.id, { quantity: n })} />
            </div>
            <EditPrinting card={card} locked={!!loan} onReplaced={onReplaced ?? onClose} />
            <div className="field">
              <label htmlFor="notes">Note for borrowers</label>
              <input
                id="notes"
                className="input"
                placeholder="Foil, signed, please sleeve it…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== card.notes && void pool.updateCard(card.id, { notes })}
              />
            </div>
            <button
              className="btn danger block"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove ${card.name} from the pool?`))
                  void run('Removed from the pool', async () => {
                    await pool.removeCard(card.id)
                    onClose()
                  })
              }}
            >
              Remove from pool
            </button>
          </>
        )}
      </div>

      {card.oracle_text && <p className="oracle">{card.oracle_text}</p>}
    </Sheet>
  )
}

/** Owner-only: pick a different printing or flip foil, then save. The row is replaced, so a loan must not be open. */
function EditPrinting({ card, locked, onReplaced }: { card: PoolCard; locked: boolean; onReplaced: (next: PoolCard) => void }) {
  const pool = usePool()
  const toast = useToast()
  const [printing, setPrinting] = useState<ScryfallCard>(() => asScryfall(card))
  const [foil, setFoil] = useState(card.foil)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setPrinting(asScryfall(card))
    setFoil(card.foil)
  }, [card.id, card.foil]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = printing.id !== card.scryfall_id || foil !== card.foil

  async function save() {
    setBusy(true)
    try {
      const next = await pool.replaceCard(card.id, toPoolCard(printing, card.quantity, card.notes, foil))
      toast(`Now ${next.set_code.toUpperCase()} #${next.collector_number}${foil ? ', foil' : ''}`)
      onReplaced(next)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {locked ? (
        <p className="small faint">Printing and finish can be changed once the loan on this card is closed.</p>
      ) : (
        <PrintingPicker name={card.name} selected={printing} onSelect={setPrinting} />
      )}
      <label className="check">
        <input type="checkbox" checked={foil} disabled={locked} onChange={(e) => setFoil(e.target.checked)} />
        Foil
      </label>
      {dirty && !locked && (
        <button className="btn primary block" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save printing and finish'}
        </button>
      )}
    </div>
  )
}

/** Just enough of a Scryfall card for the printing picker to show the current choice. */
function asScryfall(card: PoolCard): ScryfallCard {
  return {
    id: card.scryfall_id,
    name: card.name,
    set: card.set_code,
    set_name: card.set_name,
    collector_number: card.collector_number,
    type_line: card.type_line,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    color_identity: card.color_identity,
    rarity: card.rarity,
    oracle_text: card.oracle_text,
    image_uris: { small: card.image_small, normal: card.image_normal },
  }
}
