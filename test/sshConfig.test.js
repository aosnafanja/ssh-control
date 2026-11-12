'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Временная «чужая» папка вместо ~/.ssh — до require, т.к. sshDir читается на загрузке.
const SSH_DIR = path.join(os.tmpdir(), 'ssh-control-config-' + crypto.randomBytes(8).toString('hex'));
process.env.SSH_CONTROL_SSH_DIR = SSH_DIR;

const sshConfig = require('../main/services/sshConfig');

const configFile = () => path.join(SSH_DIR, 'config');
const write = (text) => {
  fs.mkdirSync(SSH_DIR, { recursive: true });
  fs.writeFileSync(configFile(), text);
};
const read = () => fs.readFileSync(configFile(), 'utf8');

after(() => {
  fs.rmSync(SSH_DIR, { recursive: true, force: true });
});

// Фикстура без реальных ключей/хостов: комментарии, Include, чужие опции.
const FIXTURE = [
  '# Глобальный комментарий',
  '',
  'Include ~/.ssh/company.conf',
  '',
  'Host *.example.com',
  '    User git',
  '    ServerAliveInterval 60',
  '',
  'Host myserver',
  '    HostName 192.168.1.10',
  '    User deploy',
  '    Port 2222',
  '    IdentityFile ~/.ssh/id_ed25519',
  '    ForwardAgent yes',
  '    ProxyJump bastion'
].join('\n');

test('listHosts: parse + splitOptions извлекают управляемые опции, чужое — в extra', () => {
  write(FIXTURE);
  const hosts = sshConfig.listHosts();
  assert.strictEqual(hosts.length, 2);

  const [glob, mine] = hosts;
  assert.strictEqual(glob.name, '*.example.com');
  assert.strictEqual(glob.hostName, '');
  assert.strictEqual(glob.user, 'git');
  assert.strictEqual(glob.extraCount, 1); // ServerAliveInterval

  assert.strictEqual(mine.name, 'myserver');
  assert.strictEqual(mine.hostName, '192.168.1.10');
  assert.strictEqual(mine.user, 'deploy');
  assert.strictEqual(mine.port, '2222');
  assert.strictEqual(mine.identityFile, '~/.ssh/id_ed25519');
  assert.strictEqual(mine.extraCount, 2); // ForwardAgent, ProxyJump
});

test('getHost: возвращает extra (незнакомые опции) как строку с отступами', () => {
  write(FIXTURE);
  const h = sshConfig.getHost('myserver');
  assert.strictEqual(h.name, 'myserver');
  assert.strictEqual(h.hostName, '192.168.1.10');
  assert.strictEqual(h.extra, '    ForwardAgent yes\n    ProxyJump bastion');
  assert.strictEqual(sshConfig.getHost('missing'), null);
});

test('saveHost: чужой контент сохраняется verbatim, правится только свой блок', () => {
  write(FIXTURE);
  sshConfig.saveHost({
    name: 'myserver',
    hostName: 'new.example.com',
    user: 'root',
    port: 22,
    identityFile: '~/.ssh/id_rsa',
    extra: '    ForwardAgent yes\n    ProxyJump bastion'
  });

  const text = read();
  // преамбула (комментарий + Include) verbatim
  assert.ok(text.startsWith('# Глобальный комментарий\n\nInclude ~/.ssh/company.conf\n'));
  // чужой Host-блок verbatim
  assert.ok(text.includes('\nHost *.example.com\n    User git\n    ServerAliveInterval 60\n'));
  // свой блок переписан, extra сохранён
  assert.ok(text.includes(
    'Host myserver\n    HostName new.example.com\n    User root\n    IdentityFile ~/.ssh/id_rsa\n    ForwardAgent yes\n    ProxyJump bastion'
  ));
  // порт 22 (по умолчанию) не пишется; старые значения исчезли
  assert.ok(!text.includes('Port'));
  assert.ok(!text.includes('192.168.1.10'));
  assert.ok(!text.includes('2222'));
  assert.ok(!text.includes('deploy'));
});

test('saveHost: добавление нового блока сохраняет существующие', () => {
  write(FIXTURE);
  sshConfig.saveHost({ name: 'newbox', hostName: '10.0.0.5', user: 'admin', port: 2222 });
  const text = read();
  assert.ok(text.includes('Host newbox\n    HostName 10.0.0.5\n    User admin\n    Port 2222'));
  assert.ok(text.includes('Host myserver'));
});

test('deleteHost: удаляет только свой блок, чужой контент сохраняется', () => {
  write(FIXTURE);
  sshConfig.deleteHost('myserver');
  const text = read();
  assert.ok(text.startsWith('# Глобальный комментарий\n\nInclude ~/.ssh/company.conf\n'));
  assert.ok(text.includes('Host *.example.com\n    User git\n    ServerAliveInterval 60'));
  assert.ok(!text.includes('Host myserver'));
  assert.ok(!text.includes('ProxyJump bastion'));
});

test('saveHost/deleteHost: валидация имени', () => {
  write('');
  assert.throws(() => sshConfig.saveHost({}), /Укажите псевдоним/);
  assert.throws(() => sshConfig.saveHost({ name: 'a b' }), /пробелов/);
  assert.throws(() => sshConfig.deleteHost('nope'), /не найден/);
});
