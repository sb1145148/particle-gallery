/**
 * 上传图片的本地存储。
 *
 * 用 IndexedDB 存原始 Blob（不是 base64），这样：
 *   - 刷新 / 关掉浏览器再打开，用户上传的图片还在
 *   - 不需要任何后端，纯静态托管也能用
 *
 * 如果浏览器禁用了 IndexedDB（隐私模式等），自动退回内存存储，只是刷新会丢。
 */

const DB_NAME = 'particle-gallery';
const DB_VERSION = 1;
const STORE = 'uploads';
const MAX_BYTES = 12 * 1024 * 1024; // 单张上限，避免把一个巨型 GIF 塞进去

const ACCEPTED = /^image\/(jpeg|png|webp|gif|avif|bmp)$/i;

let dbPromise = null;
/** IndexedDB 不可用时的兜底存储 */
const memory = new Map();
let usingMemory = false;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境没有 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其它标签页占用'));
  });
  return dbPromise;
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try {
      result = run(store);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('事务被中止'));
  });
}

export function isMemoryOnly() {
  return usingMemory;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 读取全部上传图片，按添加时间排序 */
export async function listUploads() {
  try {
    const db = await openDB();
    const all = await tx(db, 'readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => a.addedAt - b.addedAt);
  } catch (err) {
    usingMemory = true;
    console.warn('[粒子画廊] 读取本地图片库失败，本次会话改用内存暂存：', err.message);
    return [...memory.values()].sort((a, b) => a.addedAt - b.addedAt);
  }
}

/**
 * 保存用户选择的文件。
 * @returns {Promise<{added: object[], skipped: {name: string, reason: string}[]}>}
 */
export async function addUploads(fileList) {
  const added = [];
  const skipped = [];

  for (const file of fileList) {
    if (!file || !file.size) continue;
    if (!ACCEPTED.test(file.type)) {
      skipped.push({ name: file.name, reason: `不支持的格式（${file.type || '未知'}）` });
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ name: file.name, reason: `超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB` });
      continue;
    }
    added.push({
      id: newId(),
      name: file.name.replace(/\.[^.]+$/, '') || '未命名',
      file: file.name,
      type: file.type,
      bytes: file.size,
      addedAt: Date.now(),
      blob: file,
    });
  }

  if (added.length === 0) return { added, skipped };

  try {
    const db = await openDB();
    for (const record of added) {
      await tx(db, 'readwrite', (store) => store.put(record));
    }
  } catch (err) {
    usingMemory = true;
    console.warn('[粒子画廊] 写入本地图片库失败，本次会话改用内存暂存：', err.message);
    for (const record of added) memory.set(record.id, record);
  }

  return { added, skipped };
}

export async function removeUpload(id) {
  try {
    const db = await openDB();
    await tx(db, 'readwrite', (store) => store.delete(id));
  } catch {
    memory.delete(id);
  }
  memory.delete(id);
}

export async function clearUploads() {
  try {
    const db = await openDB();
    await tx(db, 'readwrite', (store) => store.clear());
  } catch {
    memory.clear();
  }
  memory.clear();
}
