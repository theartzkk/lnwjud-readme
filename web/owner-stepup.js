let activePrompt = null;

// The dialog uses CSS dvh/safe-area sizing; no inline style updates (strict CSP).

function buildOwnerDialog({ title, detail, confirmLabel = 'ยืนยันและทำต่อ', danger = false, password = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'awh-owner-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = document.createElement('form');
  card.className = 'awh-owner-dialog-card';
  if (danger) card.dataset.tone = 'danger';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'awh-owner-dialog-eyebrow';
  eyebrow.textContent = password ? 'ยืนยันตัวตน' : 'ยืนยันรายการ';

  const heading = document.createElement('h2');
  heading.id = 'awh-owner-dialog-title';
  heading.textContent = title;
  overlay.setAttribute('aria-labelledby', heading.id);

  const copy = document.createElement('p');
  copy.className = 'awh-owner-dialog-copy';
  copy.textContent = detail;

  const message = document.createElement('p');
  message.className = 'awh-owner-dialog-message';
  message.setAttribute('role', 'status');

  let input = null;
  if (password) {
    const label = document.createElement('label');
    label.textContent = 'รหัสผ่าน AWH ปัจจุบัน';
    label.setAttribute('for', 'awh-owner-password');
    input = document.createElement('input');
    input.id = 'awh-owner-password';
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.required = true;
    label.append(input);
    card.append(eyebrow, heading, copy, label, message);
  } else {
    card.append(eyebrow, heading, copy, message);
  }

  const actions = document.createElement('div');
  actions.className = 'awh-owner-dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'awh-owner-dialog-cancel';
  cancel.textContent = 'ยกเลิก';
  const confirm = document.createElement('button');
  confirm.type = 'submit';
  confirm.className = 'awh-owner-dialog-confirm';
  confirm.textContent = confirmLabel;
  if (danger) confirm.dataset.tone = 'danger';
  actions.append(cancel, confirm);
  card.append(actions);
  overlay.append(card);

  return { overlay, card, input, message, cancel, confirm };
}

function openOwnerDialog(options) {
  if (activePrompt) return activePrompt;
  activePrompt = new Promise((resolve) => {
    const ui = buildOwnerDialog(options);
    const returnFocus = document.activeElement;
    const finish = (value) => {
      if (ui.input) ui.input.value = '';
      ui.overlay.remove();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
      resolve(value);
    };

    ui.cancel.addEventListener('click', () => finish(null));
    ui.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
      if (event.key !== 'Tab') return;
      const elements = [ui.input, ui.cancel, ui.confirm].filter(Boolean);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    ui.overlay.addEventListener('click', (event) => {
      if (event.target === ui.overlay) finish(null);
    });
    ui.card.addEventListener('submit', (event) => {
      event.preventDefault();
      if (options.password) {
        const value = ui.input?.value || '';
        if (!value) {
          ui.message.textContent = 'กรอกรหัสผ่าน AWH ก่อน';
          ui.input?.focus();
          return;
        }
        finish(value);
        return;
      }
      finish(true);
    });

    document.body.append(ui.overlay);
    window.setTimeout(() => (ui.input || ui.confirm).focus(), 0);
  }).finally(() => {
    activePrompt = null;
  });
  return activePrompt;
}

export async function withOwnerStepUp(action, stepUp, label = 'รายการนี้') {
  try {
    return await action();
  } catch (error) {
    if (error?.code !== 'STEP_UP_REQUIRED') throw error;
    const password = await openOwnerDialog({
      title: 'ยืนยันว่าเป็นเจ้าของ AWH',
      detail: label + ' ต้องยืนยันรหัสผ่านก่อน ระบบจะทำรายการเดิมต่อให้อัตโนมัติ',
      confirmLabel: 'ยืนยันแล้วทำต่อ',
      password: true,
    });
    if (!password) throw new Error('ยกเลิกการยืนยันตัวตน');
    await stepUp(password);
    return action();
  }
}

export async function confirmOwnerAction({
  title = 'ยืนยันรายการนี้',
  detail = 'ตรวจสอบรายการก่อนดำเนินการ',
  confirmLabel = 'ยืนยัน',
  danger = false,
} = {}) {
  const result = await openOwnerDialog({ title, detail, confirmLabel, danger, password: false });
  return result === true;
}
