import type { LiveSessions } from './types'
import type { LiveSession, SessionEvent } from './session'

/**
 * Pod sessions kept in memory on one device: for developing the pod-mode
 * screen without a Firebase project. Attached to the local store only in
 * dev builds with `?fakelive` in the URL, so a phone in single-device mode
 * never offers a "pod session" it cannot actually share.
 */
export function memorySessions(): LiveSessions {
  const docs = new Map<string, LiveSession>()
  const watchers = new Set<() => void>()
  const notify = () => watchers.forEach((w) => w())
  const setPath = (obj: Record<string, unknown>, path: string, value: unknown) => {
    const parts = path.split('.')
    let cur = obj
    for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>
    cur[parts[parts.length - 1]] = value
  }
  return {
    watchOpenSessions(podId, cb) {
      const run = () => cb([...docs.values()].filter((s) => s.pod_id === podId && s.status === 'open'))
      watchers.add(run)
      run()
      return () => watchers.delete(run)
    },
    watchSession(id, cb) {
      const run = () => cb(docs.get(id) ? structuredClone(docs.get(id)!) : null)
      watchers.add(run)
      run()
      return () => watchers.delete(run)
    },
    async createSession(session) {
      const id = `mem-${docs.size + 1}`
      docs.set(id, { ...structuredClone(session), id })
      notify()
      return id
    },
    async joinSession(id, uid, seat) {
      const s = docs.get(id)
      if (!s) throw new Error('No such session.')
      s.seats[uid] = structuredClone(seat)
      if (!s.order.includes(uid)) s.order = [...s.order, uid]
      notify()
    },
    async updateSession(id, fields, events: SessionEvent[], replaceLog = false) {
      const s = docs.get(id)
      if (!s) throw new Error('No such session.')
      const obj = s as unknown as Record<string, unknown>
      for (const [k, v] of Object.entries(fields)) setPath(obj, k, structuredClone(v))
      if (replaceLog) s.log = [...events]
      else s.log = [...s.log, ...events]
      notify()
    },
  }
}
