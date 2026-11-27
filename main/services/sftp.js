'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const { expandTilde } = require('./connect');
const { sshDir } = require('./keys');

const DEFAULT_PORT = 22;
const SESSION_ID_PREFIX = 'sftp_';
const SFTP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const SFTP_READY_TIMEOUT_MS = 20000;
const SFTP_KEEPALIVE_INTERVAL_MS = 0;
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000;

const sessions = new Map();
let seq = 0;
let eventSink = null;
let hostKeyVerifier = null;
let idleSweepTimer = null;

// main.js инжектит сюда функцию, отправляющую события в рендер
// (mainWindow.webContents.send). Сервис не знает про BrowserWindow.
function setEventSink(sink) {
  eventSink = typeof sink === 'function' ? sink : null;
}

function emit(channel, ...args) {
  if (typeof eventSink === 'function') eventSink(channel, ...args);
}

// Проверка host key (known_hosts) появится в задаче #50. До неё транспорт
// fail-closed: без установленного verifier соединение не создаётся, чтобы
// не выпустить авто-принятие неизвестного ключа.
function setHostKeyVerifier(fn) {
  hostKeyVerifier = typeof fn === 'function' ? fn : null;
}

// Подсказка ssh-add для текстов ошибок: только basename ключа из данных
// сервера, никакого произвольного пути наружу не уходит.
function sshAddHint(server) {
  const keyPath = String((server && server.keyPath) || '').trim();
  return `ssh-add ~/.ssh/${keyPath ? path.basename(keyPath) : '<key>'}`;
}

function validateServer(server) {
  const s = server || {};
  if (!s.host) throw new Error('Не заполнен адрес сервера');
  if (!s.user) throw new Error('Не заполнен пользователь сервера');
  return s;
}

/**
 * Чистая сборка конфига ssh2: без сети и без файловой системы.
 * @param {{host?: string, port?: number|string, user?: string, authMethod?: string, keyPath?: string}} server
 * @param {{password?: string, privateKey?: Buffer, agent?: string}} [auth]
 * @returns {object} объект для new Client().connect()
 */
function buildConnectConfig(server, auth) {
  const s = validateServer(server);
  const a = auth || {};

  const config = {
    host: String(s.host),
    port: Number(s.port) || DEFAULT_PORT,
    username: String(s.user),
    readyTimeout: SFTP_READY_TIMEOUT_MS,
    keepaliveInterval: SFTP_KEEPALIVE_INTERVAL_MS
  };

  if (s.authMethod === 'password') {
    if (a.password === undefined || a.password === null || a.password === '') {
      throw new Error('Нет пароля сервера');
    }
    config.password = String(a.password);
    return config;
  }

  if (s.authMethod === 'key') {
    // passphrase не принимается: парольная фраза не хранится в приложении
    // и не может пересекать IPC (AGENTS.md, PROMPT-SFTP §7.2).
    if (typeof a.agent === 'string' && a.agent.length > 0) {
      config.agent = a.agent;
    } else if (Buffer.isBuffer(a.privateKey)) {
      config.privateKey = a.privateKey;
    } else {
      throw new Error(`Ключ недоступен — загрузите в ssh-agent: ${sshAddHint(s)}`);
    }
    return config;
  }

  throw new Error('Неизвестный способ аутентификации');
}

// Путь к приватному ключу не должен выходить за границы ~/.ssh: keyPath
// приходит из данных сервера, поэтому проверяется итоговый absolute-путь.
function keyFilePath(server) {
  const keyPath = String((server && server.keyPath) || '').trim();
  if (!keyPath) throw new Error('Не выбран ключ сервера');
  const resolved = path.resolve(expandTilde(keyPath));
  const sshRoot = path.resolve(sshDir);
  if (resolved !== sshRoot && !resolved.startsWith(sshRoot + path.sep)) {
    throw new Error('Путь к ключу вне ~/.ssh');
  }
  return resolved;
}

function readPrivateKey(server) {
  const file = keyFilePath(server);
  // Чтение файла проверяется ручным smoke-тестом (PROMPT-SFTP §10.2).
  try {
    return fs.readFileSync(file);
  } catch {
    throw new Error(`Ключ недоступен — загрузите в ssh-agent: ${sshAddHint(server)}`);
  }
}

// Отказ аутентификации — единственная ошибка, после которой имеет смысл
// пробовать следующий способ авторизации (agent → ключ из файла).
function isAuthError(err) {
  const message = String((err && err.message) || '');
  return /authentication/i.test(message);
}

// Ошибки ssh2 переводятся в наши фиксированные тексты: сырой err.message
// (и любые секреты в нём) наружу не отдаётся.
function mapConnectError(err, server) {
  const message = String((err && err.message) || '');
  if (/encrypted|passphrase/i.test(message)) {
    return new Error(`Ключ защищён парольной фразой — загрузите в ssh-agent: ${sshAddHint(server)}`);
  }
  if (isAuthError(err)) {
    if (server.authMethod === 'password') return new Error('Не удалось войти: проверьте пароль сервера');
    return new Error(`Не удалось войти по ключу — загрузите его в ssh-agent: ${sshAddHint(server)}`);
  }
  if (/timed out|timeout/i.test(message)) return new Error('Сервер не ответил вовремя');
  return new Error('Не удалось подключиться к серверу');
}

/**
 * Упорядоченные кандидаты авторизации: connect() пробует их по одному
 * отдельным подключением, пока не сработает. Для ключа первый кандидат —
 * ssh-agent, второй — ключ из файла (PROMPT-SFTP §7.2).
 * @param {object} server данные сервера из data.json
 * @param {{password?: string, agent?: string|null, privateKey?: Buffer}} [credentials]
 * @returns {Array<object>} кандидаты для buildConnectConfig()
 */
function buildAuthCandidates(server, credentials) {
  const s = server || {};
  const creds = credentials || {};

  if (s.authMethod === 'password') {
    const password = creds.password != null ? creds.password : s.password;
    if (password === undefined || password === null || password === '') {
      throw new Error('Нет пароля сервера');
    }
    return [{ password: String(password) }];
  }

  if (s.authMethod === 'key') {
    const candidates = [];
    if (typeof creds.agent === 'string' && creds.agent.length > 0) {
      candidates.push({ agent: creds.agent });
    }
    if (Buffer.isBuffer(creds.privateKey)) {
      candidates.push({ privateKey: creds.privateKey });
    }
    if (candidates.length === 0) {
      throw new Error(`Ключ недоступен — загрузите в ssh-agent: ${sshAddHint(s)}`);
    }
    return candidates;
  }

  throw new Error('Неизвестный способ аутентификации');
}

function resolveServerId(server) {
  if (server.id) return String(server.id);
  if (server.name) return String(server.name);
  return String(server.host || '');
}

function nextSessionId() {
  seq += 1;
  return SESSION_ID_PREFIX + Date.now().toString(36) + seq.toString(36);
}

// Секреты для конфига подготавливаются один раз: пароль — из расшифрованного
// хранилища, agent — из аргумента или SSH_AUTH_SOCK, ключ — читается здесь,
// в main. Ошибка чтения ключа не фатальна, если есть агент: кандидат {agent}
// может дать доступ без файла.
function prepareCredentials(server, auth) {
  const provided = auth || {};
  if (server.authMethod === 'password') {
    return { password: provided.password != null ? provided.password : server.password };
  }
  if (server.authMethod !== 'key') return {};

  const agent = provided.agent !== undefined ? provided.agent : process.env.SSH_AUTH_SOCK;
  const credentials = { agent };
  try {
    credentials.privateKey = readPrivateKey(server);
  } catch (err) {
    // Без агента показываем исходную ошибку: границы пути или ssh-add.
    if (typeof agent !== 'string' || agent.length === 0) throw err;
  }
  return credentials;
}

/* c8 ignore start -- сетевой слой ssh2 не покрывается unit-тестами (PROMPT-SFTP §10.2) */
function openClient(config) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        // сокет мог не открыться — end() в этом случае безопасен
      }
      reject(err);
    };
    client.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });
    client.once('error', fail);
    try {
      client.connect(config);
    } catch (err) {
      // ssh2 бросает синхронно ошибки разбора ключа (например, зашифрованный
      // ключ без passphrase) — их тоже нужно превратить в понятное сообщение.
      fail(err);
    }
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function readHome(sftp) {
  return new Promise((resolve) => {
    sftp.realpath('.', (err, home) => resolve(err ? '' : home));
  });
}

/**
 * Открывает SFTP-сессию: ssh2 Client → ready → SFTP-подсистема.
 * Сначала пробуется agent, при отказе авторизации — ключ из файла.
 * @param {object} server данные сервера из data.json
 * @param {{password?: string, agent?: string|null}} [auth] секреты из расшифрованного хранилища
 * @returns {Promise<{sessionId: string, home: string}>}
 */
async function connect(server, auth) {
  // fail-closed: без проверки host key соединение невозможно
  if (typeof hostKeyVerifier !== 'function') throw new Error('Проверка host key не настроена');

  const s = validateServer(server);
  const candidates = buildAuthCandidates(s, prepareCredentials(s, auth));

  let client = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const config = buildConnectConfig(s, candidates[i]);
    config.hostVerifier = hostKeyVerifier;
    try {
      client = await openClient(config);
      break;
    } catch (err) {
      const hasNext = i < candidates.length - 1;
      // Отказ авторизации — пробуем следующий способ (agent → ключ из файла).
      // openClient уже закрыл неудачный клиент перед reject.
      if (isAuthError(err) && hasNext) continue;
      throw mapConnectError(err, s);
    }
  }
  if (!client) throw mapConnectError(null, s);

  let sftp;
  try {
    sftp = await openSftp(client);
  } catch {
    try {
      client.end();
    } catch {
      // соединение уже могло закрыться
    }
    throw new Error('Не удалось открыть SFTP-подсистему');
  }

  const now = Date.now();
  const session = {
    sessionId: nextSessionId(),
    client,
    sftp,
    serverId: resolveServerId(s),
    connectedAt: now,
    lastAt: now
  };
  sessions.set(session.sessionId, session);
  watchClient(session);
  ensureIdleSweepTimer();

  return { sessionId: session.sessionId, home: await readHome(sftp) };
}
/* c8 ignore stop */

function closeSession(session, reason) {
  if (!session || !sessions.delete(session.sessionId)) return false;
  stopIdleSweepTimer();
  try {
    session.sftp.end();
  } catch {
    // канал SFTP мог уже закрыться вместе с соединением
  }
  try {
    session.client.end();
  } catch {
    // соединение могло разорваться раньше
  }
  emit('sftp:session-closed', session.sessionId, reason || 'closed');
  return true;
}

function watchClient(session) {
  const onGone = (reason) => {
    if (sessions.has(session.sessionId)) closeSession(session, reason);
  };
  session.client.on('close', () => onGone('closed'));
  session.client.on('error', () => onGone('error'));
}

function sweepIdle(now = Date.now()) {
  let closed = 0;
  for (const session of Array.from(sessions.values())) {
    if (isSessionIdle(session, now)) {
      closeSession(session, 'idle');
      closed += 1;
    }
  }
  return closed;
}

// Таймер нужен, чтобы простаивающая сессия закрывалась без операций в UI.
// unref — чтобы таймер не держал процесс при выходе приложения.
function ensureIdleSweepTimer() {
  if (idleSweepTimer || sessions.size === 0) return;
  idleSweepTimer = setInterval(() => sweepIdle(), IDLE_SWEEP_INTERVAL_MS);
  if (typeof idleSweepTimer.unref === 'function') idleSweepTimer.unref();
}

function stopIdleSweepTimer() {
  if (idleSweepTimer && sessions.size === 0) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}

// Активность «продлевает» сессию: touch() вызывается трансферами и операциями,
// поэтому idle-таймаут не рвёт активную передачу.
function isSessionIdle(session, now = Date.now()) {
  if (!session) return false;
  return now - Number(session.lastAt || 0) >= SFTP_IDLE_TIMEOUT_MS;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (isSessionIdle(session)) {
    closeSession(session, 'idle');
    return null;
  }
  return session;
}

function touch(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.lastAt = Date.now();
  return true;
}

function disconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  return closeSession(session, 'closed');
}

function killAll() {
  for (const session of Array.from(sessions.values())) closeSession(session, 'closed');
}

module.exports = {
  setEventSink,
  setHostKeyVerifier,
  buildConnectConfig,
  buildAuthCandidates,
  isAuthError,
  mapConnectError,
  connect,
  disconnect,
  killAll,
  touch,
  getSession,
  isSessionIdle
};
