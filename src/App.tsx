import { useEffect, useState } from 'react'
import { usePool } from './lib/store'
import { Icons, ToastProvider } from './components/ui'
import PoolScreen from './screens/PoolScreen'
import AddScreen from './screens/AddScreen'
import LoansScreen from './screens/LoansScreen'
import DecksScreen from './screens/DecksScreen'
import MeScreen from './screens/MeScreen'
import Welcome from './screens/Welcome'

type Tab = 'pool' | 'add' | 'decks' | 'loans' | 'me'

const TABS: Array<{ id: Tab; label: string; icon: () => JSX.Element }> = [
  { id: 'pool', label: 'Pool', icon: Icons.pool },
  { id: 'add', label: 'Add', icon: Icons.add },
  { id: 'decks', label: 'Decks', icon: Icons.decks },
  { id: 'loans', label: 'Loans', icon: Icons.loans },
]

export default function App() {
  const pool = usePool()
  const [tab, setTab] = useState<Tab>(() => (location.hash.replace('#', '') as Tab) || 'pool')

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`)
    window.scrollTo({ top: 0 })
  }, [tab])

  if (!pool.ready) {
    return (
      <div className="app">
        <div className="empty">
          <strong>Opening the pool…</strong>
        </div>
      </div>
    )
  }

  if (!pool.me) return <Welcome />

  // Requests sitting on cards I own, waiting for me to hand them over.
  const waitingOnMe = pool.loans.filter(
    (l) => l.status === 'requested' && pool.cards.find((c) => c.id === l.card_id)?.owner_id === pool.me!.id,
  ).length

  return (
    <ToastProvider>
      <div className="app">
        <header className="topbar">
          <div className="wordmark">
            <img src={`${import.meta.env.BASE_URL}brand/wordmark-sm.png`} alt="Yes I pay for cardboard" />
            <small>{pool.cards.reduce((n, c) => n + c.quantity, 0)} spare cards across {pool.players.length} players</small>
          </div>
          <div className="topbar-right">
            <span className={`mode-pill ${pool.mode}`} title={pool.mode === 'shared' ? 'Synced with your pod' : 'Only on this device'}>
              {pool.mode === 'shared' ? 'Synced' : 'This device'}
            </span>
            <button
              className="me-btn"
              onClick={() => setTab('me')}
              aria-current={tab === 'me' ? 'page' : undefined}
              aria-label={`You: ${pool.me.name}`}
              title="Your profile and settings"
            >
              <Icons.me />
              <span>{pool.me.name.split(' ')[0]}</span>
            </button>
          </div>
        </header>
        <main>
          {pool.error && <div className="notice warn">Could not reach the shared pool: {pool.error}</div>}
          {tab === 'pool' && <PoolScreen />}
          {tab === 'add' && <AddScreen onDone={() => setTab('pool')} />}
          {tab === 'decks' && <DecksScreen />}
          {tab === 'loans' && <LoansScreen />}
          {tab === 'me' && <MeScreen />}
        </main>
        <nav className="tabbar" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <t.icon />
              {t.label}
              {t.id === 'loans' && waitingOnMe > 0 && <span className="badge">{waitingOnMe}</span>}
            </button>
          ))}
        </nav>
      </div>
    </ToastProvider>
  )
}
