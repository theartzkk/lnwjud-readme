const SURFACES = new Set(['home', 'work', 'tasks', 'files']);
const previousFocus = new WeakMap();
const surfaceListeners = new Set();
let overlayScrollY = null;

function hasDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isViewportWidthBounded(root = hasDom() ? document.documentElement : null) {
  const clientWidth = Number(root?.clientWidth);
  const scrollWidth = Number(root?.scrollWidth);
  return Number.isFinite(clientWidth) && clientWidth > 0 && Number.isFinite(scrollWidth) && scrollWidth <= clientWidth;
}

function isElement(value) {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

function historyState() {
  return hasDom() && window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
}

function visibleDialogs() {
  if (!hasDom()) return [];
  return [...document.querySelectorAll('[data-awh-dialog-open="1"]:not([hidden])')].filter(isElement);
}

function syncOverlayState() {
  if (!hasDom()) return;
  const open = visibleDialogs().length > 0;
  if (open && !document.body.classList.contains('awh-overlay-open')) {
    overlayScrollY = Math.max(0, window.scrollY || 0);
  }
  document.body.classList.toggle('awh-overlay-open', open);
  if (!open && overlayScrollY !== null) {
    const restoreY = overlayScrollY;
    overlayScrollY = null;
    window.requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: 'auto' }));
  }
}

function focusable(dialog) {
  if (!isElement(dialog)) return [];
  return [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => isElement(node) && !node.hidden && node.getAttribute('aria-hidden') !== 'true');
}

function restoreFocus(dialog) {
  const target = previousFocus.get(dialog);
  previousFocus.delete(dialog);
  if (isElement(target) && target.isConnected) target.focus({ preventScroll: true });
}

export function openAwhDialog(dialog, options = {}) {
  if (!isElement(dialog) || !hasDom()) return false;
  if (dialog.dataset.awhDialogOpen !== '1') previousFocus.set(dialog, document.activeElement);
  dialog.hidden = false;
  dialog.dataset.awhDialogOpen = '1';
  syncOverlayState();

  if (options.history !== false && dialog.id && historyState().awhDialogId !== dialog.id) {
    const current = { ...historyState(), awhScrollY: Math.max(0, window.scrollY || overlayScrollY || 0) };
    window.history.replaceState(current, '', window.location.href);
    window.history.pushState({ ...current, awhDialogId: dialog.id }, '', window.location.href);
  }
  window.requestAnimationFrame(() => {
    const target = focusable(dialog)[0] || dialog;
    if (isElement(target)) {
      if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
  return true;
}

export function closeAwhDialog(dialog, options = {}) {
  if (!isElement(dialog) || !hasDom()) return false;
  const ownsHistory = dialog.id && historyState().awhDialogId === dialog.id;
  dialog.hidden = true;
  delete dialog.dataset.awhDialogOpen;
  syncOverlayState();
  restoreFocus(dialog);
  if (ownsHistory && options.history === false) {
    const next = { ...historyState() };
    delete next.awhDialogId;
    window.history.replaceState(next, '', window.location.href);
  }
  if (ownsHistory && options.history !== false && options.fromHistory !== true) window.history.back();
  return true;
}

export function commitAwhSurface(surface, options = {}) {
  if (!hasDom() || !SURFACES.has(surface)) return false;
  const current = historyState();
  const replace = options.replace === true || current.awhSurface === surface;
  if (!replace && SURFACES.has(current.awhSurface)) {
    window.history.replaceState({ ...current, awhScrollY: Math.max(0, window.scrollY || 0) }, '', window.location.href);
  }
  const next = { ...historyState(), awhSurface: surface, awhScrollY: Math.max(0, Number(options.scrollY) || 0) };
  delete next.awhDialogId;
  if (replace) window.history.replaceState(next, '', window.location.href);
  else window.history.pushState(next, '', window.location.href);
  return true;
}

export function onAwhSurfaceChange(listener) {
  if (typeof listener !== 'function') return () => undefined;
  surfaceListeners.add(listener);
  return () => surfaceListeners.delete(listener);
}

export function installAwhBackNavigation(root = hasDom() ? document : null) {
  if (!root?.querySelectorAll || !hasDom()) return;
  for (const link of root.querySelectorAll('[data-awh-back]')) {
    if (!(link instanceof HTMLAnchorElement) || link.dataset.awhBackBound === '1') continue;
    link.dataset.awhBackBound = '1';
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let sameOriginReferrer = false;
      try { sameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin; } catch { sameOriginReferrer = false; }
      if (!sameOriginReferrer || window.history.length <= 1) return;
      event.preventDefault();
      window.history.back();
    });
  }
}

function handlePopState(event) {
  if (!hasDom()) return;
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  for (const dialog of visibleDialogs().reverse()) {
    if (dialog.id !== state.awhDialogId) closeAwhDialog(dialog, { fromHistory: true, history: false });
  }
  if (SURFACES.has(state.awhSurface)) {
    for (const listener of surfaceListeners) listener(state.awhSurface, state);
  }
}

function handleDialogKeyboard(event) {
  const dialogs = visibleDialogs();
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAwhDialog(dialog);
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusable(dialog);
  if (!items.length) { event.preventDefault(); dialog.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

if (hasDom()) {
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('keydown', handleDialogKeyboard);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installAwhBackNavigation(), { once: true });
  else installAwhBackNavigation();
}
