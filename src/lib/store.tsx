import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LocalStore } from './localStore'
import { uid } from './uid'
import { FirebaseStore, firebaseConfigFromEnv } from './firebaseStore'
import type { Deck, Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

// Storage keys keep the app's original name so devices that already joined stay signed in.
export const ME_KEY = 'pod-pool/me'

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
  players: Player[]
  cards: PoolCard[]
  loans: Loan[]
  decks: Deck[]
  me: Player | null
  playerById: (id: string) => Player | undefined
  /** The one open loan (requested or lent) on a card, if any. */
  activeLoanFor: (cardId: string) => Loan | undefined
  setMe: (name: string) => Promise<void>
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

export function PoolProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createStore, [])
  const [snap, setSnap] = useState<Snapshot>({ players: [], cards: [], loans: [], decks: [] })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(() => localStorage.getItem(ME_KEY))

  const refresh = useCallback(async () => {
    try {
      const s = await store.load()
      // Rows written before the foil flag existed have no such field.
      setSnap({ players: [...s.players], cards: s.cards.map((c) => ({ ...c, foil: !!c.foil })), loans: [...s.loans], decks: [...s.decks] })
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
      decks: snap.decks,
      me,
      playerById,
      activeLoanFor,
      async setMe(name) {
        const clean = name.trim()
        const sameName = snap.players.find((p) => p.id !== meId && namesMatch(p.name, clean))
        if (!meId && sameName) {
          // Joining on a new device with a name the pod already knows: that is
          // the same person, so sign them in as that player rather than
          // creating a second one.
          localStorage.setItem(ME_KEY, sameName.id)
          setMeId(sameName.id)
          await refresh()
          return
        }
        if (sameName) {
          throw new Error(
            `Someone in the pod is already called ${sameName.name}. Pick another name, or sign out and join as them.`,
          )
        }
        const id = meId ?? uid()
        await store.upsertPlayer({ id, name: clean })
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
      async replaceCard(id, next) {
        const row = await store.replaceCard(id, next)
        await refresh()
        return row
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
  }, [store, snap, ready, error, me, meId, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** "Lachlan", "lachlan " and "LACHLAN" are the same person. */
function namesMatch(a: string, b: string) {
  const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return fold(a) === fold(b)
}

export function usePool(): PoolContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePool must be used inside PoolProvider')
  return ctx
}
