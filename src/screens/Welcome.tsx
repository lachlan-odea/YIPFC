import { useState, type FormEvent } from 'react'
import { usePool } from '../lib/store'

export default function Welcome() {
  const pool = usePool()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await pool.setMe(name)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
      setBusy(false)
    }
  }

  const others = pool.players.map((p) => p.name)

  return (
    <div className="app">
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '80dvh' }}>
        <form onSubmit={submit} className="stack" style={{ width: '100%', maxWidth: 420 }}>
          <img className="brand-hero" src={`${import.meta.env.BASE_URL}brand/logo.png`} alt="YIPFC: Yes I pay for cardboard" />
          <h1 className="title">Who are you in the pod?</h1>
          <p className="subtitle">
            Your name goes on the cards you add and the ones you borrow. Already joined on another phone? Type the same
            name and you will pick up where you left off.
          </p>
          <input
            className="input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="nickname"
            list="pod-names"
          />
          {others.length > 0 && (
            <datalist id="pod-names">
              {others.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
          {others.length > 0 && <p className="small faint">Already in the pod: {others.join(', ')}</p>}
          {err && <div className="notice warn">{err}</div>}
          <button className="btn primary block" disabled={!name.trim() || busy}>
            {busy ? 'Joining…' : 'Join the pool'}
          </button>
          <p className="small faint">
            {pool.mode === 'shared'
              ? 'This pool is synced across your pod.'
              : 'No shared pool configured yet, so cards stay on this device. See the README to connect your pod.'}
          </p>
        </form>
      </main>
    </div>
  )
}
