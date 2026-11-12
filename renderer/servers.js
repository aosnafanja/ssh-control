'use strict';

function renderServers() {
  const groups = [...new Set((state.data.servers || []).map((s) => s.group).filter(Boolean))];
  const chips = ['all', ...groups].map((g) => `
    <button class="chip ${state.groupFilter === g ? 'active' : ''}" data-action="group-filter" data-group="${esc(g)}">
      ${g === 'all' ? 'Все' : esc(g)}
    </button>`).join('');
  $('#group-chips').innerHTML = chips;

  const q = state.searchServers.toLowerCase();
  let list = (state.data.servers || []).filter((s) => {
    const matchGroup = state.groupFilter === 'all' || (s.group || '') === state.groupFilter;
    const hay = (s.name + ' ' + s.host + ' ' + s.user + ' ' + (s.group || '') + ' ' + (s.notes || '')).toLowerCase();
    return matchGroup && (!q || hay.includes(q));
  });

  if (!list.length) {
    $('#servers-list').innerHTML = emptyState(
      q || state.groupFilter !== 'all' ? 'Ничего не найдено' : 'Серверов пока нет',
      q || state.groupFilter !== 'all' ? 'Измените фильтр или запрос.' : 'Добавьте первый сервер.'
    );
    return;
  }

  $('#servers-list').innerHTML = `<div class="server-grid">${list.map((s) => serverCard(s)).join('')}</div>`;
}

function serverCard(s) {
  const color = s.color || PALETTE[0];
  const addr = `${s.user ? s.user + '@' : ''}${s.host || '—'}${(s.port && Number(s.port) !== 22) ? ':' + s.port : ''}`;
  const authBadge = s.authMethod === 'password'
    ? '<span class="badge">🔒 Пароль</span>'
    : '<span class="badge">🔑 ' + esc(keyLabel(s.keyPath)) + '</span>';
  const hasAlias = !!serverHasAlias(s);
  return `
    <div class="card server-card" data-server-id="${esc(s.id)}">
      <div class="server-top">
        <div class="server-dot" style="background:${esc(color)}"></div>
        <div class="server-main">
          <div class="server-name">
            ${esc(s.name || 'Без имени')}
            ${s.group ? `<span class="badge">${esc(s.group)}</span>` : ''}
          </div>
          <div class="server-addr">${esc(addr)}</div>
          <div class="server-badges">${authBadge}</div>
        </div>
        <div class="server-actions" data-stop="1">
          <button class="icon-btn" data-action="server-edit" data-id="${esc(s.id)}" title="Редактировать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="server-delete" data-id="${esc(s.id)}" title="Удалить">${ICONS.trash}</button>
        </div>
      </div>
      <div class="server-foot">
        <button class="btn ghost${hasAlias ? ' has-alias' : ''}" data-action="server-alias" data-id="${esc(s.id)}" title="${hasAlias ? 'Редактировать псевдоним' : 'Создать псевдоним в ~/.ssh/config'}">${ICONS.tag} ${hasAlias ? 'Псевдоним ✓' : 'Псевдоним'}</button>
        <button class="btn ghost" data-action="server-copy-cmd" data-id="${esc(s.id)}">${ICONS.copy} Команда</button>
        <div class="spacer"></div>
        <button class="btn primary connect-btn" data-action="server-connect" data-id="${esc(s.id)}">${ICONS.terminal} Подключиться</button>
      </div>
    </div>`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serverHasAlias(server) {
  const slug = slugify(server.name || server.host);
  return state.aliases.find((a) =>
    a.name === slug || (a.hostName && a.hostName === server.host && a.user === server.user)
  ) || null;
}

function serverToAlias(server) {
  return {
    name: slugify(server.name || server.host) || 'server',
    hostName: server.host || '',
    user: server.user || '',
    port: server.port || '',
    identityFile: server.authMethod === 'key' ? server.keyPath : '',
    extra: ''
  };
}

function serverModal(server) {
  const isEdit = !!server;
  const s = server || { name: '', group: '', host: '', port: 22, user: '', authMethod: 'key', keyPath: '', password: '', color: PALETTE[0], notes: '', extraArgs: '' };
  const groups = [...new Set(state.data.servers.map((x) => x.group).filter(Boolean))];

  const m = openModal(`
    <h3>${isEdit ? 'Редактировать сервер' : 'Новый сервер'}</h3>
    <div class="field-row">
      <div class="field"><label>Название</label><input id="s-name" value="${esc(s.name)}" placeholder="Production"></div>
      <div class="field"><label>Группа</label><input id="s-group" list="s-groups" value="${esc(s.group || '')}" placeholder="Работа"></div>
    </div>
    <datalist id="s-groups">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
    <div class="field-row">
      <div class="field"><label>Хост</label><input id="s-host" value="${esc(s.host)}" placeholder="1.2.3.4"></div>
      <div class="field"><label>Порт</label><input id="s-port" type="number" value="${esc(s.port)}" placeholder="22"></div>
    </div>
    <div class="field"><label>Пользователь</label><input id="s-user" value="${esc(s.user)}" placeholder="root"></div>
    <div class="field">
      <label>Способ входа</label>
      <div class="segmented" id="s-auth">
        <button data-val="key" class="${s.authMethod !== 'password' ? 'active' : ''}">Ключ</button>
        <button data-val="password" class="${s.authMethod === 'password' ? 'active' : ''}">Пароль</button>
      </div>
    </div>
    <div class="field" id="s-key-wrap" ${s.authMethod === 'password' ? 'hidden' : ''}>
      <label>SSH-ключ</label>
      <select id="s-key">
        <option value="">— не выбран —</option>
        ${state.keys.map((k) => `<option value="~/.ssh/${esc(k.name)}" ${s.keyPath === '~/.ssh/' + k.name ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field" id="s-pass-wrap" ${s.authMethod !== 'password' ? 'hidden' : ''}>
      <label>Пароль</label>
      <input type="password" id="s-pass" value="${esc(s.password || '')}" placeholder="пароль сервера">
    </div>
    <div class="field">
      <label>Цвет</label>
      <div class="swatches" id="s-color">${PALETTE.map((c) => `<div class="swatch ${c === s.color ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>
    </div>
    <div class="field"><label>Доп. аргументы SSH</label><input id="s-args" value="${esc(s.extraArgs || '')}" placeholder="например, -o ServerAliveInterval=60"></div>
    <div class="field"><label>Заметки</label><textarea id="s-notes" placeholder="заметки…">${esc(s.notes || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="s-submit">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);

  let auth = s.authMethod === 'password' ? 'password' : 'key';
  let color = s.color || PALETTE[0];

  $('#s-auth').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    auth = b.dataset.val;
    $$('#s-auth button').forEach((x) => x.classList.toggle('active', x === b));
    $('#s-key-wrap').hidden = auth === 'password';
    $('#s-pass-wrap').hidden = auth !== 'password';
  });
  $('#s-color').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch'); if (!sw) return;
    color = sw.dataset.color;
    $$('#s-color .swatch').forEach((x) => x.classList.toggle('active', x === sw));
  });

  $('#s-submit').addEventListener('click', async () => {
    const host = $('#s-host').value.trim();
    if (!host) return toast('Введите хост', 'error');
    const record = {
      id: s.id || 'sv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: $('#s-name').value.trim(),
      group: $('#s-group').value.trim(),
      host,
      port: $('#s-port').value || 22,
      user: $('#s-user').value.trim(),
      authMethod: auth,
      keyPath: auth === 'key' ? $('#s-key').value : '',
      password: auth === 'password' ? $('#s-pass').value : '',
      color,
      notes: $('#s-notes').value.trim(),
      extraArgs: $('#s-args').value.trim(),
      updatedAt: Date.now()
    };
    if (isEdit) {
      const idx = state.data.servers.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.data.servers[idx] = record;
    } else {
      state.data.servers.push(record);
    }
    try {
      await persist();
      closeModal();
      toast(isEdit ? 'Сервер сохранён' : 'Сервер добавлен');
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function deleteServerModal(server) {
  const m = openModal(`
    <h3>Удалить сервер?</h3>
    <p class="muted">Сервер <b>${esc(server.name || server.host)}</b> будет удалён из хранилища.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="ds-submit">Удалить</button>
    </div>
  `);
  $('#ds-submit').addEventListener('click', async () => {
    state.data.servers = state.data.servers.filter((x) => x.id !== server.id);
    await persist();
    closeModal();
    toast('Сервер удалён');
    render();
  });
}
