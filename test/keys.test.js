'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const keys = require('../main/services/keys');

test('sanitizeName: убирает ../, пробелы, спецсимволы и ведущие точки', () => {
  assert.strictEqual(keys.sanitizeName('my key'), 'my-key');
  assert.strictEqual(keys.sanitizeName('  padded  '), 'padded');
  assert.strictEqual(keys.sanitizeName('../etc/passwd'), '-etc-passwd');
  assert.strictEqual(keys.sanitizeName('..\\windows\\path'), '-windows-path');
  assert.strictEqual(keys.sanitizeName('.hidden'), 'hidden');
  assert.strictEqual(keys.sanitizeName('..hidden'), 'hidden');
  assert.strictEqual(keys.sanitizeName('my@key!'), 'mykey');
  assert.strictEqual(keys.sanitizeName('id_ed25519'), 'id_ed25519');
});

test('sanitizeName: пустое имя / одни точки / одни пробелы → ошибка', () => {
  assert.throws(() => keys.sanitizeName(''), /Недопустимое имя/);
  assert.throws(() => keys.sanitizeName('   '), /Недопустимое имя/);
  assert.throws(() => keys.sanitizeName('...'), /Недопустимое имя/);
});

test('parseFingerprintLine: строка со скобками — тип извлекается из (TYPE)', () => {
  assert.deepStrictEqual(
    keys.parseFingerprintLine('256 SHA256:u/... user@host (ED25519)'),
    { bits: '256', fingerprint: 'SHA256:u/...', comment: 'user@host', type: 'ED25519' }
  );
  assert.deepStrictEqual(
    keys.parseFingerprintLine('3072 SHA256:abcd1234 some comment (RSA)'),
    { bits: '3072', fingerprint: 'SHA256:abcd1234', comment: 'some comment', type: 'RSA' }
  );
});

test('parseFingerprintLine: строка без скобок — тип пустой, комментарий целиком', () => {
  assert.deepStrictEqual(
    keys.parseFingerprintLine('3072 SHA256:abc123 user@host'),
    { bits: '3072', fingerprint: 'SHA256:abc123', comment: 'user@host', type: '' }
  );
  assert.deepStrictEqual(
    keys.parseFingerprintLine('256 SHA256:xyz'),
    { bits: '256', fingerprint: 'SHA256:xyz', comment: '', type: '' }
  );
});
