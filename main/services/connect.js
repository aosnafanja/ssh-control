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

function buildCommand(server) {
  if (!server || !server.host) return '';
  const parts = ['ssh'];
  const port = Number(server.port) || 22;
  if (port !== 22) parts.push('-p', String(port));
  if (server.authMethod === 'key' && server.keyPath) {
    parts.push('-i', expandTilde(server.keyPath));
    parts.push('-o', 'IdentitiesOnly=yes');
  }
  if (server.extraArgs && String(server.extraArgs).trim()) {
    parts.push(...String(server.extraArgs).trim().split(/\s+/));
  }
  const user = server.user ? `${server.user}@` : '';
  parts.push(`${user}${server.host}`);
  return parts.join(' ');
}

function buildAliasCommand(alias) {
  return `ssh ${String(alias || '').trim()}`;
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

module.exports = { buildCommand, run, buildAliasCommand, runCommand };
