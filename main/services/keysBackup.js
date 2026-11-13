'use strict';

const fs = require('fs');
const crypto = require('crypto');
const keys = require('./keys');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// Какие файлы ~/.ssh включаем в резервную копию (чистая функция, по имени).
function isSshBackupFile(name) {
  if (!name) return false;
  if (name === 'config' || name === 'known_hosts' || name === 'authorized_keys') return true;
  if (name.endsWith('.pub')) return true;
  if (name.includes('.bak') || name.includes('.old')) return false;
  return /^id_/.test(name);
}

/* c8 ignore start */
function collectSshFiles() {
  const files = {};
  let entries = [];
  try { entries = fs.readdirSync(keys.sshDir); } catch { return { files, count: 0 }; }
  for (const name of entries) {
    if (!isSshBackupFile(name)) continue;
    const full = keys.keyPath(name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue; // сокеты/подкаталоги пропускаем
    try {
      files[name] = fs.readFileSync(full, 'utf8');
    } catch {
      // нечитаемый/бинарный — пропускаем
    }
  }
  return { files, count: Object.keys(files).length };
}

// Шифруем собранные файлы ~/.ssh в один файл (scrypt + AES-256-GCM, как storage.js).
function exportKeysBackup(destPath, password) {
  if (!destPath) throw new Error('Не указан путь сохранения');
  if (!password || !String(password).trim()) throw new Error('Введите пароль');

  const { files, count } = collectSshFiles();
  if (!count) throw new Error('В ~/.ssh нет файлов для резервной копии');

  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ files }), 'utf8'), cipher.final()]);

  const out = {
    version: 1,
    type: 'ssh-keys-backup',
    encrypted: true,
    kdf: { salt: salt.toString('hex'), n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
  const tmp = destPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, destPath);
  return { count };
}
/* c8 ignore stop */

module.exports = { isSshBackupFile, exportKeysBackup };
