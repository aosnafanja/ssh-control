'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Уникальная временная папка ДО require — dataDir читается на загрузке модуля.
const BASE = path.join(os.tmpdir(), 'ssh-control-storage-' + crypto.randomBytes(8).toString('hex'));
process.env.SSH_CONTROL_DATA_DIR = BASE;

const storage = require('../main/services/storage');

function reset() {
  storage.lock();
  for (const f of ['data.json', 'data.json.tmp']) {
    fs.rmSync(path.join(BASE, f), { force: true });
  }
}

after(() => {
  fs.rmSync(BASE, { recursive: true, force: true });
});

test('storage.defaultData: базовая схема version 1', () => {
  assert.deepStrictEqual(storage.defaultData(), {
    version: 1,
    servers: [],
    keyMeta: {},
    settings: { theme: 'system' },
    snippets: []
  });
});

test('storage: setMasterPassword + unlock round-trip на временной папке', () => {
  reset();
  const payload = {
    version: 1,
    servers: [{ host: 'example.com' }],
    keyMeta: {},
    settings: { theme: 'dark' }
  };
  storage.save(payload);

  const res = storage.setMasterPassword({ next: 'test-master-password' });
  assert.strictEqual(res.encrypted, true);

  // на диске — только шифр, открытого data.json нет
  const onDisk = JSON.parse(fs.readFileSync(path.join(BASE, 'data.json'), 'utf8'));
  assert.strictEqual(onDisk.encrypted, true);
  assert.ok(onDisk.ciphertext);
  assert.ok(onDisk.iv);
  assert.ok(onDisk.tag);
  assert.ok(onDisk.kdf.salt);
  assert.ok(!('data' in onDisk));

  // данные ещё в памяти после установки пароля
  assert.deepStrictEqual(storage.getData().servers, payload.servers);

  // lock → unlock возвращает те же данные
  storage.lock();
  assert.strictEqual(storage.getData(), null);
  const unlocked = storage.unlock('test-master-password');
  assert.deepStrictEqual(unlocked.servers, payload.servers);

  // неверный пароль → null
  storage.lock();
  assert.strictEqual(storage.unlock('wrong-password'), null);
});

test('storage: lock() сбрасывает данные (в зашифрованном режиме)', () => {
  reset();
  storage.save({ version: 1, servers: [], keyMeta: {}, settings: { theme: 'system' } });
  storage.setMasterPassword({ next: 'test-pw' });

  assert.ok(storage.getData());            // данные доступны в памяти
  assert.strictEqual(storage.lock(), true);
  assert.strictEqual(storage.getData(), null); // после lock сброшены
  assert.ok(storage.unlock('test-pw'));          // unlock снова отдаёт данные
});

test('storage: save бросает, когда зашифрованное хранилище заблокировано', () => {
  reset();
  storage.save({ version: 1, servers: [], keyMeta: {}, settings: { theme: 'system' } });
  storage.setMasterPassword({ next: 'test-pw' });
  storage.lock();
  assert.throws(
    () => storage.save({ version: 1, servers: [], keyMeta: {}, settings: { theme: 'system' } }),
    /заблокировано/i
  );
});
