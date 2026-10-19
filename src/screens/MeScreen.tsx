import { useEffect, useState } from 'react'
import { ME_KEY, usePool } from '../lib/store'
import { errorText, useToast } from '../components/ui'

type InstallPrompt = Event & { prompt: () => Promise<void> }

export default function MeScreen() {
  const pool = usePool()
  const toast = useToast()
  const me = pool.me!
  const [name, setName] = useState(me.name)
  const [install, setInstall] = useState<InstallPrompt | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstall(e as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const mine = pool.cards.filter((c) => c.owner_id === me.id)
  const copies = mine.reduce((n, c) => n + c.quantity, 0)
  const out = pool.loans.filter((l) => l.status === 'lent' && mine.some((c) => c.id === l.card_id)).length
  const standalone = matchMedia('(display-mode: standalone)').matches

  async function saveName() {
    if (!name.trim() || name.trim() === me.name) return
    try {
      await pool.setMe(name)
      toast('Name updated')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  async function copyList() {
    const text = mine
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `${c.quantity} ${c.name} (${c.set_code.toUpperCase()}) ${c.collector_number}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied your list')
    } catch {
      toast('Could not copy. Your browser blocked clipboard access.', 'error')
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1 className="title">You</h1>

      <div className="field">
        <label htmlFor="me-name">Your name in the pod</label>
        <div className="row">
          <input id="me-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => void saveName()} disabled={!name.trim() || name.trim() === me.name}>
            Save
          </button>
        </div>
      </div>

      <dl className="kv">
        <dt>Cards you offer</dt>
        <dd>
          {mine.length} {mine.length === 1 ? 'card' : 'cards'}, {copies} {copies === 1 ? 'copy' : 'copies'}
        </dd>
        <dt>Out on loan</dt>
        <dd>{out}</dd>
        <dt>Pod</dt>
        <dd>{pool.players.map((p) => p.name).join(', ') || 'Just you so far'}</dd>
        <dt>Storage</dt>
        <dd>{pool.mode === 'shared' ? 'Shared with the pod, live' : 'This device only'}</dd>
      </dl>

      {pool.mode === 'local' && (
        <div className="notice warn">
          Cards and loans are stored only in this browser. To share with your pod, create a free Firebase project with a
          Firestore database, put its web config in a .env file, and redeploy. The README walks through it.
        </div>
      )}

      {!standalone && (
        <div className="notice">
          {install ? (
            <div className="row between">
              <span>Install YIPFC for a full-screen app with the camera one tap away.</span>
              <button className="btn sm primary" onClick={() => void install.prompt()}>
                Install
              </button>
            </div>
          ) : (
            <>On iPhone: share, then “Add to Home Screen”. On Android: menu, then “Install app”.</>
          )}
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        <button className="btn block" onClick={() => void copyList()} disabled={mine.length === 0}>
          Copy your cards as a decklist
        </button>
        <button
          className="btn quiet block"
          onClick={() => {
            if (confirm('Sign out on this device? Your cards stay in the pool.')) {
              localStorage.removeItem(ME_KEY)
              location.reload()
            }
          }}
        >
          Sign out on this device
        </button>
      </div>

      <p className="small faint">
        Card data and images come from Scryfall. YIPFC is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy.
      </p>
    </div>
  )
}
