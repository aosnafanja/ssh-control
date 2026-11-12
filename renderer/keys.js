'use strict';

function renderKeys() {
  const q = state.searchKeys.toLowerCase();
  const list = state.keys.filter((k) => {
    const hay = (k.name + ' ' + k.comment + ' ' + k.type + ' ' + k.fingerprint).toLowerCase();
    return !q || hay.includes(q);
  });

  if (!list.length) {
    $('#keys-list').innerHTML = emptyState(
      q ? 'Ничего не найдено' : 'Ключей пока нет',
      q ? 'Попробуйте другой запрос.' : 'Создайте новый ключ или положите существующий в ~/.ssh.'
    );
    return;
  }

  $('#keys-list').innerHTML = `<div class="key-list">${list.map(keyCard).join('')}</div>`;
}

function keyCard(k) {
  const meta = (state.data.keyMeta || {})[k.name] || {};
  const displayName = meta.alias || k.name;
  return `
    <div class="card key-card" data-action="key-toggle" data-name="${esc(k.name)}">
      <div class="key-head">
        <div class="key-glyph">${ICONS.key}</div>
        <div class="key-main">
          <div class="key-name-row">
            <span class="key-name">${esc(displayName)}</span>
            ${k.type ? `<span class="badge type">${esc(k.type.toUpperCase())}</span>` : ''}
            ${k.bits ? `<span class="badge">${esc(k.bits)} бит</span>` : ''}
            ${meta.alias ? `<span class="badge">${esc(k.name)}</span>` : ''}
          </div>
          <div class="key-sub">
            ${k.comment ? `<span>${esc(k.comment)}</span>` : ''}
            ${k.fingerprint ? `<span class="key-fp" title="${esc(k.fingerprint)}">${esc(k.fingerprint)}</span>` : ''}
          </div>
        </div>
        <div class="key-actions" data-stop="1">
          <button class="icon-btn" data-action="key-copy-pub" data-name="${esc(k.name)}" title="Скопировать публичный ключ">${ICONS.copy}</button>
          <button class="icon-btn" data-action="key-reveal" data-name="${esc(k.name)}" title="Показать в Finder">${ICONS.folder}</button>
          <button class="icon-btn" data-action="key-rename" data-name="${esc(k.name)}" title="Переименовать">${ICONS.pencil}</button>
          <button class="icon-btn danger" data-action="key-delete" data-name="${esc(k.name)}" title="Удалить">${ICONS.trash}</button>
          <button class="icon-btn" title="Подробнее">${ICONS.chevron}</button>
        </div>
      </div>
      <div class="key-detail">
        ${k.fingerprint ? `
        <div class="detail-row">
          <div class="detail-label">Отпечаток (SHA256)</div>
          <div class="detail-value">${esc(k.fingerprint)}</div>
        </div>` : ''}
        ${k.pub ? `
        <div class="detail-row">
          <div class="detail-label">Публичный ключ</div>
          <div class="detail-value">${esc(k.pub)}</div>
        </div>` : ''}
        <div class="detail-actions">
          ${k.pub ? `<button class="btn ghost" data-action="key-copy-pub" data-name="${esc(k.name)}">${ICONS.copy} Скопировать публичный ключ</button>` : ''}
          ${k.fingerprint ? `<button class="btn ghost" data-action="key-copy-fp" data-name="${esc(k.name)}">${ICONS.copy} Скопировать отпечаток</button>` : ''}
        </div>
      </div>
    </div>`;
}

function createKeyModal() {
  const m = openModal(`
    <h3>Новый SSH-ключ</h3>
    <div class="field"><label>Имя ключа</label><input id="mk-name" placeholder="production_ed25519"></div>
    <div class="field">
      <label>Тип ключа</label>
      <div class="segmented" id="mk-type">
        <button data-val="ed25519" class="active">Ed25519</button>
        <button data-val="rsa">RSA</button>
        <button data-val="ecdsa">ECDSA</button>
      </div>
    </div>
    <div class="field" id="mk-bits-wrap" hidden>
      <label>Размер ключа</label>
      <select id="mk-bits"></select>
    </div>
    <div class="field"><label>Комментарий</label><input id="mk-comment" placeholder="user@host (необязательно)"></div>
    <div class="field"><label>Парольная фраза</label><input type="password" id="mk-pass" placeholder="необязательно"></div>
    <div class="field"><label>Повторите фразу</label><input type="password" id="mk-pass2" placeholder="ещё раз"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="mk-submit">Создать</button>
    </div>
  `);

  let type = 'ed25519';
  const setBitsOptions = () => {
    const sel = $('#mk-bits');
    if (type === 'ecdsa') sel.innerHTML = '<option value="256">256 бит</option><option value="384">384 бит</option><option value="521">521 бит</option>';
    else sel.innerHTML = '<option value="2048">2048 бит</option><option value="4096">4096 бит</option>';
  };
  $('#mk-type').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    type = b.dataset.val;
    $$('#mk-type button').forEach((x) => x.classList.toggle('active', x === b));
    $('#mk-bits-wrap').hidden = type === 'ed25519';
    setBitsOptions();
  });

  $('#mk-submit').addEventListener('click', async () => {
    const name = $('#mk-name').value.trim();
    const pass = $('#mk-pass').value;
    const pass2 = $('#mk-pass2').value;
    if (!name) return toast('Введите имя ключа', 'error');
    if (pass !== pass2) return toast('Парольные фразы не совпадают', 'error');
    try {
      await bridge.createKey({ name, type, bits: $('#mk-bits').value, comment: $('#mk-comment').value.trim(), passphrase: pass });
      closeModal();
      toast('Ключ создан');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function renameKeyModal(key) {
  const m = openModal(`
    <h3>Переименовать ключ</h3>
    <div class="field"><label>Текущее имя</label><div class="mono path">${esc(key.name)}</div></div>
    <div class="field"><label>Новое имя</label><input id="rk-name" value="${esc(key.name)}"></div>
    <div class="field"><p class="hint">Будут переименованы файлы ключа и <span class="mono">.pub</span>, а ссылки в <span class="mono">~/.ssh/config</span> обновлены.</p></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="rk-submit">Переименовать</button>
    </div>
  `);
  $('#rk-submit').addEventListener('click', async () => {
    const newName = $('#rk-name').value.trim();
    if (!newName) return toast('Введите новое имя', 'error');
    if (newName === key.name) return closeModal();
    try {
      await bridge.renameKey({ name: key.name, newName });
      // обновить ссылки в серверах
      const oldPath = '~/.ssh/' + key.name;
      const newPath = '~/.ssh/' + newName;
      let changed = false;
      state.data.servers.forEach((s) => {
        if (s.keyPath === oldPath) { s.keyPath = newPath; changed = true; }
      });
      if (changed) await persist();
      closeModal();
      toast('Ключ переименован');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}

function deleteKeyModal(key) {
  const m = openModal(`
    <h3>Удалить ключ?</h3>
    <p class="muted">Ключ <b>${esc(key.name)}</b> будет перемещён в Корзину. Это действие нельзя отменить.</p>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="dk-submit">Удалить</button>
    </div>
  `);
  $('#dk-submit').addEventListener('click', async () => {
    try {
      await bridge.deleteKey(key.name);
      closeModal();
      toast('Ключ перемещён в Корзину');
      await refreshKeys();
      render();
    } catch (err) {
      toast(err.message || 'Ошибка', 'error');
    }
  });
}
