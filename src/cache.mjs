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

export async function saveLibrary(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('library', 'readwrite');
    transaction.objectStore('library').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}
