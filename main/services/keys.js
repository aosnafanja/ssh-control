'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const sshDir = process.env.SSH_CONTROL_SSH_DIR || path.join(os.homedir(), '.ssh');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

function keyPath(name) {
  return path.join(sshDir, name);
}

function isPrivateKeyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) return false;
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 256);
    return head.includes('PRIVATE KEY-----');
  } catch {
    return false;
  }
}

function parseFingerprintLine(line) {
  // Пример: "256 SHA256:u/... comment (ED25519)"
  const m = line.match(/^(\d+)\s+(\S+)\s+(.*?)\s*\(([A-Za-z0-9_-]+)\)\s*$/);
  if (m) {
    return { bits: m[1], fingerprint: m[2], comment: m[3].trim(), type: m[4] };
  }
  const parts = line.trim().split(/\s+/);
  return {
    bits: parts[0] || '',
    fingerprint: parts[1] || '',
    comment: parts.slice(2).join(' ').replace(/\s*\([^)]*\)$/, '').trim(),
    type: ''
  };
}

async function describeKey(filePath, name) {
  const info = {
    name,
    path: filePath,
    pub: '',
    fingerprint: '',
    bits: '',
    type: '',
    comment: '',
    mtime: null
  };
  try { info.mtime = fs.statSync(filePath).mtimeMs; } catch {}
  try { info.pub = fs.readFileSync(filePath + '.pub', 'utf8').trim(); } catch {}
  try {
    const fp = await run('ssh-keygen', ['-lf', filePath]);
    const parsed = parseFingerprintLine(fp);
    info.fingerprint = parsed.fingerprint;
    info.bits = parsed.bits;
    info.type = parsed.type;
    info.comment = parsed.comment;
  } catch {}
  // Комментарий из .pub, если есть
  if (!info.comment && info.pub) {
    const parts = info.pub.split(/\s+/);
    if (parts.length >= 3) info.comment = parts.slice(2).join(' ');
  }
  return info;
}

async function scanKeys() {
  let files = [];
  try { files = fs.readdirSync(sshDir); } catch { return []; }

  const result = [];
  for (const f of files) {
    if (f === 'config' || f === 'authorized_keys' || f === 'known_hosts') continue;
    if (f.endsWith('.pub')) continue;
    if (f.includes('.bak') || f.endsWith('.old')) continue;
    const full = keyPath(f);
    if (!isPrivateKeyFile(full)) continue;
    result.push(await describeKey(full, f));
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function sanitizeName(name) {
  let n = String(name || '').trim();
  n = n.replace(/[/\\\s]+/g, '-');
  n = n.replace(/[^A-Za-z0-9._-]/g, '');
  n = n.replace(/^\.+/, '');
  if (!n) throw new Error('Недопустимое имя ключа');
  return n;
}

async function createKey({ name, type, bits, comment, passphrase }) {
  const safe = sanitizeName(name);
  const target = keyPath(safe);
  if (fs.existsSync(target) || fs.existsSync(target + '.pub')) {
    throw new Error(`Ключ «${safe}» уже существует`);
  }

  const args = ['-t', type || 'ed25519', '-f', target, '-q'];
  if ((type === 'rsa' || type === 'ecdsa') && bits) args.push('-b', String(bits));
  if (comment) args.push('-C', String(comment));
  args.push('-N', passphrase || '');

  await run('ssh-keygen', args);
  return describeKey(target, safe);
}

async function renameKey({ name, newName }) {
  const safeNew = sanitizeName(newName);
  if (safeNew === name) return { name: safeNew };
  const oldPath = keyPath(name);
  const newPath = keyPath(safeNew);

  if (!fs.existsSync(oldPath)) throw new Error(`Ключ «${name}» не найден`);
  if (fs.existsSync(newPath) || fs.existsSync(newPath + '.pub')) {
    throw new Error(`Имя «${safeNew}» уже занято`);
  }

  fs.renameSync(oldPath, newPath);
  if (fs.existsSync(oldPath + '.pub')) {
    fs.renameSync(oldPath + '.pub', newPath + '.pub');
  }

  updateConfigReferences(name, safeNew);
  return { name: safeNew, path: newPath };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateConfigReferences(oldName, newName) {
  const cfg = path.join(sshDir, 'config');
  if (!fs.existsSync(cfg)) return;
  let text = fs.readFileSync(cfg, 'utf8');
  const old = escapeRegExp(oldName);
  const re = new RegExp(`(IdentityFile\\s+(?:~\\/\\.ssh\\/|\\.ssh\\/|~\\/)?)${old}(\\s*(?:$|\\s))`, 'gm');
  const before = text;
  text = text.replace(re, (match, prefix, suffix) => `${prefix}${newName}${suffix}`);
  if (text !== before) {
    fs.writeFileSync(cfg, text);
  }
}

function moveToTrash(filePath) {
  const trash = path.join(os.homedir(), '.Trash');
  const base = path.basename(filePath);
  let dest = path.join(trash, base);
  let i = 1;
  while (fs.existsSync(dest)) dest = path.join(trash, `${base}.${i++}`);
  fs.renameSync(filePath, dest);
}

async function deleteKey(name) {
  const p = keyPath(name);
  if (!fs.existsSync(p)) throw new Error(`Ключ «${name}» не найден`);
  moveToTrash(p);
  if (fs.existsSync(p + '.pub')) moveToTrash(p + '.pub');
  return true;
}

module.exports = {
  sshDir,
  keyPath,
  scanKeys,
  createKey,
  renameKey,
  deleteKey,
  sanitizeName
};
