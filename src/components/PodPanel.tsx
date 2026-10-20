import { useState } from 'react'
import { usePool } from '../lib/store'
import { errorText, useToast } from './ui'

/**
 * Pod management: which pod you are looking at, its invite code and share
 * link, creating a new pod, joining one by code, and leaving. Used on the You
 * tab and on the first-run screen for people with no pod yet.
 */
export default function PodPanel({ compact = false }: { compact?: boolean }) {
  const pool = usePool()
  const toast = useToast()
  const [newName, setNewName] = useState('')
  const [code, setCode] = useState(pool.pendingJoin ?? '')
  const [busy, setBusy] = useState(false)
  const [rename, setRename] = useState<string | null>(null)

  if (pool.mode !== 'shared') {
    return <div className="notice">Pods need the shared pool. Once Firebase is connected (see the README) you can invite friends with a code or link.</div>
  }

  const pod = pool.pod
  const link = pod ? `${location.origin}${import.meta.env.BASE_URL}#join=${pod.code}` : ''
  const isCreator = pod?.created_by === pool.user?.id

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    if (!pod) return
    const text = `Join my pod "${pod.name}" on YIPFC. Code ${pod.code}, or tap: ${link}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my YIPFC pod', text, url: link })
        return
      } catch {
        /* user dismissed; fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      toast('Invite link copied')
    } catch {
      toast('Could not copy. The code is shown above.', 'error')
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {pool.pods.length > 1 && (
        <div className="chips">
          {pool.pods.map((p) => (
            <button key={p.id} className="chip" aria-pressed={p.id === pod?.id} onClick={() => pool.setPod(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {pod ? (
        <div className="pod-card">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              {rename !== null ? (
                <div className="row" style={{ gap: 6 }}>
                  <input className="input sm" value={rename} onChange={(e) => setRename(e.target.value)} aria-label="Pod name" autoFocus />
                  <button
                    className="btn sm primary"
                    disabled={busy || !rename.trim()}
                    onClick={() =>
                      void run(async () => {
                        await pool.renamePod(pod.id, rename)
                        setRename(null)
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="btn sm quiet" onClick={() => setRename(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <h3 className="pod-name">
                  {pod.name}
                  {isCreator && (
                    <button className="btn quiet sm" style={{ marginLeft: 8 }} onClick={() => setRename(pod.name)}>
                      Rename
                    </button>
                  )}
                </h3>
              )}
              <div className="small muted">
                {pod.members.length} {pod.members.length === 1 ? 'member' : 'members'}:{' '}
                {pod.members.map((m) => pool.playerById(m)?.name ?? '…').join(', ')}
              </div>
            </div>
          </div>
          <div className="pod-code" aria-label={`Invite code ${pod.code.split('').join(' ')}`}>
            {pod.code}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => void share()}>
              Share invite
            </button>
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pod.code)
                  .then(() => toast('Code copied'))
                  .catch(() => toast('Could not copy', 'error'))
              }
            >
              Copy code
            </button>
            {!compact && (
              <button
                className="btn quiet"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Leave "${pod.name}"? Your cards stay yours; the pod just stops seeing them.`)) void run(() => pool.leavePod(pod.id))
                }}
              >
                Leave pod
              </button>
            )}
          </div>
          <p className="small faint">Anyone with the code or link can join. Share it with your pod, not the internet.</p>
        </div>
      ) : (
        <p className="muted">You are not in a pod yet. Your collection is still yours; a pod is how friends see each other's spares.</p>
      )}

      <div className="pod-forms">
        <form
          className="stack"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!newName.trim()) return
            void run(async () => {
              const p = await pool.createPod(newName)
              setNewName('')
              toast(`Created ${p.name}. Share the code to invite people.`)
            })
          }}
        >
          <label className="small muted" htmlFor="pod-new">
            Start a new pod
          </label>
          <div className="row" style={{ gap: 6 }}>
            <input id="pod-new" className="input" placeholder="Pod name, e.g. Tuesday night crew" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn primary" disabled={busy || !newName.trim()}>
              Create
            </button>
          </div>
        </form>
        <form
          className="stack"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const p = await pool.joinPod(code)
              setCode('')
              toast(`Joined ${p.name}`)
            })
          }}
        >
          <label className="small muted" htmlFor="pod-code">
            Join with a code
          </label>
          <div className="row" style={{ gap: 6 }}>
            <input
              id="pod-code"
              className="input code"
              placeholder="ABC123"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 6}>
              Join
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
