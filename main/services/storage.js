'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_DIR = process.env.SSH_CONTROL_DATA_DIR || path.join(os.homedir(), 'SSH Control');
const DATA_FILE = 'data.json';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

let prefsPath = null;
let dataDir = DEFAULT_DIR;
let data = null;    // расшифрованные данные
let key = null;     // производный 32-байтовый ключ
let saltHex = null; // соль текущего ключа

function defaultData() {
  return { version: 1, servers: [], keyMeta: {}, settings: { theme: 'system' }, snippets: [] };
}

function dataFilePath() {
  return path.join(dataDir, DATA_FILE);
}

function loadRaw() {
  try {
    return JSON.parse(fs.readFileSync(dataFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

/* c8 ignore start */
function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify({ dataDir }, null, 2));
  } catch {}
}

function init(userDataPath) {
  prefsPath = path.join(userDataPath, 'prefs.json');
  try {
    const p = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (p.dataDir) dataDir = p.dataDir;
  } catch {}
}

/* c8 ignore stop */
function getState() {
  const raw = loadRaw();
  return {
    dataDir,
    hasData: !!raw,
    encrypted: !!(raw && raw.encrypted),
    locked: !!(raw && raw.encrypted && !data)
  };
}

function getData() {
  const raw = loadRaw();
  if (raw && raw.encrypted && !data) return null; // заблокировано
  if (!data) data = (raw && raw.data) || defaultData();
  return data;
}

function unlock(password) {
  const raw = loadRaw();
  if (!raw) {
    data = defaultData();
    return data;
  }
  if (!raw.encrypted) {
    data = raw.data || defaultData();
    return data;
  }
  const { salt, n, r, p } = raw.kdf;
  const derived = crypto.scryptSync(String(password || ''), Buffer.from(salt, 'hex'), 32, { N: n, r, p });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, Buffer.from(raw.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(raw.ciphertext, 'hex')), decipher.final()]);
    data = JSON.parse(dec.toString('utf8'));
    key = derived;
    saltHex = salt;
    return data;
  } catch {
    return null;
  }
}

function lock() {
  data = null;
  key = null;
  saltHex = null;
  return true;
}

function writeData() {
  fs.mkdirSync(dataDir, { recursive: true });
  let out;
  if (key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    out = {
      version: 1,
      encrypted: true,
      kdf: { salt: saltHex, n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('hex')
    };
  } else {
    out = { version: 1, encrypted: false, data };
  }
  const tmp = dataFilePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, dataFilePath());
}

function save(newData) {
  if (!newData || typeof newData !== 'object') throw new Error('Некорректные данные');
  const raw = loadRaw();
  if (raw && raw.encrypted && !data) throw new Error('Хранилище заблокировано');
  if (!data) data = (raw && raw.data) || defaultData();
  data = newData;
  writeData();
  return true;
}

function setMasterPassword({ current, next } = {}) {
  const raw = loadRaw();
  if (raw && raw.encrypted && !data) {
    if (!current) throw new Error('Введите текущий пароль');
    if (!unlock(current)) throw new Error('Неверный текущий пароль');
  }
  if (!data) data = (raw && raw.data) || defaultData();

  if (!next) {
    key = null;
    saltHex = null;
  } else {
    saltHex = crypto.randomBytes(16).toString('hex');
    key = crypto.scryptSync(String(next), Buffer.from(saltHex, 'hex'), 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  }
  writeData();
  return { encrypted: !!next };
}

/* c8 ignore start */
function changeDir(newDir) {
  if (!newDir) return dataDir;
  const src = dataFilePath();
  if (fs.existsSync(src)) {
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(src, path.join(newDir, DATA_FILE));
  }
  dataDir = newDir;
  savePrefs();
  return dataDir;
}

function exportBackup(destPath) {
  if (!destPath) throw new Error('Не указан путь для резервной копии');
  const src = dataFilePath();
  if (!fs.existsSync(src)) {
    writeData();
  }
  fs.copyFileSync(dataFilePath(), destPath);
  return destPath;
}

/* c8 ignore stop */
module.exports = {
  defaultData,
  init,
  getState,
  getData,
  unlock,
  lock,
  save,
  setMasterPassword,
  changeDir,
  exportBackup,
  get dataDir() { return dataDir; }
};
