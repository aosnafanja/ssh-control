'use strict';

// Гейт «≤700 строк кода на файл».
//
// Обходит main/**, renderer/**, test/**, scripts/** для расширений .js / .html / .css.
// Исключает renderer/vendor/** (сторонние сборки xterm), node_modules/ и dist/.
//
// Считает СТРОКИ КОДА: строка засчитывается, если в ней есть хотя бы один
// непробельный символ ВНЕ комментария. Пустые строки и комментарии не считаются.
// Комментарии вырезаются корректно:
//   JS/CSS — `//` и `/* ... */` с учётом строковых литералов ('', "", template ``,
//   экранирований и `${...}`-интерполяции);
//   HTML — `<!-- ... -->`.
// Строка «код + хвостовой комментарий» считается одной строкой кода.

const fs = require('fs');
const path = require('path');

const LIMIT = 700;
const REPO_ROOT = path.resolve(__dirname, '..');
const ROOTS = ['main', 'renderer', 'test', 'scripts'];
const EXTENSIONS = new Set(['.js', '.html', '.css']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist']);
const EXCLUDED_REL_DIRS = new Set(['renderer/vendor']);

function toRel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function collectFiles() {
  const files = [];
  for (const root of ROOTS) {
    const rootAbs = path.join(REPO_ROOT, root);
    let rootStat;
    try {
      rootStat = fs.statSync(rootAbs);
    } catch {
      continue;
    }
    if (!rootStat.isDirectory()) continue;

    const stack = [rootAbs];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
          if (EXCLUDED_REL_DIRS.has(toRel(full))) continue;
          stack.push(full);
        } else if (entry.isFile()) {
          if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(full);
          }
        }
      }
    }
  }
  return files;
}

// Вырезает JS/CSS-комментарии, сохраняя переводы строк. Символы комментария
// заменяются пробелами (а не удаляются), чтобы многострочный комментарий
// не склеивал соседние строки, а «код + хвостовой комментарий» остался одной строкой.
function stripJsCssComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;

  const emit = (s) => { out += s; };

  const scanQuoted = (quote) => {
    emit(quote);
    i++;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        emit(ch);
        i++;
        if (i < n) { emit(text[i]); i++; }
        continue;
      }
      emit(ch);
      i++;
      if (ch === quote) return;
    }
  };

  // Сканирует код до стоп-символа (для `${...}`) или до конца текста.
  // Стоп-символ не поглощается — его обрабатывает вызывающий.
  const scan = (stopChar) => {
    while (i < n) {
      const c = text[i];
      const d = text[i + 1];

      if (stopChar !== undefined && c === stopChar) return;

      if (c === '"' || c === "'") {
        scanQuoted(c);
        continue;
      }
      if (c === '`') {
        scanTemplate();
        continue;
      }
      if (c === '/' && d === '/') {
        emit('  ');
        i += 2;
        while (i < n && text[i] !== '\n') { emit(' '); i++; }
        continue;
      }
      if (c === '/' && d === '*') {
        emit('  ');
        i += 2;
        while (i < n) {
          if (text[i] === '*' && text[i + 1] === '/') {
            emit('  ');
            i += 2;
            break;
          }
          emit(text[i] === '\n' ? '\n' : ' ');
          i++;
        }
        continue;
      }

      emit(c);
      i++;
    }
  };

  const scanTemplate = () => {
    emit('`');
    i++;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        emit(ch);
        i++;
        if (i < n) { emit(text[i]); i++; }
        continue;
      }
      if (ch === '`') {
        emit(ch);
        i++;
        return;
      }
      if (ch === '$' && text[i + 1] === '{') {
        emit('${');
        i += 2;
        scan('}');
        if (i < n && text[i] === '}') { emit('}'); i++; }
        continue;
      }
      emit(ch);
      i++;
    }
  };

  scan(undefined);
  return out;
}

// Вырезает HTML-комментарии `<!-- ... -->`, сохраняя переводы строк.
function stripHtmlComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '<' && text[i + 1] === '!' && text[i + 2] === '-' && text[i + 3] === '-') {
      out += '    ';
      i += 4;
      while (i < n) {
        if (text[i] === '-' && text[i + 1] === '-' && text[i + 2] === '>') {
          out += '   ';
          i += 3;
          break;
        }
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function countCodeLines(text, kind) {
  const stripped = kind === 'html' ? stripHtmlComments(text) : stripJsCssComments(text);
  let count = 0;
  for (const line of stripped.split('\n')) {
    if (/\S/.test(line)) count += 1;
  }
  return count;
}

function main() {
  const files = collectFiles().sort((a, b) => toRel(a).localeCompare(toRel(b)));

  const results = [];
  const readErrors = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      readErrors.push({ file: toRel(file), error: err.message });
      continue;
    }
    const kind = path.extname(file).toLowerCase() === '.html' ? 'html' : 'js';
    results.push({ file: toRel(file), lines: countCodeLines(text, kind) });
  }

  const violations = results
    .filter((r) => r.lines > LIMIT)
    .sort((a, b) => b.lines - a.lines);

  console.log('SSH Control — гейт «≤700 строк кода на файл»');
  console.log('');
  console.log(`Отсканировано файлов: ${results.length}`);

  const byLines = results.slice().sort((a, b) => b.lines - a.lines);
  for (const r of byLines) {
    const tag = r.lines > LIMIT ? `   ← нарушение (> ${LIMIT})` : '';
    console.log(`${String(r.lines).padStart(5)}  ${r.file}${tag}`);
  }

  if (readErrors.length > 0) {
    console.log('');
    console.log('Ошибки чтения:');
    for (const e of readErrors) {
      console.log(`  - ${e.file}: ${e.error}`);
    }
  }

  if (violations.length > 0) {
    console.log('');
    console.log(`Нарушений: ${violations.length}`);
    for (const v of violations) {
      console.log(`  ⚠ ${v.file}: ${v.lines} строк кода (лимит ${LIMIT})`);
    }
    console.log('');
    console.log('✗ Лимит превышен.');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('✓ Все файлы в пределах лимита (≤700 строк кода).');
    process.exitCode = 0;
  }
}

main();
