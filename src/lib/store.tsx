import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LocalStore } from './localStore'
import { FirebaseStore, firebaseConfigFromEnv } from './firebaseStore'
import type { AuthUser, Deck, Loan, LoanStatus, NewPoolCard, Player, Pod, PoolCard, PoolStore, Snapshot } from './types'

/** Pre-accounts devices kept a random player id here; it is now only used to offer a one-off migration. */
export const LEGACY_ME_KEY = 'pod-pool/me'
const POD_KEY = 'yipfc/pod'
export const PENDING_JOIN_KEY = 'yipfc/pending-join'

function createStore(): PoolStore {
  const config = firebaseConfigFromEnv(import.meta.env)
  if (config) return new FirebaseStore(config)
  return new LocalStore()
}

export type ActiveLoan = Loan & { card: PoolCard; borrower?: Player; owner?: Player }

type PoolContext = {
  mode: PoolStore['mode']
  ready: boolean
  error: string | null
  user: AuthUser | null
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
  decks: Deck[]
  pods: Pod[]
  /** The pod whose pool is on screen, or null for just your own collection. */
  pod: Pod | null
  me: Player | null
  /** A pre-accounts player id found on this device whose cards can be claimed. */
  legacyId: string | null
  /** Invite code picked up from a share link, waiting for sign-in. */
  pendingJoin: string | null
  playerById: (id: string) => Player | undefined
  /** The one open loan (requested or lent) on a card, if any. */
  activeLoanFor: (cardId: string) => Loan | undefined
  signUp: (name: string, email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  setMe: (name: string) => Promise<void>
  setPod: (podId: string | null) => void
  createPod: (name: string) => Promise<Pod>
  joinPod: (code: string) => Promise<Pod>
  leavePod: (podId: string) => Promise<void>
  renamePod: (podId: string, name: string) => Promise<void>
  claimLegacy: () => Promise<number>
  addCards: (cards: NewPoolCard[]) => Promise<PoolCard[]>
  updateCard: PoolStore['updateCard']
  removeCard: PoolStore['removeCard']
  replaceCard: PoolStore['replaceCard']
  requestLoan: (cardId: string) => Promise<void>
  setLoanStatus: (id: string, status: LoanStatus) => Promise<void>
  saveDeck: (deck: Deck) => Promise<void>
  removeDeck: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<PoolContext | null>(null)

const EMPTY: Snapshot = { players: [], cards: [], loans: [], decks: [], pods: [] }

export function PoolProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createStore, [])
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [podId, setPodId] = useState<string | null>(() => localStorage.getItem(POD_KEY))
  const [legacyId, setLegacyId] = useState<string | null>(() => readLegacy())
  const [pendingJoin, setPendingJoin] = useState<string | null>(() => localStorage.getItem(PENDING_JOIN_KEY))

  const refresh = useCallback(async () => {
    try {
      const s = await store.load()
      setSnap({
        players: [...s.players],
        // Rows written before the foil flag existed have no such field.
        cards: s.cards.map((c) => ({ ...c, foil: !!c.foil })),
        loans: [...s.loans],
        decks: [...s.decks],
        pods: [...s.pods],
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDataReady(true)
    }
  }, [store])

  // Auth: who is signed in. Every change rebuilds the data below.
  useEffect(() => {
    return store.onAuth((u) => {
      setUser(u)
      setAuthReady(true)
      setDataReady(false)
    })
  }, [store])

  // Data: follow the store's snapshot for the current user and pod.
  useEffect(() => {
    if (!authReady) return
    store.setPod(podId)
    void refresh()
    return store.subscribe(() => void refresh())
  }, [store, refresh, authReady, user?.id, podId])

  // Keep the active pod valid: fall back to the first pod you are in, or none.
  const pods = snap.pods
  useEffect(() => {
    if (!user || !dataReady) return
    const valid = podId && pods.some((p) => p.id === podId)
    if (!valid) {
      const next = pods[0]?.id ?? null
      if (next !== podId) choosePod(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pods, podId, user, dataReady])

  function choosePod(id: string | null) {
    if (id) localStorage.setItem(POD_KEY, id)
    else localStorage.removeItem(POD_KEY)
    setPodId(id)
  }

  const me = useMemo(() => (user ? snap.players.find((p) => p.id === user.id) ?? null : null), [snap.players, user])
  const pod = useMemo(() => pods.find((p) => p.id === podId) ?? null, [pods, podId])
  const ready = authReady && (!user || dataReady)

  const value = useMemo<PoolContext>(() => {
    const playerById = (id: string) => snap.players.find((p) => p.id === id)
    const activeLoanFor = (cardId: string) =>
      snap.loans.find((l) => l.card_id === cardId && (l.status === 'requested' || l.status === 'lent'))
    const need = () => {
      if (!user) throw new Error('Sign in first.')
      return user.id
    }
    return {
      mode: store.mode,
      ready,
      error,
      user,
      players: snap.players,
      cards: snap.cards,
      loans: snap.loans,
      decks: snap.decks,
      pods,
      pod,
      me,
      legacyId: user && legacyId && legacyId !== user.id ? legacyId : null,
      pendingJoin,
      playerById,
      activeLoanFor,
      signUp: (name, email, password) => store.signUp(name, email, password),
      signIn: (email, password) => store.signIn(email, password),
      async signOut() {
        await store.signOut()
        choosePod(null)
      },
      resetPassword: (email) => store.resetPassword(email),
      async setMe(name) {
        const id = need()
        await store.upsertPlayer({ id, name: name.trim() })
        await refresh()
      },
      setPod: choosePod,
      async createPod(name) {
        const p = await store.createPod(name)
        choosePod(p.id)
        return p
      },
      async joinPod(code) {
        const p = await store.joinPod(code)
        localStorage.removeItem(PENDING_JOIN_KEY)
        setPendingJoin(null)
        choosePod(p.id)
        return p
      },
      async leavePod(id) {
        await store.leavePod(id)
        if (id === podId) choosePod(null)
      },
      async renamePod(id, name) {
        await store.renamePod(id, name)
        await refresh()
      },
      async claimLegacy() {
        if (!legacyId || !store.claimLegacy) return 0
        const n = await store.claimLegacy(legacyId)
        localStorage.removeItem(LEGACY_ME_KEY)
        setLegacyId(null)
        await refresh()
        return n
      },
      async addCards(cards) {
        const added = await store.addCards(need(), cards)
        await refresh()
        return added
      },
      async updateCard(id, patch) {
        await store.updateCard(id, patch)
        await refresh()
      },
      async removeCard(id) {
        await store.removeCard(id)
        await refresh()
      },
      async replaceCard(id, next) {
        const row = await store.replaceCard(id, next)
        await refresh()
        return row
      },
      async requestLoan(cardId) {
        const uid = need()
        const card = snap.cards.find((c) => c.id === cardId)
        if (!card) throw new Error('That card is no longer in the pool.')
        await store.createLoan(cardId, uid, card.owner_id, podId)
        await refresh()
      },
      async setLoanStatus(id, status) {
        await store.setLoanStatus(id, status)
        await refresh()
      },
      async saveDeck(deck) {
        await store.saveDeck(deck)
        await refresh()
      },
      async removeDeck(id) {
        await store.removeDeck(id)
        await refresh()
      },
      refresh,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, snap, ready, error, user, me, pod, pods, podId, legacyId, pendingJoin, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Only a pre-accounts UUID counts as legacy; Firebase uids are 28 characters. */
function readLegacy(): string | null {
  const v = localStorage.getItem(LEGACY_ME_KEY)
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null
}

/** Pull a `#join=CODE` out of the URL (share links) and remember it until sign-in. Call once at startup. */
export function captureJoinLink() {
  const m = /^#join=([A-Za-z0-9]{6})$/.exec(location.hash)
  if (!m) return
  localStorage.setItem(PENDING_JOIN_KEY, m[1].toUpperCase())
  history.replaceState(null, '', `${location.pathname}${location.search}#pool`)
}

export function usePool(): PoolContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePool must be used inside PoolProvider')
  return ctx
}
