'use strict';

// Автодополнение терминала (#14): подсказки команд из истории текущей сессии
// и из скроллбэка панели — как Autocomplete в iTerm2. Чистая логика (история,
// слова, предложения, отслеживание набранной строки) отделена от DOM-виджета:
// её проверяют unit-тесты без браузера. Виджет — всплывающий список у курсора
// внутри панели, ничего не меняет в остальных экранах.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.Autocomplete = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const HISTORY_CAP = 200;
  const MIN_TEXT = 2;
  const MAX_SUGGESTIONS = 8;
  const MAX_INPUT = 4096;
  const SCROLLBACK_LINES = 400;
  const REFRESH_DELAY = 60;
  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';
  const WORD_EDGE = /^[^A-Za-z0-9_./~-]+|[^A-Za-z0-9_./~-]+$/g;

  /* ---------- чистая логика ---------- */

  function cleanWord(raw) {
    const word = String(raw == null ? '' : raw).replace(WORD_EDGE, '');
    return word.length >= MIN_TEXT ? word : '';
  }

  // Уникальные слова текста в порядке появления. Из них берутся кандидаты для
  // продолжения последнего слова: флаги, пути, имена файлов из вывода.
  function extractWords(text) {
    const out = [];
    const seen = new Set();
    const parts = String(text == null ? '' : text).split(/\s+/);
    for (const part of parts) {
      const word = cleanWord(part);
      if (!word || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
    return out;
  }

  function lastWord(text) {
    // Только слово, упирающееся в конец строки: «git » — пробел на конце,
    // значит дополнять нечего (следующий ввод начнёт новое слово).
    const match = /(\S+)$/.exec(String(text == null ? '' : text));
    return match ? match[1] : '';
  }

  // История команд панели: без пустых, без дублей (повтор поднимает команду
  // в конец), не длиннее cap. Исходный массив не меняется.
  function recordCommand(history, line, cap) {
    const text = String(line == null ? '' : line).trim();
    const out = Array.isArray(history) ? history.slice() : [];
    if (!text) return out;
    const index = out.indexOf(text);
    if (index >= 0) out.splice(index, 1);
    out.push(text);
    const max = typeof cap === 'number' && cap > 0 ? cap : HISTORY_CAP;
    while (out.length > max) out.shift();
    return out;
  }

  // Подсказки к набранному тексту. Оба источника продолжают ввод без удаления:
  // remainder — то, что дописывается к концу строки.
  //  1) целые команды истории, начинающиеся с набранного текста (свежие первыми);
  //  2) слова из истории и скроллбэка, начинающиеся с последнего слова.
  // Одинаковый remainder показывается один раз: команда приоритетнее слова.
  function suggest(sources, typed, limit) {
    const text = String(typed == null ? '' : typed);
    const out = [];
    const seen = new Set();
    const max = Math.min(20, Math.max(1, Number(limit) || MAX_SUGGESTIONS));
    const history = sources && Array.isArray(sources.history) ? sources.history : [];
    const words = sources && Array.isArray(sources.words) ? sources.words : [];
    if (text.replace(/\s+$/, '').length < MIN_TEXT) return out;

    const add = (value, remainder, kind) => {
      if (!remainder || seen.has(remainder)) return;
      seen.add(remainder);
      out.push({ value, remainder, kind });
    };

    for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
      const command = String(history[i] == null ? '' : history[i]);
      if (command.startsWith(text) && command.length > text.length) {
        add(command, command.slice(text.length), 'history');
      }
    }

    const word = lastWord(text);
    if (word.length >= MIN_TEXT) {
      for (const candidate of words) {
        if (out.length >= max) break;
        if (typeof candidate !== 'string' || candidate === word || !candidate.startsWith(word)) continue;
        add(candidate, candidate.slice(word.length), 'word');
      }
    }
    return out;
  }

  // Отслеживание набранной строки по данным ввода в PTY (только они, без
  // эха: подсказка не должна зависеть от промпта). known=false означает, что
  // строку изменила сама оболочка (стрелки, Tab, Ctrl+W…) — подсказки
  // отключаются до Enter, чтобы не дописать текст в неправильное место.
  function trackInput(state, data) {
    const prev = state && typeof state === 'object' ? state : {};
    const prevText = typeof prev.text === 'string' ? prev.text : '';
    const prevKnown = prev.known !== false;
    const raw = data == null ? '' : String(data);
    if (!raw) return { text: prevText, known: prevKnown };
    if (raw.indexOf('\x1b') >= 0) return trackEscape(prevText, prevKnown, raw);

    let text = prevText;
    let known = prevKnown;
    for (const ch of raw) {
      if (ch === '\r' || ch === '\n') { text = ''; known = true; continue; }
      if (ch === '\x7f' || ch === '\b') { text = text.slice(0, -1); continue; }
      if (ch === '\x03' || ch === '\x15') { text = ''; known = true; continue; }
      if (ch === '\t' || ch < ' ') { known = false; continue; }
      text = (text + ch).slice(-MAX_INPUT);
    }
    return { text, known };
  }

  function trackEscape(text, known, raw) {
    const start = raw.indexOf(PASTE_START);
    const end = raw.indexOf(PASTE_END);
    if (start >= 0 && end > start) {
      const inner = raw.slice(start + PASTE_START.length, end);
      const lines = inner.split(/\r?\n/);
      const tail = lines[lines.length - 1];
      const merged = lines.length > 1 ? tail : text + tail;
      return { text: merged.slice(-MAX_INPUT), known: true };
    }
    return { text, known: false };
  }

  /* ---------- виджет панели ---------- */

  function ensure(pane) {
    if (!pane || !pane.body || !pane.term) return null;
    if (pane.ac) return pane.ac;

    const el = document.createElement('div');
    el.className = 'term-ac hidden';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Подсказки автодополнения');
    pane.body.appendChild(el);

    const ac = {
      el,
      items: [],
      index: 0,
      visible: false,
      timer: null,
      state: { text: '', known: true },
      history: [],
      histSeq: 0,
      cache: null,
      sources: { history: [], words: [] }
    };
    pane.ac = ac;
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      const item = e.target.closest('.term-ac-item');
      if (item) accept(pane, Number(item.dataset.index));
    });
    pane.term.attachCustomKeyEventHandler((e) => onKey(pane, e));
    // Потеря фокуса и изменение размеров панели: подсказки не должны висеть
    // поверх чужого окна или «уезжать» от курсора. onBlur есть не во всех
    // версиях xterm.js — слушаем сам textarea.
    if (pane.term.textarea) pane.term.textarea.addEventListener('blur', () => hide(pane));
    if (pane.term.onResize) pane.term.onResize(() => { if (pane.ac && pane.ac.visible) place(pane); });
    return ac;
  }

  function onKey(pane, e) {
    if (!pane.ac) return true;
    if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === ';' || e.key === ':')) {
      e.preventDefault();
      toggle(pane);
      return false;
    }
    const ac = pane.ac;
    if (!ac.visible) return true;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(pane, e.key === 'ArrowDown' ? 1 : -1);
      return false;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      accept(pane, ac.index);
      return false;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hide(pane);
      return false;
    }
    if (e.key === 'Enter') hide(pane);
    return true;
  }

  function schedule(pane) {
    const ac = pane.ac;
    if (!ac) return;
    clearTimeout(ac.timer);
    ac.timer = setTimeout(() => refresh(pane), REFRESH_DELAY);
  }

  function collect(pane) {
    const ac = pane.ac;
    const buffer = pane.term.buffer ? pane.term.buffer.active : null;
    const bufLen = buffer ? buffer.length : 0;
    if (ac.cache && ac.cache.bufLen === bufLen && ac.cache.histSeq === ac.histSeq) return ac.sources;

    const words = [];
    const seen = new Set();
    const addAll = (list) => {
      for (const word of list) {
        if (seen.has(word)) continue;
        seen.add(word);
        words.push(word);
      }
    };
    for (let i = ac.history.length - 1; i >= 0; i--) addAll(extractWords(ac.history[i]));
    if (buffer) {
      const start = Math.max(0, bufLen - SCROLLBACK_LINES);
      for (let i = bufLen - 1; i >= start; i--) {
        const line = buffer.getLine(i);
        if (line) addAll(extractWords(line.translateToString(true)));
      }
    }
    ac.cache = { bufLen, histSeq: ac.histSeq };
    ac.sources = { history: ac.history, words };
    return ac.sources;
  }

  function refresh(pane) {
    const ac = pane.ac;
    if (!ac || !pane.term) return;
    if (!ac.state.known || ac.state.text.replace(/\s+$/, '').length < MIN_TEXT) { hide(pane); return; }
    const items = suggest(collect(pane), ac.state.text, MAX_SUGGESTIONS);
    if (!items.length) { hide(pane); return; }
    ac.items = items;
    if (ac.index >= items.length) ac.index = 0;
    render(pane);
  }

  function render(pane) {
    const ac = pane.ac;
    const text = ac.state.text;
    const word = lastWord(text);
    const prefixOf = (item) => (item.kind === 'history' ? text : (word || text));
    const items = ac.items.map((item, i) => {
      const prefix = prefixOf(item);
      const head = item.value.slice(0, prefix.length);
      const tail = item.value.slice(prefix.length);
      const kind = item.kind === 'history' ? 'команда' : 'слово';
      return `
        <button type="button" class="term-ac-item ${i === ac.index ? 'active' : ''}" data-index="${i}" role="option" aria-selected="${i === ac.index}" title="${esc(item.value)}">
          <span class="term-ac-text">${esc(head)}<b>${esc(tail)}</b></span>
          <span class="term-ac-kind">${esc(kind)}</span>
        </button>`;
    }).join('');
    ac.el.innerHTML = items + '<div class="term-ac-hint">↑↓ — выбрать · Tab — принять · Esc — скрыть</div>';
    ac.visible = true;
    ac.el.classList.remove('hidden');
    place(pane);
  }

  function place(pane) {
    const ac = pane.ac;
    const screen = pane.term.element && pane.term.element.querySelector('.xterm-screen');
    if (!screen || !pane.body) return;
    const bodyRect = pane.body.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const cols = pane.term.cols || 80;
    const rows = pane.term.rows || 24;
    const cellW = screenRect.width / cols;
    const cellH = screenRect.height / rows;
    const cursor = pane.term.buffer.active;
    const left = screenRect.left - bodyRect.left + cursor.cursorX * cellW;
    const top = screenRect.top - bodyRect.top + (cursor.cursorY + 1) * cellH;
    const width = ac.el.offsetWidth || 240;
    const height = ac.el.offsetHeight || 160;
    ac.el.style.left = Math.round(Math.min(left, Math.max(0, bodyRect.width - width - 6))) + 'px';
    ac.el.style.top = Math.round(top + height > bodyRect.height ? Math.max(0, top - height - cellH) : top) + 'px';
  }

  function hide(pane) {
    const ac = pane && pane.ac;
    if (!ac) return;
    clearTimeout(ac.timer);
    ac.timer = null;
    ac.visible = false;
    ac.el.classList.add('hidden');
  }

  function accept(pane, index) {
    const ac = pane.ac;
    const item = ac && ac.items[index];
    if (!item) return;
    if (pane.sessionId) bridge.writeTerminal(pane.sessionId, item.remainder);
    ac.state = { text: ac.state.text + item.remainder, known: ac.state.known };
    hide(pane);
    if (pane.term) pane.term.focus();
  }

  function move(pane, delta) {
    const ac = pane.ac;
    if (!ac.visible || !ac.items.length) return;
    ac.index = (ac.index + delta + ac.items.length) % ac.items.length;
    render(pane);
  }

  function toggle(pane) {
    const ac = pane && pane.ac;
    if (!ac) return;
    if (ac.visible) { hide(pane); return; }
    if (!ac.state.known) { toast('Строка изменена — начните ввод заново', 'error'); return; }
    if (ac.state.text.replace(/\s+$/, '').length < MIN_TEXT) { toast('Введите хотя бы два символа команды'); return; }
    ac.index = 0;
    refresh(pane);
  }

  function onInput(pane, data) {
    const ac = applyInput(pane, data);
    if (ac) schedule(pane);
  }

  // Вещание ввода в соседние панели: держим их буфер в синхронизации с PTY,
  // но подсказки показываем только в той панели, где реально печатают.
  function onBroadcast(pane, data) {
    applyInput(pane, data);
  }

  function applyInput(pane, data) {
    const ac = ensure(pane);
    if (!ac) return null;
    const raw = data == null ? '' : String(data);
    if (ac.state.known && raw === '\r' && ac.state.text.trim()) {
      ac.history = recordCommand(ac.history, ac.state.text, HISTORY_CAP);
      ac.histSeq++;
      ac.cache = null;
    }
    ac.state = trackInput(ac.state, raw);
    ac.index = 0;
    return ac;
  }

  function dispose(pane) {
    const ac = pane && pane.ac;
    if (!ac) return;
    clearTimeout(ac.timer);
    if (ac.el && ac.el.parentNode) ac.el.parentNode.removeChild(ac.el);
    pane.ac = null;
  }

  return {
    extractWords,
    lastWord,
    recordCommand,
    suggest,
    trackInput,
    mount: ensure,
    onInput,
    toggle,
    dismiss: hide,
    dispose
  };
});
