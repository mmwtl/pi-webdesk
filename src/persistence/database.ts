const DB_NAME = "pi-webdesk-browser-only";
const LEGACY_DB_NAME = "webharness-browser-only";
const DB_VERSION = 1;
const LEGACY_MIGRATION_KEY = "migrated-from-webharness";

export type StoreName = "settings" | "workspaces" | "sessions" | "meta";

let databasePromise: Promise<IDBDatabase> | undefined;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function createSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
  if (!db.objectStoreNames.contains("workspaces")) db.createObjectStore("workspaces", { keyPath: "id" });
  if (!db.objectStoreNames.contains("sessions")) {
    const sessions = db.createObjectStore("sessions", { keyPath: "id" });
    sessions.createIndex("workspaceId", "workspaceId", { unique: false });
    sessions.createIndex("updatedAt", "updatedAt", { unique: false });
  }
  if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
}

function openNamedDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onupgradeneeded = () => {
      createSchema(request.result);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function databaseExists(name: string): Promise<boolean> {
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof factory.databases !== "function") return false;
  try {
    return (await factory.databases()).some((database) => database.name === name);
  } catch {
    return false;
  }
}

async function hasMigrationMarker(db: IDBDatabase): Promise<boolean> {
  if (!db.objectStoreNames.contains("meta")) return false;
  return Boolean(await requestResult(db.transaction("meta", "readonly").objectStore("meta").get(LEGACY_MIGRATION_KEY)));
}

async function copyStore(source: IDBDatabase, target: IDBDatabase, storeName: StoreName): Promise<void> {
  if (!source.objectStoreNames.contains(storeName)) return;
  const sourceStore = source.transaction(storeName, "readonly").objectStore(storeName);
  const [values, keys] = await Promise.all([requestResult(sourceStore.getAll()), requestResult(sourceStore.getAllKeys())]);
  if (!values.length) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = target.transaction(storeName, "readwrite");
    const targetStore = transaction.objectStore(storeName);
    values.forEach((value, index) => {
      if (targetStore.keyPath === null) targetStore.put(value, keys[index]);
      else targetStore.put(value);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not migrate ${storeName}`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not migrate ${storeName}`));
  });
}

async function migrateLegacyDatabase(): Promise<void> {
  if (!(await databaseExists(LEGACY_DB_NAME))) return;
  const [legacy, current] = await Promise.all([openNamedDatabase(LEGACY_DB_NAME), openNamedDatabase(DB_NAME)]);
  try {
    if (await hasMigrationMarker(current)) return;
    for (const storeName of ["settings", "workspaces", "sessions", "meta"] as StoreName[]) await copyStore(legacy, current, storeName);
    await new Promise<void>((resolve, reject) => {
      const transaction = current.transaction("meta", "readwrite");
      transaction.objectStore("meta").put(true, LEGACY_MIGRATION_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not mark IndexedDB migration"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not mark IndexedDB migration"));
    });
  } finally {
    legacy.close();
    current.close();
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= migrateLegacyDatabase()
    .catch((reason) => console.warn("Pi Webdesk could not migrate legacy browser data", reason))
    .then(() => openNamedDatabase(DB_NAME));
  return databasePromise;
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function idbPut<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const request = transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAll<T>(store: StoreName, index?: string, query?: IDBValidKey): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readonly");
    const source: IDBObjectStore | IDBIndex = index ? transaction.objectStore(store).index(index) : transaction.objectStore(store);
    const request = source.getAll(query);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}
