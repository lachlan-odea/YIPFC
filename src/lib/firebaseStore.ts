import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
} from 'firebase/auth'
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
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
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import type { AuthUser, Deck, Loan, LoanStatus, NewPoolCard, Player, Pod, PoolCard, PoolStore, Snapshot } from './types'

export type FirebaseConfig = {
  apiKey: string
  projectId: string
  appId: string
  authDomain?: string
}

/** Firestore limits a single transaction or batch to 500 writes. */
const WRITE_CHUNK = 400
/** Firestore's cap on values in an `in` / `array-contains-any` filter. */
const IN_LIMIT = 30
/** Invite codes avoid 0/O and 1/I so they survive being read out at a table. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Shared store backed by Firebase Auth and Cloud Firestore.
 *
 * Collections:
 *   players/{uid}  pods/{id}  cards/{uid__scryfall[__foil]}  loans/{id}  decks/{id}
 *
 * A player's collection belongs to their account, not to a pod. A pod is a
 * list of member uids; the view for a pod is every member's cards, loans and
 * decks, found with `in` queries over the member list (chunked by 30). With
 * no pod selected the view is just your own collection.
 *
 * Realtime listeners are rebuilt whenever the signed-in user or the active
 * pod changes. load() resolves once every listener in the current set has
 * delivered, and after that returns the live snapshot immediately.
 */
export class FirebaseStore implements PoolStore {
  readonly mode = 'shared' as const
  private db: Firestore
  private auth: Auth
  private user: AuthUser | null = null
  private podId: string | null = null
  private snap: Snapshot = { players: [], cards: [], loans: [], decks: [], pods: [] }
  private listeners = new Set<() => void>()
  private authListeners = new Set<(u: AuthUser | null) => void>()
  private authStarted = false
  private userUnsubs: Unsubscribe[] = []
  private dataUnsubs: Unsubscribe[] = []
  private parts = new Map<string, unknown[]>()
  private firstLoad: Promise<void> = Promise.resolve()
  private podsReady: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(config: FirebaseConfig) {
    const { app, db } = connect(config)
    this.db = db
    this.auth = getAuth(app)
  }

  // ---- accounts ------------------------------------------------------------

  onAuth(cb: (user: AuthUser | null) => void) {
    this.authListeners.add(cb)
    if (!this.authStarted) {
      this.authStarted = true
      onAuthStateChanged(this.auth, (u) => {
        this.user = u ? { id: u.uid, email: u.email } : null
        this.startUserListeners()
        this.authListeners.forEach((l) => l(this.user))
      })
    } else cb(this.user)
    return () => void this.authListeners.delete(cb)
  }

  async signUp(name: string, email: string, password: string) {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email.trim(), password)
      await updateProfile(cred.user, { displayName: name.trim() })
      await setDoc(doc(this.db, 'players', cred.user.uid), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        created_at: new Date().toISOString(),
      })
    } catch (e) {
      throw friendlyAuthError(e)
    }
  }

  async signIn(email: string, password: string) {
    try {
      await signInWithEmailAndPassword(this.auth, email.trim(), password)
    } catch (e) {
      throw friendlyAuthError(e)
    }
  }

  async signOut() {
    await fbSignOut(this.auth)
  }

  async resetPassword(email: string) {
    try {
      await sendPasswordResetEmail(this.auth, email.trim())
    } catch (e) {
      throw friendlyAuthError(e)
    }
  }

  async upsertPlayer(player: Pick<Player, 'id' | 'name'>): Promise<Player> {
    const existing = this.snap.players.find((p) => p.id === player.id)
    const row: Player = existing
      ? { ...existing, name: player.name }
      : { id: player.id, name: player.name, email: this.user?.email ?? undefined, created_at: new Date().toISOString() }
    await setDoc(doc(this.db, 'players', player.id), strip(row), { merge: true })
    return row
  }

  // ---- pods -------------------------------------------------------------------

  setPod(podId: string | null) {
    if (podId === this.podId) return
    this.podId = podId
    this.startDataListeners()
  }

  async createPod(name: string): Promise<Pod> {
    const uid = this.requireUser()
    const ref = doc(collection(this.db, 'pods'))
    const pod: Pod = { id: ref.id, name: name.trim(), code: makeCode(), created_by: uid, members: [uid], created_at: new Date().toISOString() }
    await setDoc(ref, strip(pod))
    return pod
  }

  async joinPod(code: string): Promise<Pod> {
    const uid = this.requireUser()
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length !== 6) throw new Error('Pod codes are six letters and numbers.')
    const found = await getDocs(query(collection(this.db, 'pods'), where('code', '==', clean)))
    const d = found.docs[0]
    if (!d) throw new Error('No pod has that code. Check it with whoever invited you.')
    const pod = { ...(d.data() as Omit<Pod, 'id'>), id: d.id }
    if (!pod.members.includes(uid)) {
      await updateDoc(d.ref, { members: arrayUnion(uid) })
      pod.members = [...pod.members, uid]
    }
    return pod
  }

  async leavePod(podId: string) {
    const uid = this.requireUser()
    await updateDoc(doc(this.db, 'pods', podId), { members: arrayRemove(uid) })
  }

  async renamePod(podId: string, name: string) {
    await updateDoc(doc(this.db, 'pods', podId), { name: name.trim() })
  }

  // ---- listeners ----------------------------------------------------------------

  private requireUser(): string {
    if (!this.user) throw new Error('Sign in first.')
    return this.user.id
  }

  /** Per-user listeners: your pods. Data listeners are rebuilt from them. */
  private startUserListeners() {
    this.userUnsubs.forEach((u) => u())
    this.userUnsubs = []
    this.dataUnsubs.forEach((u) => u())
    this.dataUnsubs = []
    this.parts.clear()
    this.snap = { players: [], cards: [], loans: [], decks: [], pods: [] }
    if (!this.user) {
      this.firstLoad = Promise.resolve()
      this.notify()
      return
    }
    const uid = this.user.id
    let podsLoaded!: () => void
    this.podsReady = new Promise<void>((r) => (podsLoaded = r))
    this.userUnsubs.push(
      onSnapshot(query(collection(this.db, 'pods'), where('members', 'array-contains', uid)), (qs) => {
        podsLoaded()
        const pods = qs.docs.map((d) => ({ ...(d.data() as Omit<Pod, 'id'>), id: d.id })).sort((a, b) => a.name.localeCompare(b.name))
        const membersChanged = JSON.stringify(this.activeMembers()) !== JSON.stringify(this.activeMembers(pods))
        this.snap = { ...this.snap, pods }
        if (membersChanged || !this.dataUnsubs.length) this.startDataListeners()
        else this.notify()
      }),
    )
    this.startDataListeners()
  }

  /** Whose data the current view covers: the active pod's members, or just you. */
  private activeMembers(pods = this.snap.pods): string[] {
    if (!this.user) return []
    const pod = this.podId ? pods.find((p) => p.id === this.podId) : undefined
    const members = pod ? pod.members : [this.user.id]
    return [...new Set([this.user.id, ...members])].sort()
  }

  private startDataListeners() {
    this.dataUnsubs.forEach((u) => u())
    this.dataUnsubs = []
    this.parts.clear()
    const members = this.activeMembers()
    if (!members.length) {
      this.firstLoad = Promise.resolve()
      return
    }
    const gen = ++this.generation
    const chunks: string[][] = []
    for (let i = 0; i < members.length; i += IN_LIMIT) chunks.push(members.slice(i, i + IN_LIMIT))

    const pending: Array<Promise<void>> = []
    const attach = (key: string, q: Query) => {
      let resolveFirst!: () => void
      pending.push(new Promise<void>((r) => (resolveFirst = r)))
      let seen = false
      const unsub = onSnapshot(
        q,
        (qs: QuerySnapshot) => {
          if (gen !== this.generation) return
          this.parts.set(key, qs.docs.map((d) => ({ ...(d.data() as object), id: d.id })))
          this.assemble()
          if (!seen) {
            seen = true
            resolveFirst()
          } else this.notify()
        },
        (err) => {
          console.error(`[yipfc] ${key} listener`, err)
          if (!seen) {
            seen = true
            resolveFirst()
          }
        },
      )
      this.dataUnsubs.push(unsub)
    }

    chunks.forEach((chunk, i) => {
      attach(`players:${i}`, query(collection(this.db, 'players'), where(documentId(), 'in', chunk)))
      attach(`cards:${i}`, query(collection(this.db, 'cards'), where('owner_id', 'in', chunk)))
      attach(`decks:${i}`, query(collection(this.db, 'decks'), where('owner_id', 'in', chunk)))
      attach(`loans-out:${i}`, query(collection(this.db, 'loans'), where('owner_id', 'in', chunk)))
      attach(`loans-in:${i}`, query(collection(this.db, 'loans'), where('borrower_id', 'in', chunk)))
    })
    // Ready once the pod list and every listener in this set have delivered; then tell the UI,
    // since first deliveries do not notify on their own.
    this.firstLoad = Promise.all([this.podsReady, ...pending]).then(() => {
      if (gen === this.generation) this.notify()
    })
  }

  /** Merge every listener's rows into one snapshot. Loans can arrive from two listeners; dedupe by id. */
  private assemble() {
    const gather = <T extends { id: string }>(prefix: string, sort: (a: T, b: T) => number): T[] => {
      const byId = new Map<string, T>()
      for (const [k, rows] of this.parts) if (k.startsWith(prefix)) for (const r of rows as T[]) byId.set(r.id, r)
      return [...byId.values()].sort(sort)
    }
    this.snap = {
      pods: this.snap.pods,
      players: gather<Player>('players:', (a, b) => a.name.localeCompare(b.name)),
      cards: gather<PoolCard>('cards:', (a, b) => a.name.localeCompare(b.name)),
      decks: gather<Deck>('decks:', (a, b) => b.updated_at.localeCompare(a.updated_at)),
      loans: gather<Loan>('loans-', (a, b) => b.requested_at.localeCompare(a.requested_at)),
    }
  }

  async load(): Promise<Snapshot> {
    await this.firstLoad
    return this.snap
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }

  // ---- cards ------------------------------------------------------------------------

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

  // ---- loans and decks ---------------------------------------------------------------

  async createLoan(cardId: string, borrowerId: string, ownerId: string, podId: string | null): Promise<Loan> {
    const now = new Date().toISOString()
    const ref = doc(collection(this.db, 'loans'))
    const loan: Loan = { id: ref.id, card_id: cardId, borrower_id: borrowerId, owner_id: ownerId, pod_id: podId, status: 'requested', requested_at: now, updated_at: now }
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

  // ---- migration from the pre-accounts data model ------------------------------------

  /**
   * Before accounts, each device made up a random player id. Move everything
   * that id owned onto the signed-in account: cards get new ids under the
   * uid (merging into any matching row), loans are repointed, decks and the
   * old player record follow. Rules allow these writes only for legacy ids.
   */
  async claimLegacy(oldId: string): Promise<number> {
    const uid = this.requireUser()
    const cards = await getDocs(query(collection(this.db, 'cards'), where('owner_id', '==', oldId)))
    let moved = 0
    for (const d of cards.docs) {
      const row = d.data() as Omit<PoolCard, 'id'>
      const newRef = doc(this.db, 'cards', cardDocId(uid, row.scryfall_id, row.foil))
      await runTransaction(this.db, async (tx) => {
        const twin = (await tx.get(newRef)).data() as Omit<PoolCard, 'id'> | undefined
        tx.delete(d.ref)
        if (twin) tx.update(newRef, { quantity: twin.quantity + row.quantity })
        else tx.set(newRef, { ...row, owner_id: uid })
      })
      const loans = await getDocs(query(collection(this.db, 'loans'), where('card_id', '==', d.id)))
      for (const l of loans.docs) await updateDoc(l.ref, { card_id: newRef.id, owner_id: uid })
      moved++
    }
    const borrowed = await getDocs(query(collection(this.db, 'loans'), where('borrower_id', '==', oldId)))
    for (const l of borrowed.docs) await updateDoc(l.ref, { borrower_id: uid })
    const decks = await getDocs(query(collection(this.db, 'decks'), where('owner_id', '==', oldId)))
    for (const dk of decks.docs) await updateDoc(dk.ref, { owner_id: uid })
    await deleteDoc(doc(this.db, 'players', oldId)).catch(() => {})
    return moved
  }
}

// ---- helpers ------------------------------------------------------------------------------

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

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Firestore stores the id as the document key; keep it out of the fields. */
function strip<T extends { id: string }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row
  return rest
}

function friendlyAuthError(e: unknown): Error {
  const code = (e as { code?: string })?.code ?? ''
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Passwords need at least six characters.',
    'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
    'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/wrong-password': 'Wrong password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'No connection. Check your signal and try again.',
    'auth/operation-not-allowed': 'Email sign-in is not switched on in the Firebase console yet.',
  }
  return new Error(map[code] ?? (e instanceof Error ? e.message : String(e)))
}

/** Read the Vite env and return a config, or null when sharing is not set up. */
export function firebaseConfigFromEnv(env: ImportMetaEnv): FirebaseConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY as string | undefined
  const projectId = env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const appId = env.VITE_FIREBASE_APP_ID as string | undefined
  if (!apiKey || !projectId || !appId) return null
  return { apiKey, projectId, appId, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined }
}
