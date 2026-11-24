import { classicDirectory } from './wiki.mjs?v=4';

let opening;

function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('character-tier-atlas', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

export async function readLibrary() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('library').objectStore('library').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLibrary(records) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('library', 'readwrite');
    const library = transaction.objectStore('library');
    for (const [key, value] of Object.entries(records)) library.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readClassicDirectory() {
  let local;
  try { local = JSON.parse(localStorage.getItem('versus_explorer_cache_v4_index')); } catch { /* Storage may be blocked. */ }
  const databaseIndex = await new Promise(resolve => {
    let request;
    try { request = indexedDB.open('versus_character_explorer_v3'); } catch { resolve(null); return; }
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); resolve(null); return; }
      const read = db.transaction('kv', 'readonly').objectStore('kv').get('index');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); resolve(null); };
    };
  });
  const candidates = [databaseIndex, local].map(classicDirectory).filter(Boolean);
  return candidates.sort((a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0))[0];
}
