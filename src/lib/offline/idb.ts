/**
 * Minimal IndexedDB wrapper for the offline write queue.
 *
 * WHY INDEXEDDB AND NOT localStorage
 *   localStorage is synchronous (it blocks the main thread, which is measurable
 *   on the low-end Android devices this app targets), string-only (so every read
 *   is a JSON.parse of the entire queue), and — decisively — it is the first
 *   thing the OS clears under storage pressure. A queue that holds a rider's
 *   completed deliveries must survive that pressure, and "cleared on low
 *   storage" is exactly the wrong failure for a durable outbox.
 *
 * WHY HAND-WRITTEN
 *   The whole surface is four operations on one store with no indexes. The two
 *   libraries worth considering (idb-keyval, idb) are good, but this project has
 *   an unresolved bundler question, and a ~2 KB dependency adds a supply-chain
 *   and version-coupling cost that four functions do not justify. The narrowness
 *   is the point: every IndexedDB footgun we do not touch is one we cannot hit.
 *
 * FOOTGUN AVOIDED BY DESIGN: an IndexedDB transaction auto-commits as soon as
 * control returns to the event loop without a pending request. `await`ing
 * anything unrelated mid-transaction silently closes it. Every helper here
 * creates its transaction, issues its request, and resolves in one go.
 */

const DB_NAME = 'roma-offline'
const DB_VERSION = 1
const STORE = 'queue'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      // Safari private mode and some embedded webviews expose no IndexedDB at
      // all. Failing here is better than a ReferenceError deep in the queue.
      reject(new Error('IndexedDB is unavailable in this browser context'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath 'id': the queue item carries its own uuid, so no
        // autoIncrement counter is needed and writes stay idempotent.
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // If another tab requests a version change, close so it can proceed
      // instead of blocking it forever.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })

  // Do not cache a rejected promise: a transient failure (a blocked upgrade)
  // would otherwise poison every later call for the life of the page.
  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
        // Abort fires for quota exhaustion and for a transaction that could not
        // be committed; without this the promise would hang forever.
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
  )
}

export function readAll<T>(): Promise<T[]> {
  return run<T[]>('readonly', (store) => store.getAll() as IDBRequest<T[]>)
}

export function put<T extends { id: string }>(value: T): Promise<void> {
  return run<unknown>('readwrite', (store) => store.put(value)).then(() => undefined)
}

export function remove(id: string): Promise<void> {
  return run<unknown>('readwrite', (store) => store.delete(id)).then(() => undefined)
}

export function clear(): Promise<void> {
  return run<unknown>('readwrite', (store) => store.clear()).then(() => undefined)
}

/** Test seam: drops the cached connection so a fresh database can be opened. */
export function __resetForTests(): void {
  dbPromise = null
}
