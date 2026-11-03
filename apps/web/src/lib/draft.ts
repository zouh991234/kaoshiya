/**
 * 草稿缓存：仅作为浏览器本地的中断续做缓存，不是主存储。
 * 正式数据以服务端 SQLite 为准。
 */
const DB_NAME = 'kaoshiya-drafts'
const STORE = 'drafts'
const VERSION = 1

export interface DraftPayload<T> {
  key: string
  updatedAt: string
  data: T
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地草稿库'))
  })
}

export async function saveDraft<T>(key: string, data: T): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ key, updatedAt: new Date().toISOString(), data })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('草稿保存失败'))
  })
  db.close()
}

export async function loadDraft<T>(key: string): Promise<DraftPayload<T> | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  const result = await new Promise<DraftPayload<T> | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    request.onsuccess = () => resolve((request.result as DraftPayload<T> | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('草稿读取失败'))
  })
  db.close()
  return result
}

export async function clearDraft(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('草稿清理失败'))
  })
  db.close()
}

export async function draftStats(): Promise<{ count: number; bytes: number }> {
  if (typeof indexedDB === 'undefined') return { count: 0, bytes: 0 }
  try {
    const estimate = await navigator.storage?.estimate?.()
    return { count: 0, bytes: estimate?.usage ?? 0 }
  } catch {
    return { count: 0, bytes: 0 }
  }
}
