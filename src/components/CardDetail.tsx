import { useState } from 'react'
import { usePool } from '../lib/store'
import type { PoolCard } from '../lib/types'
import { Pips, Sheet, Stepper, errorText, useToast } from './ui'

export default function CardDetail({ card, onClose }: { card: PoolCard; onClose: () => void }) {
  const pool = usePool()
  const toast = useToast()
  const loan = pool.activeLoanFor(card.id)
  const owner = pool.playerById(card.owner_id)
  const borrower = loan ? pool.playerById(loan.borrower_id) : undefined
  const mine = card.owner_id === pool.me?.id
  const iAsked = loan?.borrower_id === pool.me?.id
  const [notes, setNotes] = useState(card.notes)
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
        <img src={card.image_normal || card.image_small} alt={`${card.name} card`} />
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
