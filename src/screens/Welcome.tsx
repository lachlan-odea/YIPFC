import { useState, type FormEvent } from 'react'
import { usePool } from '../lib/store'
import { errorText } from '../components/ui'

type Mode = 'in' | 'up' | 'reset'

/**
 * First screen. In shared mode it is an email and password sign-in with
 * account creation; in single-device mode it only asks for a name.
 */
export default function Welcome() {
  const pool = usePool()
  const shared = pool.mode === 'shared'
  const [mode, setMode] = useState<Mode>('up')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setInfo(null)
    setBusy(true)
    try {
      if (!shared) await pool.signUp(name, '', '')
      else if (mode === 'up') await pool.signUp(name, email, password)
      else if (mode === 'in') await pool.signIn(email, password)
      else {
        await pool.resetPassword(email)
        setInfo('Reset email sent. Check your inbox, then sign in with the new password.')
        setMode('in')
      }
    } catch (ex) {
      setErr(errorText(ex))
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = !shared ? !!name.trim() : mode === 'up' ? !!name.trim() && !!email.trim() && password.length >= 6 : mode === 'in' ? !!email.trim() && !!password : !!email.trim()

  return (
    <div className="app">
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '80dvh' }}>
        <form onSubmit={submit} className="stack" style={{ width: '100%', maxWidth: 420 }}>
          <img className="brand-hero" src={`${import.meta.env.BASE_URL}brand/logo.png`} alt="YIPFC: Yes I pay for cardboard" />

          {pool.pendingJoin && (
            <div className="notice">
              You have been invited to a pod (code <strong>{pool.pendingJoin}</strong>). Sign in or create an account and you will join it.
            </div>
          )}

          {!shared ? (
            <>
              <h1 className="title">Who are you?</h1>
              <p className="subtitle">Your name goes on the cards you add. This device keeps its own pile until the shared pool is set up.</p>
              <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="nickname" />
            </>
          ) : (
            <>
              <div className="segmented" role="tablist" aria-label="Sign in or create an account">
                <button type="button" role="tab" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>
                  Create account
                </button>
                <button type="button" role="tab" aria-pressed={mode !== 'up'} onClick={() => setMode('in')}>
                  Sign in
                </button>
              </div>
              <h1 className="title">{mode === 'up' ? 'Start your collection' : mode === 'in' ? 'Welcome back' : 'Reset your password'}</h1>
              <p className="subtitle">
                {mode === 'up'
                  ? 'Your account holds your spare cards. Join a pod and they are pooled with your friends; join another pod and they come along too.'
                  : mode === 'in'
                    ? 'Your cards, decks and loans are wherever you sign in.'
                    : 'We will email you a link to choose a new password.'}
              </p>
              {mode === 'up' && (
                <input className="input" placeholder="Your name (what the pod sees)" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="nickname" />
              )}
              <input
                className="input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                autoFocus={mode !== 'up'}
              />
              {mode !== 'reset' && (
                <input
                  className="input"
                  type="password"
                  placeholder={mode === 'up' ? 'Password (6+ characters)' : 'Password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                />
              )}
            </>
          )}

          {err && <div className="notice warn">{err}</div>}
          {info && <div className="notice">{info}</div>}

          <button className="btn primary block" disabled={!canSubmit || busy}>
            {busy ? 'One moment…' : !shared ? 'Start' : mode === 'up' ? 'Create account' : mode === 'in' ? 'Sign in' : 'Send reset email'}
          </button>

          {shared && mode === 'in' && (
            <button type="button" className="btn quiet block" onClick={() => setMode('reset')}>
              Forgot your password?
            </button>
          )}
          {shared && mode === 'reset' && (
            <button type="button" className="btn quiet block" onClick={() => setMode('in')}>
              Back to sign in
            </button>
          )}

          <p className="small faint">
            {shared ? 'Synced across your devices and your pod.' : 'No shared pool configured yet, so cards stay on this device. See the README to connect your pod.'}
          </p>
        </form>
      </main>
    </div>
  )
}
