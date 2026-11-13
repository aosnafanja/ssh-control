'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ac = require('../renderer/autocomplete');

test('autocomplete.extractWords: чистка пунктуации, дедуп, минимальная длина', () => {
  const words = ac.extractWords('ls -la /var/log, "git" (status) ls --color=auto a');
  assert.deepStrictEqual(words, ['ls', '-la', '/var/log', 'git', 'status', '--color=auto']);
});

test('autocomplete.extractWords: пустой и нестроковый ввод', () => {
  assert.deepStrictEqual(ac.extractWords(''), []);
  assert.deepStrictEqual(ac.extractWords(null), []);
  assert.deepStrictEqual(ac.extractWords('      '), []);
});

test('autocomplete.lastWord: последнее слово строки', () => {
  assert.strictEqual(ac.lastWord('git status'), 'status');
  assert.strictEqual(ac.lastWord('git '), '');
  assert.strictEqual(ac.lastWord(''), '');
  assert.strictEqual(ac.lastWord(null), '');
});

test('autocomplete.recordCommand: добавление, дедуп со сдвигом в конец, лимит', () => {
  assert.deepStrictEqual(ac.recordCommand([], 'ls -la'), ['ls -la']);
  assert.deepStrictEqual(ac.recordCommand(['a', 'b'], 'a'), ['b', 'a']);
  assert.deepStrictEqual(ac.recordCommand(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  assert.deepStrictEqual(ac.recordCommand(['a'], '   '), ['a']);
  const source = ['a', 'b'];
  ac.recordCommand(source, 'c');
  assert.deepStrictEqual(source, ['a', 'b'], 'исходный массив не мутируется');
});

test('autocomplete.suggest: до 2 символов подсказок нет', () => {
  const sources = { history: ['git status'], words: ['status'] };
  assert.deepStrictEqual(ac.suggest(sources, ''), []);
  assert.deepStrictEqual(ac.suggest(sources, 'g'), []);
  assert.deepStrictEqual(ac.suggest(null, 'git st'), []);
});

test('autocomplete.suggest: целые команды из истории, свежие первыми', () => {
  const sources = { history: ['git status', 'git stash'], words: [] };
  assert.deepStrictEqual(ac.suggest(sources, 'git st'), [
    { value: 'git stash', remainder: 'ash', kind: 'history' },
    { value: 'git status', remainder: 'atus', kind: 'history' }
  ]);
});

test('autocomplete.suggest: продолжение аргумента по словам скроллбэка', () => {
  const sources = { history: [], words: ['status', 'stash', 'stat'] };
  assert.deepStrictEqual(ac.suggest(sources, 'git st'), [
    { value: 'status', remainder: 'atus', kind: 'word' },
    { value: 'stash', remainder: 'ash', kind: 'word' },
    { value: 'stat', remainder: 'at', kind: 'word' }
  ]);
});

test('autocomplete.suggest: одинаковый хвост не дублируется, история приоритетнее', () => {
  const sources = { history: ['git status'], words: ['status'] };
  const out = ac.suggest(sources, 'git st');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'history');
});

test('autocomplete.suggest: после пробела подсказываются команды из истории', () => {
  const sources = { history: ['git status'], words: ['status'] };
  assert.deepStrictEqual(ac.suggest(sources, 'git '), [
    { value: 'git status', remainder: 'status', kind: 'history' }
  ]);
});

test('autocomplete.suggest: лимит подсказок и отсутствие совпадений', () => {
  const words = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
  const out = ac.suggest({ history: [], words }, 'a', 8);
  assert.deepStrictEqual(out, [], 'односимвольный префикс слов не подсказывается');
  const limited = ac.suggest({ history: [], words }, 'ls aa', 3);
  assert.deepStrictEqual(limited, []);
  const many = ac.suggest({ history: [], words: ['aa1', 'aa2', 'aa3', 'aa4'] }, 'aa', 2);
  assert.strictEqual(many.length, 2);
  assert.deepStrictEqual(ac.suggest({ history: ['ls'], words: [] }, 'zz'), []);
});

test('autocomplete.trackInput: набор, backspace, Enter и Ctrl+C', () => {
  let state = { text: '', known: true };
  for (const ch of 'ls -l') state = ac.trackInput(state, ch);
  assert.deepStrictEqual(state, { text: 'ls -l', known: true });

  state = ac.trackInput(state, '\x7f');
  assert.strictEqual(state.text, 'ls -');

  state = ac.trackInput(state, '\r');
  assert.deepStrictEqual(state, { text: '', known: true });

  state = ac.trackInput(ac.trackInput(state, 'g'), '\x03');
  assert.deepStrictEqual(state, { text: '', known: true });

  state = ac.trackInput(ac.trackInput(state, 'abc'), '\x15');
  assert.deepStrictEqual(state, { text: '', known: true });
});

test('autocomplete.trackInput: редактирование строки сбрасывает доверие к буферу', () => {
  const base = ac.trackInput({ text: '', known: true }, 'git status');
  for (const seq of ['\x1b[D', '\t', '\x17', '\x01', '\x0b']) {
    const state = ac.trackInput(base, seq);
    assert.strictEqual(state.known, false, 'последовательность ' + JSON.stringify(seq) + ' делает текст ненадёжным');
  }
  const reset = ac.trackInput({ text: 'garbage', known: false }, '\r');
  assert.deepStrictEqual(reset, { text: '', known: true }, 'Enter восстанавливает синхронизацию');
});

test('autocomplete.trackInput: вставка и многострочная вставка', () => {
  const paste = ac.trackInput({ text: '', known: true }, '\x1b[200~git status\x1b[201~');
  assert.deepStrictEqual(paste, { text: 'git status', known: true });

  const multi = ac.trackInput({ text: '', known: true }, '\x1b[200~git add .\ngit commit -m x\x1b[201~');
  assert.deepStrictEqual(multi, { text: 'git commit -m x', known: true }, 'хвост после последнего перевода строки');
});
