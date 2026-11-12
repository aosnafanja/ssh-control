'use strict';

function renderSettings() {
  $('#settings-datadir').textContent = $('#data-dir').title || $('#settings-datadir').textContent;
  $$('#theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (state.data.settings.theme || 'system')));

  const pwTitle = $('#pw-title');
  const pwDesc = $('#pw-desc');
  const pwActions = $('#pw-actions');
  if (state.encrypted) {
    pwTitle.textContent = 'Пароль установлен';
    pwDesc.textContent = 'Хранилище зашифровано (AES-256-GCM).';
    pwActions.innerHTML = `
      <button class="btn ghost" data-action="change-password">Изменить</button>
      <button class="btn ghost" data-action="remove-password">Убрать</button>`;
  } else {
    pwTitle.textContent = 'Пароль не установлен';
    pwDesc.textContent = 'Серверы и секреты хранятся в открытом виде.';
    pwActions.innerHTML = `<button class="btn ghost" data-action="set-password">Установить пароль</button>`;
  }
}

function masterPasswordModal() {
  const m = openModal(`
    <h3>Установить пароль</h3>
    <p class="muted">Пароль будет шифровать всё хранилище. Без него данные восстановить невозможно.</p>
    <div class="field"><label>Новый пароль</label><input type="password" id="pw-new" placeholder="минимум 6 символов"></div>
    <div class="field"><label>Повторите пароль</label><input type="password" id="pw-new2"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="pw-submit">Установить</button>
    </div>
  `);
  $('#pw-submit').addEventListener('click', async () => {
    const p1 = $('#pw-new').value, p2 = $('#pw-new2').value;
    if (p1.length < 6) return toast('Пароль слишком короткий', 'error');
    if (p1 !== p2) return toast('Пароли не совпадают', 'error');
    try {
      await bridge.setMasterPassword({ current: '', next: p1 });
      state.encrypted = true;
      closeModal();
      toast('Пароль установлен');
      renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function changePasswordModal() {
  const m = openModal(`
    <h3>Изменить пароль</h3>
    <div class="field"><label>Текущий пароль</label><input type="password" id="pc-cur"></div>
    <div class="field"><label>Новый пароль</label><input type="password" id="pc-new" placeholder="минимум 6 символов"></div>
    <div class="field"><label>Повторите новый пароль</label><input type="password" id="pc-new2"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn primary" id="pc-submit">Изменить</button>
    </div>
  `);
  $('#pc-submit').addEventListener('click', async () => {
    const cur = $('#pc-cur').value, p1 = $('#pc-new').value, p2 = $('#pc-new2').value;
    if (p1.length < 6) return toast('Пароль слишком короткий', 'error');
    if (p1 !== p2) return toast('Пароли не совпадают', 'error');
    try {
      await bridge.setMasterPassword({ current: cur, next: p1 });
      state.encrypted = true;
      closeModal(); toast('Пароль изменён'); renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function removePasswordModal() {
  const m = openModal(`
    <h3>Убрать пароль</h3>
    <p class="muted">Хранилище будет сохранено без шифрования.</p>
    <div class="field"><label>Текущий пароль</label><input type="password" id="pr-cur"></div>
    <div class="modal-actions">
      <button class="btn" data-action="modal-close">Отмена</button>
      <button class="btn danger" id="pr-submit">Убрать пароль</button>
    </div>
  `);
  $('#pr-submit').addEventListener('click', async () => {
    try {
      await bridge.setMasterPassword({ current: $('#pr-cur').value, next: '' });
      state.encrypted = false;
      closeModal(); toast('Пароль убран'); renderSettings();
    } catch (err) { toast(err.message, 'error'); }
  });
}
