import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import type { Deck, Loan, LoanStatus, NewPoolCard, Player, PoolCard, PoolStore, Snapshot } from './types'

export type FirebaseConfig = {
  apiKey: string
  projectId: string
  appId: string
  authDomain?: string
}

/** Firestore limits a single transaction or batch to 500 writes. */
const WRITE_CHUNK = 400

/**
 * Shared store for the whole pod, backed by Cloud Firestore.
 *
 * Three top-level collections mirror the three types in ./types:
 *   players/{id}  cards/{id}  loans/{id}  decks/{id}
 *
 * A card's document id is `${owner_id}__${scryfall_id}`, so "same owner, same
 * printing" lands on the same document and addCards can bump quantity instead
 * of duplicating. Rules live in /firestore.rules.
 *
 * Each collection has one realtime listener. The latest result is kept here
 * and handed back from load(), so the UI's refresh-after-write pattern costs
 * no extra reads; Firestore applies local writes to the listener before the
 * write promise resolves, so refresh() sees them immediately.
 */
export class FirebaseStore implements PoolStore {
  readonly mode = 'shared' as const
  private db: Firestore
  private listeners = new Set<() => void>()
  private snap: Snapshot = { players: [], cards: [], loans: [], decks: [] }
  private unsubs: Unsubscribe[] = []
  private firstLoad: Promise<void> | null = null

  constructor(config: FirebaseConfig) {
    this.db = connect(config).db
  }

  // ---- reading -----------------------------------------------------------

  async load(): Promise<Snapshot> {
    await this.start()
    return this.snap
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  /** Attach the realtime listeners once; resolve after each has fired. */
  private start(): Promise<void> {
    if (this.firstLoad) return this.firstLoad
    this.firstLoad = new Promise<void>((resolve, reject) => {
      let pending = 4
      const done = () => {
        pending -= 1
        if (pending === 0) resolve()
      }
      const attach = <T>(
        name: keyof Snapshot,
        sort: (a: T, b: T) => number,
      ) => {
        let seen = false
        const unsub = onSnapshot(
          collection(this.db, name),
          (qs: QuerySnapshot) => {
            const rows = qs.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as unknown as T)
            rows.sort(sort)
            this.snap = { ...this.snap, [name]: rows }
            if (!seen) {
              seen = true
              done()
            } else {
              this.notify()
            }
          },
          (err) => {
            if (!seen) reject(err)
            else console.error(`[yipfc] ${name} listener`, err)
          },
        )
        this.unsubs.push(unsub)
      }
      attach<Player>('players', (a, b) => a.name.localeCompare(b.name))
      attach<PoolCard>('cards', (a, b) => a.name.localeCompare(b.name))
      attach<Loan>('loans', (a, b) => b.requested_at.localeCompare(a.requested_at))
      attach<Deck>('decks', (a, b) => b.updated_at.localeCompare(a.updated_at))
    })
    return this.firstLoad
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }

  // ---- writing -----------------------------------------------------------

  async upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player> {
    const ref = doc(this.db, 'players', player.id)
    const existing = this.snap.players.find((p) => p.id === player.id)
    const row: Player = existing
      ? { ...existing, name: player.name }
      : { id: player.id, name: player.name, created_at: new Date().toISOString() }
    await setDoc(ref, strip(row), { merge: true })
    return row
  }

  async addCards(ownerId: string, cards: NewPoolCard[]): Promise<PoolCard[]> {
    const now = new Date().toISOString()
    const added: PoolCard[] = []
    for (let i = 0; i < cards.length; i += WRITE_CHUNK) {
      const chunk = cards.slice(i, i + WRITE_CHUNK)
      const rows = await runTransaction(this.db, async (tx) => {
        const refs = chunk.map((c) => doc(this.db, 'cards', cardDocId(ownerId, c.scryfall_id, c.foil)))
        // All reads must happen before any write inside a transaction.
        const snaps = await Promise.all(refs.map((r) => tx.get(r)))
        const out: PoolCard[] = []
        chunk.forEach((c, j) => {
          const ref = refs[j]
          const existing = snaps[j].data() as Omit<PoolCard, 'id'> | undefined
          if (existing) {
            const quantity = existing.quantity + c.quantity
            tx.update(ref, { quantity })
            out.push({ ...existing, id: ref.id, quantity })
          } else {
            const row: Omit<PoolCard, 'id'> = { ...c, owner_id: ownerId, created_at: now }
            tx.set(ref, row)
            out.push({ ...row, id: ref.id })
          }
        })
        return out
      })
      added.push(...rows)
    }
    return added
  }

  async updateCard(id: string, patch: Partial<Pick<PoolCard, 'quantity' | 'notes' | 'layout' | 'image_back'>>) {
    await updateDoc(doc(this.db, 'cards', id), patch)
  }

  async removeCard(id: string) {
    // Firestore has no cascading delete, so take the card's loans with it.
    const loans = await getDocs(query(collection(this.db, 'loans'), where('card_id', '==', id)))
    const batch = writeBatch(this.db)
    loans.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(doc(this.db, 'cards', id))
    await batch.commit()
  }

  async replaceCard(id: string, next: NewPoolCard): Promise<PoolCard> {
    const old = this.snap.cards.find((c) => c.id === id)
    if (!old) throw new Error('That card is no longer in the pool.')
    const oldRef = doc(this.db, 'cards', id)
    const newRef = doc(this.db, 'cards', cardDocId(old.owner_id, next.scryfall_id, next.foil))
    if (newRef.id === oldRef.id) return old
    return runTransaction(this.db, async (tx) => {
      const twin = (await tx.get(newRef)).data() as Omit<PoolCard, 'id'> | undefined
      tx.delete(oldRef)
      if (twin) {
        const quantity = twin.quantity + next.quantity
        tx.update(newRef, { quantity })
        return { ...twin, id: newRef.id, quantity }
      }
      const row: Omit<PoolCard, 'id'> = { ...next, owner_id: old.owner_id, created_at: old.created_at }
      tx.set(newRef, row)
      return { ...row, id: newRef.id }
    })
  }

  async createLoan(cardId: string, borrowerId: string): Promise<Loan> {
    const now = new Date().toISOString()
    const ref = doc(collection(this.db, 'loans'))
    const loan: Loan = {
      id: ref.id,
      card_id: cardId,
      borrower_id: borrowerId,
      status: 'requested',
      requested_at: now,
      updated_at: now,
    }
    await setDoc(ref, strip(loan))
    return loan
  }

  async setLoanStatus(id: string, status: LoanStatus) {
    await updateDoc(doc(this.db, 'loans', id), { status, updated_at: new Date().toISOString() })
  }

  async saveDeck(deck: Deck) {
    await setDoc(doc(this.db, 'decks', deck.id), strip(deck))
  }

  async removeDeck(id: string) {
    await deleteDoc(doc(this.db, 'decks', id))
  }

  /** Tear down listeners (used by tests and hot reload; the app never calls it). */
  dispose() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.firstLoad = null
  }
}

let connection: { app: FirebaseApp; db: Firestore } | null = null

/**
 * Firebase allows one app and one Firestore per page, and initializeFirestore
 * throws if called twice. React StrictMode (and hot reload) construct the
 * store more than once in development, so hold the connection at module level.
 */
function connect(config: FirebaseConfig) {
  if (connection) return connection
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      appId: config.appId,
      authDomain: config.authDomain ?? `${config.projectId}.firebaseapp.com`,
    })
  // Offline cache so the pool still opens with no signal (reads come from
  // the last sync and writes queue until the phone is back online).
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  connection = { app, db }
  return connection
}

export function cardDocId(ownerId: string, scryfallId: string, foil = false) {
  return `${ownerId}__${scryfallId}${foil ? '__foil' : ''}`
}

/** Firestore stores the id as the document key; keep it out of the fields. */
function strip<T extends { id: string }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row
  return rest
}

/** Read the Vite env and return a config, or null when sharing is not set up. */
export function firebaseConfigFromEnv(env: ImportMetaEnv): FirebaseConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY as string | undefined
  const projectId = env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const appId = env.VITE_FIREBASE_APP_ID as string | undefined
  if (!apiKey || !projectId || !appId) return null
  return { apiKey, projectId, appId, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined }
}
