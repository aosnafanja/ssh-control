'use strict';

const fs = require('fs');
const path = require('path');
const { sshDir } = require('./keys');

function configPath() {
  return path.join(sshDir, 'config');
}

function readText() {
  try {
    return fs.readFileSync(configPath(), 'utf8');
  } catch {
    return '';
  }
}

function writeText(text) {
  fs.writeFileSync(configPath(), text);
}

// Разбивает конфиг на "преамбулу" (комментарии, Include, глобальные опции)
// и блоки Host. Каждый блок сохраняет свои строки без изменений.
function parse(text) {
  const lines = text.split('\n');
  const preamble = [];
  const hosts = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (m) {
      current = { names: m[1].trim().split(/\s+/).filter(Boolean), lines: [line] };
      hosts.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, hosts };
}

// Управляемые опции извлекаются, остальное сохраняется как "extra" (verbatim).
function splitOptions(lines) {
  const managed = {};
  const extra = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s+(.*?)\s*$/);
    if (m) {
      const key = m[1].toLowerCase();
      if (key === 'hostname') managed.HostName = m[2].trim();
      else if (key === 'user') managed.User = m[2].trim();
      else if (key === 'port') managed.Port = m[2].trim();
      else if (key === 'identityfile') managed.IdentityFile = m[2].trim();
      else extra.push(line);
    } else if (line.trim()) {
      extra.push(line);
    }
  }
  return { managed, extra };
}

function listHosts() {
  const { hosts } = parse(readText());
  return hosts.map((h) => {
    const { managed, extra } = splitOptions(h.lines);
    return {
      name: h.names[0],
      names: h.names,
      hostName: managed.HostName || '',
      user: managed.User || '',
      port: managed.Port || '',
      identityFile: managed.IdentityFile || '',
      extraCount: extra.filter((l) => l.trim()).length
    };
  });
}

function getHost(name) {
  const { hosts } = parse(readText());
  const h = hosts.find((x) => x.names.includes(name));
  if (!h) return null;
  const { managed, extra } = splitOptions(h.lines);
  return {
    name: h.names[0],
    names: h.names,
    hostName: managed.HostName || '',
    user: managed.User || '',
    port: managed.Port || '',
    identityFile: managed.IdentityFile || '',
    extra: extra.filter((l) => l.trim()).join('\n')
  };
}

function buildBlock(record) {
  const name = String(record.name || '').trim();
  const lines = [`Host ${name}`];
  if (record.hostName) lines.push(`    HostName ${record.hostName}`);
  if (record.user) lines.push(`    User ${record.user}`);
  if (record.port && String(record.port) !== '22') lines.push(`    Port ${record.port}`);
  if (record.identityFile) lines.push(`    IdentityFile ${record.identityFile}`);

  const extraLines = String(record.extra || '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());
  for (const l of extraLines) {
    lines.push(/^\s/.test(l) ? l : '    ' + l);
  }
  return lines;
}

function serialize(preamble, hosts) {
  const out = [];
  const p = preamble.join('\n').replace(/\s+$/, '');
  if (p) out.push(p);
  for (const h of hosts) {
    const lines = h.lines.slice();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (out.length) out.push('');
    out.push(lines.join('\n'));
  }
  return out.join('\n') + '\n';
}

function saveHost(record) {
  const name = String((record && record.name) || '').trim();
  if (!name) throw new Error('Укажите псевдоним');
  if (/\s/.test(name)) throw new Error('Псевдоним не должен содержать пробелов');

  const { preamble, hosts } = parse(readText());
  const idx = hosts.findIndex((h) => h.names.includes(name));
  const lines = buildBlock(record);
  if (idx >= 0) {
    hosts[idx] = { names: [name], lines };
  } else {
    hosts.push({ names: [name], lines });
  }
  writeText(serialize(preamble, hosts));
  return true;
}

function deleteHost(name) {
  const { preamble, hosts } = parse(readText());
  const idx = hosts.findIndex((h) => h.names.includes(name));
  if (idx < 0) throw new Error(`Псевдоним «${name}» не найден`);
  hosts.splice(idx, 1);
  writeText(serialize(preamble, hosts));
  return true;
}

module.exports = {
  configPath,
  readText,
  listHosts,
  getHost,
  saveHost,
  deleteHost
};
