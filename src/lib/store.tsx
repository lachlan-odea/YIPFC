import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LocalStore } from './localStore'
import { SupabaseStore } from './supabaseStore'
import type { Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

const ME_KEY = 'pod-pool/me'

function createStore(): PoolStore {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (url && key) return new SupabaseStore(url, key)
  return new LocalStore()
}

export type ActiveLoan = Loan & { card: PoolCard; borrower?: Player; owner?: Player }

type PoolContext = {
  mode: PoolStore['mode']
  ready: boolean
  error: string | null
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
  me: Player | null
  playerById: (id: string) => Player | undefined
  /** The one open loan (requested or lent) on a card, if any. */
  activeLoanFor: (cardId: string) => Loan | undefined
  setMe: (name: string) => Promise<void>
  addCards: (cards: NewPoolCard[]) => Promise<PoolCard[]>
  updateCard: PoolStore['updateCard']
  removeCard: PoolStore['removeCard']
  requestLoan: (cardId: string) => Promise<void>
  setLoanStatus: (id: string, status: LoanStatus) => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<PoolContext | null>(null)

export function PoolProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createStore, [])
  const [snap, setSnap] = useState<Snapshot>({ players: [], cards: [], loans: [] })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(() => localStorage.getItem(ME_KEY))

  const refresh = useCallback(async () => {
    try {
      const s = await store.load()
      setSnap({ players: [...s.players], cards: [...s.cards], loans: [...s.loans] })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReady(true)
    }
  }, [store])

  useEffect(() => {
    void refresh()
    return store.subscribe(() => void refresh())
  }, [store, refresh])

  const me = useMemo(() => snap.players.find((p) => p.id === meId) ?? null, [snap.players, meId])

  const value = useMemo<PoolContext>(() => {
    const playerById = (id: string) => snap.players.find((p) => p.id === id)
    const activeLoanFor = (cardId: string) =>
      snap.loans.find((l) => l.card_id === cardId && (l.status === 'requested' || l.status === 'lent'))
    return {
      mode: store.mode,
      ready,
      error,
      players: snap.players,
      cards: snap.cards,
      loans: snap.loans,
      me,
      playerById,
      activeLoanFor,
      async setMe(name) {
        const id = meId ?? crypto.randomUUID()
        await store.upsertPlayer({ id, name: name.trim() })
        localStorage.setItem(ME_KEY, id)
        setMeId(id)
        await refresh()
      },
      async addCards(cards) {
        if (!me) throw new Error('Pick your name first.')
        const added = await store.addCards(me.id, cards)
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
      async requestLoan(cardId) {
        if (!me) throw new Error('Pick your name first.')
        await store.createLoan(cardId, me.id)
        await refresh()
      },
      async setLoanStatus(id, status) {
        await store.setLoanStatus(id, status)
        await refresh()
      },
      refresh,
    }
  }, [store, snap, ready, error, me, meId, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePool(): PoolContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePool must be used inside PoolProvider')
  return ctx
}
