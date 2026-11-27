'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const sftp = require('../main/services/sftp');

const PASSWORD = 'server-password';
const PRIVATE_KEY = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nZmFrZQ==\n-----END OPENSSH PRIVATE KEY-----\n');

// Данные сервера в том же виде, в каком их хранит data.json.
function server(overrides) {
  return Object.assign({
    id: 'sv_test',
    name: 'Тестовый сервер',
    host: 'example.com',
    port: 22,
    user: 'root',
    authMethod: 'password',
    keyPath: ''
  }, overrides);
}

function keyServer(overrides) {
  return server(Object.assign({ authMethod: 'key', keyPath: '~/.ssh/id_ed25519' }, overrides));
}

test('buildConnectConfig: парольный сервер — host/port/username и password', () => {
  const config = sftp.buildConnectConfig(server(), { password: PASSWORD });
  assert.strictEqual(config.host, 'example.com');
  assert.strictEqual(config.port, 22);
  assert.strictEqual(config.username, 'root');
  assert.strictEqual(config.password, PASSWORD);
  assert.strictEqual(config.readyTimeout, 20000);
  assert.strictEqual(config.keepaliveInterval, 0);
  assert.strictEqual(config.privateKey, undefined);
  assert.strictEqual(config.agent, undefined);
});

test('buildConnectConfig: порт по умолчанию 22, явный порт сохраняется', () => {
  assert.strictEqual(sftp.buildConnectConfig(server({ port: undefined }), { password: PASSWORD }).port, 22);
  assert.strictEqual(sftp.buildConnectConfig(server({ port: '' }), { password: PASSWORD }).port, 22);
  assert.strictEqual(sftp.buildConnectConfig(server({ port: 2222 }), { password: PASSWORD }).port, 2222);
  assert.strictEqual(sftp.buildConnectConfig(server({ port: '2200' }), { password: PASSWORD }).port, 2200);
});

test('buildConnectConfig: key + agent — приоритет агента над privateKey', () => {
  const config = sftp.buildConnectConfig(keyServer(), {
    agent: '/tmp/ssh-agent.sock',
    privateKey: PRIVATE_KEY
  });
  assert.strictEqual(config.agent, '/tmp/ssh-agent.sock');
  assert.strictEqual(config.privateKey, undefined);
  assert.strictEqual(config.password, undefined);
});

test('buildConnectConfig: key + privateKey без агента — Buffer в конфиге', () => {
  const config = sftp.buildConnectConfig(keyServer(), { privateKey: PRIVATE_KEY });
  assert.strictEqual(config.agent, undefined);
  assert.ok(Buffer.isBuffer(config.privateKey));
  assert.ok(config.privateKey.equals(PRIVATE_KEY));
});

test('buildConnectConfig: passphrase в конфиг не попадает никогда', () => {
  const config = sftp.buildConnectConfig(keyServer(), {
    privateKey: PRIVATE_KEY,
    passphrase: 'secret-phrase'
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'passphrase'));
  assert.ok(!JSON.stringify(config).includes('secret-phrase'));
});

test('buildConnectConfig: password без пароля — ошибка «Нет пароля сервера»', () => {
  assert.throws(() => sftp.buildConnectConfig(server(), {}), /Нет пароля сервера/);
  assert.throws(() => sftp.buildConnectConfig(server(), { password: '' }), /Нет пароля сервера/);
  assert.throws(() => sftp.buildConnectConfig(server(), { password: null }), /Нет пароля сервера/);
});

test('buildConnectConfig: key без агента и без ключа — подсказка ssh-add', () => {
  assert.throws(
    () => sftp.buildConnectConfig(keyServer(), {}),
    /Ключ недоступен — загрузите в ssh-agent: ssh-add ~\/\.ssh\/id_ed25519/
  );
  // Строковый ключ (например, путь) вместо Buffer не принимается.
  assert.throws(
    () => sftp.buildConnectConfig(keyServer(), { privateKey: '~/.ssh/id_ed25519' }),
    /Ключ недоступен/
  );
  // Пустой ssh-agent — то же самое, что и отсутствие агента.
  assert.throws(
    () => sftp.buildConnectConfig(keyServer(), { agent: '', privateKey: null }),
    /Ключ недоступен/
  );
});

test('buildConnectConfig: без хоста/пользователя или с неизвестным authMethod — ошибка', () => {
  assert.throws(() => sftp.buildConnectConfig(null, { password: PASSWORD }), /Не заполнен адрес сервера/);
  assert.throws(() => sftp.buildConnectConfig({}, { password: PASSWORD }), /Не заполнен адрес сервера/);
  assert.throws(
    () => sftp.buildConnectConfig(server({ user: '' }), { password: PASSWORD }),
    /Не заполнен пользователь сервера/
  );
  assert.throws(
    () => sftp.buildConnectConfig(server({ authMethod: 'agent' }), { password: PASSWORD }),
    /Неизвестный способ аутентификации/
  );
});

test('isSessionIdle: сессия живёт ровно 5 минут без активности', () => {
  const now = 1_000_000_000;
  const idleMs = 5 * 60 * 1000;
  assert.strictEqual(sftp.isSessionIdle(null, now), false);
  assert.strictEqual(sftp.isSessionIdle({ lastAt: now }, now), false);
  assert.strictEqual(sftp.isSessionIdle({ lastAt: now - idleMs + 1 }, now), false);
  assert.strictEqual(sftp.isSessionIdle({ lastAt: now - idleMs }, now), true);
  assert.strictEqual(sftp.isSessionIdle({ lastAt: now - idleMs - 1 }, now), true);
});

test('сессии: операции с неизвестным sessionId не падают', () => {
  assert.strictEqual(sftp.touch('sftp_missing'), false);
  assert.strictEqual(sftp.getSession('sftp_missing'), null);
  assert.strictEqual(sftp.disconnect('sftp_missing'), false);
  assert.doesNotThrow(() => sftp.killAll());
});

test('connect: без hostVerifier — fail-closed ошибка (сеть не трогаем)', async () => {
  sftp.setHostKeyVerifier(null);
  await assert.rejects(
    sftp.connect(server(), { password: PASSWORD }),
    /Проверка host key не настроена/
  );
});

test('connect: keyPath вне ~/.ssh отклоняется до сети', async () => {
  sftp.setHostKeyVerifier(() => false);
  // agent: null — тест не зависит от SSH_AUTH_SOCK окружения и проверяет
  // именно путь к ключу, не открывая сокетов.
  const noAgent = { agent: null };
  try {
    await assert.rejects(
      sftp.connect(keyServer({ keyPath: '/etc/passwd' }), noAgent),
      /Путь к ключу вне ~\/\.ssh/
    );
    await assert.rejects(
      sftp.connect(keyServer({ keyPath: '../secret' }), noAgent),
      /Путь к ключу вне ~\/\.ssh/
    );
    await assert.rejects(
      sftp.connect(keyServer({ keyPath: '' }), noAgent),
      /Не выбран ключ сервера/
    );
  } finally {
    sftp.setHostKeyVerifier(null);
  }
});
