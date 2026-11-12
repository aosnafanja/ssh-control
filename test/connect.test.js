'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const connect = require('../main/services/connect');

test('buildArgs: пустой сервер / нет хоста → []', () => {
  assert.deepStrictEqual(connect.buildArgs(null), []);
  assert.deepStrictEqual(connect.buildArgs({}), []);
  assert.deepStrictEqual(connect.buildArgs({ host: '' }), []);
});

test('buildArgs: порт 22 (по умолчанию) не добавляется', () => {
  const args = connect.buildArgs({ host: 'example.com', port: 22 });
  assert.ok(!args.includes('-p'), 'не должно быть -p для порта 22');
  assert.deepStrictEqual(args, ['example.com']);
});

test('buildArgs: нестандартный порт добавляется парой -p PORT', () => {
  const args = connect.buildArgs({ host: 'example.com', port: 2222 });
  assert.deepStrictEqual(args, ['-p', '2222', 'example.com']);
});

test('buildArgs: ключ добавляет -i, expanded путь и IdentitiesOnly', () => {
  const args = connect.buildArgs({ host: 'h', authMethod: 'key', keyPath: '~/.ssh/id_ed25519' });
  assert.deepStrictEqual(args, [
    '-i', path.join(os.homedir(), '.ssh/id_ed25519'),
    '-o', 'IdentitiesOnly=yes',
    'h'
  ]);
});

test('buildArgs: парольный вход не добавляет -i', () => {
  const args = connect.buildArgs({ host: 'h', authMethod: 'password', keyPath: '~/.ssh/id' });
  assert.ok(!args.includes('-i'));
  assert.deepStrictEqual(args, ['h']);
});

test('buildArgs: extraArgs разбивается по пробелам отдельными аргументами', () => {
  const args = connect.buildArgs({ host: 'h', extraArgs: '-o ServerAliveInterval=60 -C' });
  assert.deepStrictEqual(args, ['-o', 'ServerAliveInterval=60', '-C', 'h']);
});

test('buildArgs: user подставляется в user@host, без user — просто host', () => {
  assert.deepStrictEqual(connect.buildArgs({ host: 'h', user: 'root' }), ['root@h']);
  assert.deepStrictEqual(connect.buildArgs({ host: 'h' }), ['h']);
});

test('buildCommand: собирает строку ssh из buildArgs', () => {
  const cmd = connect.buildCommand({ host: 'h', user: 'root', port: 2222 });
  assert.strictEqual(cmd, 'ssh -p 2222 root@h');
  assert.strictEqual(connect.buildCommand({ host: '' }), '');
});

test('buildAliasArgs / buildAliasCommand', () => {
  assert.deepStrictEqual(connect.buildAliasArgs('myserver'), ['myserver']);
  assert.strictEqual(connect.buildAliasCommand('myserver'), 'ssh myserver');
  assert.deepStrictEqual(connect.buildAliasArgs(''), []);
  assert.strictEqual(connect.buildAliasCommand(''), 'ssh');
});

test('expandTilde: ~ и ~/ разворачиваются, остальное — как есть', () => {
  assert.strictEqual(connect.expandTilde('~'), os.homedir());
  assert.strictEqual(connect.expandTilde('~/x'), path.join(os.homedir(), 'x'));
  assert.strictEqual(connect.expandTilde('/abs/path'), '/abs/path');
  assert.strictEqual(connect.expandTilde(undefined), undefined);
});
