'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const keysBackup = require('../main/services/keysBackup');

test('keysBackup.isSshBackupFile: включаемые и исключаемые имена ~/.ssh', () => {
  assert.strictEqual(keysBackup.isSshBackupFile('config'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('known_hosts'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('authorized_keys'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('id_ed25519'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('id_rsa'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('id_ecdsa'), true);
  assert.strictEqual(keysBackup.isSshBackupFile('id_ed25519.pub'), true);

  assert.strictEqual(keysBackup.isSshBackupFile('agent.sock'), false);
  assert.strictEqual(keysBackup.isSshBackupFile('id_ed25519.bak'), false);
  assert.strictEqual(keysBackup.isSshBackupFile('id_ed25519.old'), false);
  assert.strictEqual(keysBackup.isSshBackupFile('random.txt'), false);
  assert.strictEqual(keysBackup.isSshBackupFile(''), false);
  assert.strictEqual(keysBackup.isSshBackupFile(null), false);
});
