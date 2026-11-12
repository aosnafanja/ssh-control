'use strict';

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Собирает массив аргументов ssh без интерпретации оболочкой.
// Пользовательский текст (extraArgs, host, user) идёт отдельными аргументами,
// поэтому точка инъекции закрыта: execFile/spawn получают argv, а не строку.
function buildArgs(server) {
  if (!server || !server.host) return [];
  const args = [];
  const port = Number(server.port) || 22;
  if (port !== 22) args.push('-p', String(port));
  if (server.authMethod === 'key' && server.keyPath) {
    args.push('-i', expandTilde(server.keyPath));
    args.push('-o', 'IdentitiesOnly=yes');
  }
  if (server.extraArgs && String(server.extraArgs).trim()) {
    args.push(...String(server.extraArgs).trim().split(/\s+/));
  }
  const user = server.user ? `${server.user}@` : '';
  args.push(`${user}${server.host}`);
  return args;
}

function buildCommand(server) {
  const args = buildArgs(server);
  if (!args.length) return '';
  return ['ssh', ...args].join(' ');
}

function buildAliasArgs(alias) {
  const name = String(alias || '').trim();
  return name ? [name] : [];
}

function buildAliasCommand(alias) {
  const args = buildAliasArgs(alias);
  return ['ssh', ...args].join(' ');
}

async function runCommand(cmd) {
  if (!cmd) throw new Error('Пустая команда');
  const script = `tell application "Terminal"\n\tactivate\n\tdo script ${JSON.stringify(cmd)}\nend tell`;
  await execFileP('osascript', ['-e', script]);
  return cmd;
}

async function run(server) {
  const cmd = buildCommand(server);
  if (!cmd) throw new Error('Не заполнен адрес сервера');
  return runCommand(cmd);
}

module.exports = { buildArgs, buildCommand, buildAliasArgs, buildAliasCommand, expandTilde, run, runCommand };
