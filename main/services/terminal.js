'use strict';

const os = require('os');
const pty = require('node-pty');
const connect = require('./connect');

const sessions = new Map();
let seq = 0;
let eventSink = null;

// main.js инжектит сюда функцию, отправляющую события в рендер
// (mainWindow.webContents.send). Сервис не знает про BrowserWindow.
function setEventSink(sink) {
  eventSink = sink;
}

function emit(channel, ...args) {
  if (typeof eventSink === 'function') eventSink(channel, ...args);
}

function sshEnv() {
  return Object.assign({}, process.env, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  });
}

// id сессии приходит из рендера (проверен по формату); fallback — свой.
function safeId(id) {
  if (typeof id === 'string' && /^[\w.-]{1,64}$/.test(id)) return id;
  return null;
}

function spawnSsh(args, cols, rows, id) {
  if (!args || !args.length) throw new Error('Пустая команда ssh');
  const sid = safeId(id) || ('term_' + (seq++).toString(36) + Date.now().toString(36));

  const proc = pty.spawn('ssh', args, {
    name: 'xterm-256color',
    cols: Number(cols) || 80,
    rows: Number(rows) || 24,
    cwd: os.homedir(),
    env: sshEnv()
  });

  sessions.set(sid, proc);
  proc.onData((data) => emit('term:data', sid, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(sid);
    emit('term:exit', sid, exitCode);
  });

  return { id: sid };
}

// payload: { type: 'server', server } | { type: 'alias', alias }, плюс id/cols/rows.
function createSession(payload) {
  const opts = payload || {};
  if (opts.type === 'server') {
    return spawnSsh(connect.buildArgs(opts.server), opts.cols, opts.rows, opts.id);
  }
  if (opts.type === 'alias') {
    return spawnSsh(connect.buildAliasArgs(opts.alias), opts.cols, opts.rows, opts.id);
  }
  throw new Error('Неизвестный тип сессии');
}

function write(id, data) {
  const proc = sessions.get(id);
  if (proc) proc.write(String(data == null ? '' : data));
}

function resize(id, cols, rows) {
  const proc = sessions.get(id);
  if (proc) proc.resize(Number(cols) || 80, Number(rows) || 24);
}

function kill(id) {
  const proc = sessions.get(id);
  if (!proc) return;
  sessions.delete(id);
  try {
    proc.kill();
  } catch {
    // процесс мог завершиться между onExit и kill
  }
}

function killAll() {
  for (const id of Array.from(sessions.keys())) kill(id);
}

module.exports = { setEventSink, createSession, write, resize, kill, killAll };
