import { useState } from 'react'
import { usePool, type ActiveLoan } from '../lib/store'
import type { Loan, PoolCard } from '../lib/types'
import { errorText, useToast } from '../components/ui'
import CardDetail from '../components/CardDetail'

export default function LoansScreen() {
  const pool = usePool()
  const toast = useToast()
  const [open, setOpen] = useState<PoolCard | null>(null)
  const me = pool.me!

  const enrich = (l: Loan): ActiveLoan | null => {
    const card = pool.cards.find((c) => c.id === l.card_id)
    if (!card) return null
    return { ...l, card, borrower: pool.playerById(l.borrower_id), owner: pool.playerById(card.owner_id) }
  }
  const all = pool.loans.map(enrich).filter((l): l is ActiveLoan => !!l)

  const waitingOnMe = all.filter((l) => l.status === 'requested' && l.card.owner_id === me.id)
  const lentByMe = all.filter((l) => l.status === 'lent' && l.card.owner_id === me.id)
  const borrowing = all.filter((l) => l.status === 'lent' && l.borrower_id === me.id)
  const myRequests = all.filter((l) => l.status === 'requested' && l.borrower_id === me.id)
  const history = all
    .filter((l) => l.status === 'returned' || l.status === 'declined')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 12)

  async function set(l: Loan, status: Loan['status'], label: string) {
    try {
      await pool.setLoanStatus(l.id, status)
      toast(label)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const nothing = waitingOnMe.length + lentByMe.length + borrowing.length + myRequests.length === 0

  return (
    <>
      <h1 className="title">Loans</h1>
      {nothing && (
        <div className="empty">
          <strong>Nothing out on loan</strong>
          <p>When someone asks for one of your cards, or you ask for theirs, it shows up here.</p>
        </div>
      )}

      {waitingOnMe.length > 0 && (
        <>
          <h2 className="section-h">
            Waiting on you <span>{waitingOnMe.length}</span>
          </h2>
          <div className="loan-list">
            {waitingOnMe.map((l) => (
              <LoanRow key={l.id} loan={l} who={`${l.borrower?.name} wants to borrow this`} onOpen={() => setOpen(l.card)}>
                <button className="btn primary sm" onClick={() => void set(l, 'lent', `Lent to ${l.borrower?.name}`)}>
                  Hand it over
                </button>
                <button className="btn quiet sm" onClick={() => void set(l, 'declined', 'Declined')}>
                  Decline
                </button>
              </LoanRow>
            ))}
          </div>
        </>
      )}

      {borrowing.length > 0 && (
        <>
          <h2 className="section-h">
            You have borrowed <span>{borrowing.length}</span>
          </h2>
          <div className="loan-list">
            {borrowing.map((l) => (
              <LoanRow key={l.id} loan={l} who={`${l.owner?.name}'s card, since ${since(l.updated_at)}`} onOpen={() => setOpen(l.card)}>
                <button className="btn sm" onClick={() => void set(l, 'returned', 'Marked as returned')}>
                  Gave it back
                </button>
              </LoanRow>
            ))}
          </div>
        </>
      )}

      {lentByMe.length > 0 && (
        <>
          <h2 className="section-h">
            Out on loan from you <span>{lentByMe.length}</span>
          </h2>
          <div className="loan-list">
            {lentByMe.map((l) => (
              <LoanRow key={l.id} loan={l} who={`With ${l.borrower?.name} since ${since(l.updated_at)}`} onOpen={() => setOpen(l.card)}>
                <button className="btn sm" onClick={() => void set(l, 'returned', 'Back in the pool')}>
                  Got it back
                </button>
              </LoanRow>
            ))}
          </div>
        </>
      )}

      {myRequests.length > 0 && (
        <>
          <h2 className="section-h">
            Your requests <span>{myRequests.length}</span>
          </h2>
          <div className="loan-list">
            {myRequests.map((l) => (
              <LoanRow key={l.id} loan={l} who={`Asked ${l.owner?.name} ${since(l.requested_at)}`} onOpen={() => setOpen(l.card)}>
                <button className="btn quiet sm" onClick={() => void set(l, 'declined', 'Request withdrawn')}>
                  Withdraw
                </button>
              </LoanRow>
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <h2 className="section-h">
            Recent <span>last {history.length}</span>
          </h2>
          <div className="loan-list">
            {history.map((l) => (
              <LoanRow
                key={l.id}
                loan={l}
                who={
                  l.status === 'returned'
                    ? `${l.borrower?.name} returned it to ${l.owner?.name} ${since(l.updated_at)}`
                    : `${l.borrower?.name}'s request was declined ${since(l.updated_at)}`
                }
                onOpen={() => setOpen(l.card)}
              />
            ))}
          </div>
        </>
      )}

      {open && <CardDetail card={pool.cards.find((c) => c.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  )
}

function LoanRow({ loan, who, onOpen, children }: { loan: ActiveLoan; who: string; onOpen: () => void; children?: React.ReactNode }) {
  return (
    <div className="loan">
      <button onClick={onOpen} aria-label={`Open ${loan.card.name}`}>
        <img src={loan.card.image_small || loan.card.image_normal} alt="" loading="lazy" />
      </button>
      <div>
        <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{loan.card.name}</div>
        <div className="who">{who}</div>
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

function since(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
