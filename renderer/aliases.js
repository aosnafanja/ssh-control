'use strict';

function renderAliases() {
  const q = state.searchAliases.toLowerCase();
  const list = state.aliases.filter((a) => {
    const hay = (a.name + ' ' + a.hostName + ' ' + a.user + ' ' + a.identityFile).toLowerCase();
    return !q || hay.includes(q);
  });

  if (!list.length) {
    $('#aliases-list').innerHTML = emptyState(
      q ? 'Ничего не найдено' : 'Псевдонимов нет',
      q ? 'Измените запрос.' : 'Создайте псевдоним — и подключайтесь командой ssh alias.'
    );
    return;
  }

  $('#aliases-list').innerHTML = `<div class="alias-list">${list.map(aliasCard).join('')}</div>`;
}

function aliasCard(a) {
  const target = (a.user ? a.user + '@' : '') + (a.hostName || '—') + ((a.port && String(a.port) !== '22') ? ':' + a.port : '');
  return `
    <div class="card alias-card" data-alias="${esc(a.name)}">
      <div class="alias-main">
        <div class="alias-glyph">${ICONS.terminal}</div>
        <div class="alias-info">
          <div class="alias-name-row">
            <span class="alias-name mono">${esc(a.name)}</span>
            ${a.hostName ? `<span class="alias-target mono">${esc(target)}</span>` : ''}
          </div>
          <div class="alias-sub">
            ${a.identityFile ? `<span class="badge">🔑 ${esc(keyLabel(a.identityFile))}</span>` : ''}
            ${a.extraCount ? `<span class="badge">+${a.extraCount} доп. опций</span>` : ''}
          </div>
        </div>
        <div class="alias-actions">
          <button class="btn ghost" data-action="alias-copy-cmd" data-alias="${esc(a.name)}">${ICONS.copy} <span class="mono">ssh ${esc(a.name)}</span></button>
          <button class="icon-btn" data-action="alias-edit" data-alias="${esc(a.name)}" title="Редактировать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="alias-delete" data-alias="${esc(a.name)}" title="Удалить">${ICONS.trash}</button>
          <button class="btn primary" data-action="alias-connect" data-alias="${esc(a.name)}">${ICONS.terminal} Подключиться</button>
        </div>
      </div>
    </div>`;
}

function aliasModal(alias) {
  const isEdit = !!alias;
  const a = alias || { name: '', hostName: '', user: '', port: '', identityFile: '', extra: '' };
  const keyOptions = state.keys.map((k) =>
    `<option value="~/.ssh/${esc(k.name)}" ${a.identityFile === '~/.ssh/' + k.name ? 'selected' : ''}>${esc(k.name)}</option>`
  ).join('');

  const m = openModal(`
    <h3>${isEdit ? 'Редактировать псевдоним' : 'Новый псевдоним'}</h3>
    <div class="field"><label>Псевдоним</label><input id="al-name" value="${esc(a.name)}" placeholder="main-server"><p class="hint">Команда подключения: <span class="mono">ssh ${esc(a.name) || 'alias'}</span></p></div>
    <div class="field"><label>Адрес (HostName)</label><input id="al-host" value="${esc(a.hostName)}" placeholder="1.2.3.4 или example.com"></div>
    <div class="field-row">
      <div class="field"><label>Пользователь</label><input id="al-user" value="${esc(a.user)}" placeholder="root"></div>
      <div class="field"><label>Порт</label><input id="al-port" type="number" value="${esc(a.port)}" placeholder="22"></div>
    </div>
    <div class="field"><label>SSH-ключ (IdentityFile)</label>
      <select id="al-key">
        <option value="">— не выбран —</option>
        ${keyOptions}
      </select>
    </div>
    <div class="field"><label>Доп. опции (по строке)</label><textarea id="al-extra" placeholder="ProxyJump jump-host\nLocalForward 8080 127.0.0.1:8080">${esc(a.extra || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="al-submit">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);

  $('#al-submit').addEventListener('click', async () => {
    const name = $('#al-name').value.trim();
    if (!name) return toast('Введите псевдоним', 'error');
    try {
      await bridge.saveHost({
        name,
        hostName: $('#al-host').value.trim(),
        user: $('#al-user').value.trim(),
        port: $('#al-port').value.trim(),
        identityFile: $('#al-key').value,
        extra: $('#al-extra').value
      });
      closeModal();
      toast(isEdit ? 'Псевдоним сохранён' : 'Псевдоним добавлен');
      await refreshAliases();
      render();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}

function deleteAliasModal(alias) {
  const m = openModal(`
    <h3>Удалить псевдоним?</h3>
    <p class="muted">Запись <b>${esc(alias.name)}</b> будет удалена из <span class="mono">~/.ssh/config</span>.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="al-del-submit">Удалить</button>
    </div>
  `);
  $('#al-del-submit').addEventListener('click', async () => {
    try {
      await bridge.deleteHost(alias.name);
      closeModal();
      toast('Псевдоним удалён');
      await refreshAliases();
      render();
    } catch (err) { toast(err.message || 'Ошибка', 'error'); }
  });
}
