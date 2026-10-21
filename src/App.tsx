import { useEffect, useState } from 'react'
import { usePool } from './lib/store'
import { Icons, ToastProvider } from './components/ui'
import PoolScreen from './screens/PoolScreen'
import AddScreen from './screens/AddScreen'
import LoansScreen from './screens/LoansScreen'
import DecksScreen from './screens/DecksScreen'
import { AchievementWatcher } from './components/Achievements'
import PodPanel from './components/PodPanel'
import { errorText, useToast } from './components/ui'
import MeScreen from './screens/MeScreen'
import Welcome from './screens/Welcome'
import LifeScreen from './screens/LifeScreen'

type Tab = 'pool' | 'add' | 'decks' | 'loans' | 'life' | 'me'

const TABS: Array<{ id: Tab; label: string; icon: () => JSX.Element }> = [
  { id: 'pool', label: 'Pool', icon: Icons.pool },
  { id: 'add', label: 'Add', icon: Icons.add },
  { id: 'decks', label: 'Decks', icon: Icons.decks },
  { id: 'loans', label: 'Loans', icon: Icons.loans },
  { id: 'life', label: 'Life', icon: Icons.heart },
]

export default function App() {
  const pool = usePool()
  const [tab, setTab] = useState<Tab>(() => (location.hash.replace('#', '') as Tab) || 'pool')
  const [skippedSetup, setSkippedSetup] = useState(skippedPodSetup)

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

  if (!pool.user) return <Welcome />
  if (!pool.me) return <NamePrompt />
  if (pool.mode === 'shared' && pool.pods.length === 0 && !pool.pendingJoin && !skippedSetup) {
    return (
      <PodSetup
        onSkip={() => {
          sessionStorage.setItem(POD_SKIP_KEY, '1')
          setSkippedSetup(true)
        }}
      />
    )
  }

  // Requests sitting on cards I own, waiting for me to hand them over.
  const waitingOnMe = pool.loans.filter(
    (l) => l.status === 'requested' && pool.cards.find((c) => c.id === l.card_id)?.owner_id === pool.me!.id,
  ).length

  // The life counter takes the whole screen, turned to face everyone at the table.
  if (tab === 'life') {
    return (
      <ToastProvider>
        <AchievementWatcher />
        <JoinWatcher />
        <LifeScreen onExit={() => setTab('pool')} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <AchievementWatcher />
      <JoinWatcher />
      <div className="app">
        <header className="topbar">
          <div className="wordmark">
            <img src={`${import.meta.env.BASE_URL}brand/wordmark-sm.png`} alt="Yes I pay for cardboard" />
            <small>
              {pool.pod ? pool.pod.name : pool.mode === 'shared' ? 'Just your collection' : 'This device'} · {pool.cards.reduce((n, c) => n + c.quantity, 0)} spare cards
              {pool.players.length > 1 ? ` across ${pool.players.length} players` : ''}
            </small>
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

const POD_SKIP_KEY = 'yipfc/pod-setup-skipped'
function skippedPodSetup() {
  return sessionStorage.getItem(POD_SKIP_KEY) === '1'
}

/** Signed in, but no player record yet (first sign-in on a fresh account). */
function NamePrompt() {
  const pool = usePool()
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="app">
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '80dvh' }}>
        <form
          className="stack"
          style={{ width: '100%', maxWidth: 420 }}
          onSubmit={(e) => {
            e.preventDefault()
            pool.setMe(name).catch((ex) => setErr(errorText(ex)))
          }}
        >
          <h1 className="title">What should the pod call you?</h1>
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {err && <div className="notice warn">{err}</div>}
          <button className="btn primary block" disabled={!name.trim()}>
            Continue
          </button>
        </form>
      </main>
    </div>
  )
}

/** First run with an account but no pod: create one, join one, or carry on solo. */
function PodSetup({ onSkip }: { onSkip: () => void }) {
  const pool = usePool()
  return (
    <ToastProvider>
      <div className="app">
        <main style={{ maxWidth: 520, margin: '0 auto' }}>
          <div className="stack" style={{ gap: 16, paddingTop: 24 }}>
            <img className="brand-hero" src={`${import.meta.env.BASE_URL}brand/logo.png`} alt="" style={{ width: 120, height: 120 }} />
            <h1 className="title" style={{ textAlign: 'center' }}>
              Hi {pool.me?.name}. Find your pod.
            </h1>
            <p className="subtitle" style={{ textAlign: 'center' }}>
              A pod is the group of friends whose spare cards you share. Start one and send the code, or enter a code someone sent you.
            </p>
            <PodPanel compact />
            <button
              className="btn quiet block"
              onClick={onSkip}
            >
              Skip for now, just build my collection
            </button>
          </div>
        </main>
      </div>
    </ToastProvider>
  )
}

/** Completes a share-link join once the user is signed in. */
function JoinWatcher() {
  const pool = usePool()
  const toast = useToast()
  const [tried, setTried] = useState<string | null>(null)
  useEffect(() => {
    if (!pool.user || !pool.pendingJoin || tried === pool.pendingJoin) return
    setTried(pool.pendingJoin)
    pool
      .joinPod(pool.pendingJoin)
      .then((p) => toast(`Joined ${p.name}`))
      .catch((e) => toast(errorText(e), 'error'))
  }, [pool, toast, tried])
  return null
}
