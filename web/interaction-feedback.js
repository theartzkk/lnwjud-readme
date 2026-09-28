/* KRUART Premium Interaction Feedback v1 */
(() => {
  'use strict';
  if (window.KruartInteractionFeedback) return;

  const root = document.documentElement;
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const busyCounts = new WeakMap();
  let lastInteraction = { element: null, at: -Infinity };
  let activeRequests = 0;
  let visibleSince = 0;
  let revealTimer = 0;
  let statusTimer = 0;
  let longTimer = 0;
  let navigationTimer = 0;
  let manualSequence = 0;
  const manualTokens = new Map();

  function interactiveElement(target) {
    return target instanceof Element
      ? target.closest('button,a,[role="button"],input[type="submit"],input[type="button"]')
      : null;
  }

  function usable(element) {
    return element instanceof HTMLElement && !element.matches(':disabled,[aria-disabled="true"]');
  }

  function ensureChrome() {
    if (!document.body) return {};
    let progress = document.getElementById('kruart-ui-progress');
    let status = document.getElementById('kruart-ui-status');
    if (!progress) {
      progress = document.createElement('div');
      progress.id = 'kruart-ui-progress';
      progress.className = 'kruart-ui-progress';
      progress.setAttribute('aria-hidden', 'true');
      progress.innerHTML = '<span></span>';
      document.body.append(progress);
    }
    if (!status) {
      status = document.createElement('div');
      status.id = 'kruart-ui-status';
      status.className = 'kruart-ui-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.innerHTML = '<i class="kruart-ui-spinner" aria-hidden="true"></i><span>กำลังดำเนินการ…</span>';
      document.body.append(status);
    }
    return { progress, status };
  }

  function pulse(element) {
    if (!usable(element)) return;
    lastInteraction = { element, at: performance.now() };
    element.classList.remove('kruart-ui-pressed');
    void element.offsetWidth;
    element.classList.add('kruart-ui-pressed');
    window.setTimeout(() => element.classList.remove('kruart-ui-pressed'), 150);
  }

  function setBusy(element, active) {
    if (!usable(element)) return;
    const count = Math.max(0, (busyCounts.get(element) || 0) + (active ? 1 : -1));
    busyCounts.set(element, count);
    if (count > 0) {
      element.dataset.uiBusy = 'true';
      element.setAttribute('aria-busy', 'true');
    } else {
      delete element.dataset.uiBusy;
      element.removeAttribute('aria-busy');
    }
  }

  function reveal(label = 'กำลังดำเนินการ…') {
    window.clearTimeout(revealTimer);
    window.clearTimeout(statusTimer);
    window.clearTimeout(longTimer);
    revealTimer = window.setTimeout(() => {
      const { status } = ensureChrome();
      root.dataset.uiLoading = 'true';
      visibleSince = performance.now();
      statusTimer = window.setTimeout(() => {
        if (!root.dataset.uiLoading) return;
        status?.querySelector('span')?.replaceChildren(label);
        root.dataset.uiStatus = 'true';
      }, 420);
      longTimer = window.setTimeout(() => {
        if (!root.dataset.uiLoading) return;
        status?.querySelector('span')?.replaceChildren('ยังทำงานอยู่…');
      }, 1800);
    }, 140);
  }

  function conceal(force = false) {
    window.clearTimeout(revealTimer);
    window.clearTimeout(statusTimer);
    window.clearTimeout(longTimer);
    const elapsed = performance.now() - visibleSince;
    const wait = force || !root.dataset.uiLoading ? 0 : Math.max(0, 240 - elapsed);
    window.setTimeout(() => {
      delete root.dataset.uiLoading;
      delete root.dataset.uiStatus;
      const status = document.getElementById('kruart-ui-status');
      status?.querySelector('span')?.replaceChildren('กำลังดำเนินการ…');
    }, wait);
  }

  function beginRequest(element) {
    activeRequests += 1;
    setBusy(element, true);
    if (activeRequests === 1) reveal('กำลังโหลด…');
  }

  function endRequest(element) {
    setBusy(element, false);
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0 && manualTokens.size === 0 && root.dataset.uiNavigating !== 'true') conceal();
  }

  function consumeRecentUserAction() {
    const delta = performance.now() - lastInteraction.at;
    if (delta < 0 || delta >= 500) return null;
    const element = lastInteraction.element;
    lastInteraction = { element: null, at: -Infinity };
    return usable(element) ? element : null;
  }

  if (nativeFetch) {
    window.fetch = async (...args) => {
      const element = consumeRecentUserAction();
      const tracked = usable(element);
      if (tracked) beginRequest(element);
      try {
        return await nativeFetch(...args);
      } finally {
        if (tracked) endRequest(element);
      }
    };
  }

  function sameDocumentHash(anchor) {
    try {
      const url = new URL(anchor.href, location.href);
      return url.origin === location.origin
        && url.pathname === location.pathname
        && url.search === location.search
        && url.hash
        && url.hash !== location.hash;
    } catch {
      return false;
    }
  }

  function startNavigation(label = 'กำลังเปิด…') {
    window.clearTimeout(navigationTimer);
    root.dataset.uiNavigating = 'true';
    reveal(label);
    navigationTimer = window.setTimeout(() => {
      if (root.dataset.uiNavigating === 'true') {
        const status = ensureChrome().status;
        status?.querySelector('span')?.replaceChildren('กำลังเปิดหน้าใหม่…');
      }
    }, 1600);
  }

  function resetNavigation() {
    window.clearTimeout(navigationTimer);
    delete root.dataset.uiNavigating;
    if (activeRequests === 0 && manualTokens.size === 0) conceal(true);
  }

  document.addEventListener('pointerdown', event => {
    const element = interactiveElement(event.target);
    if (usable(element)) pulse(element);
  }, { capture: true, passive: true });

  document.addEventListener('click', event => {
    const element = interactiveElement(event.target);
    if (usable(element) && performance.now() - lastInteraction.at > 220) pulse(element);
    if (!(element instanceof HTMLAnchorElement) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (element.target === '_blank' || element.hasAttribute('download') || sameDocumentHash(element)) return;
    const href = element.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    startNavigation('กำลังเปิด…');
    window.setTimeout(() => { if (event.defaultPrevented) resetNavigation(); }, 0);
  }, true);

  document.addEventListener('submit', event => {
    const element = usable(event.submitter) ? event.submitter : event.target;
    if (element instanceof HTMLElement) pulse(element);
    window.setTimeout(() => {
      if (!event.defaultPrevented) startNavigation('กำลังส่งข้อมูล…');
    }, 0);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = interactiveElement(event.target);
    if (usable(element)) pulse(element);
  }, true);

  window.addEventListener('pageshow', resetNavigation);
  window.addEventListener('pagehide', () => {
    window.clearTimeout(revealTimer);
    window.clearTimeout(statusTimer);
    window.clearTimeout(longTimer);
  });

  window.KruartInteractionFeedback = Object.freeze({
    begin(label = 'กำลังดำเนินการ…', element = null) {
      const token = ++manualSequence;
      manualTokens.set(token, element);
      setBusy(element, true);
      reveal(label);
      return token;
    },
    end(token) {
      if (!manualTokens.has(token)) return;
      const element = manualTokens.get(token);
      manualTokens.delete(token);
      setBusy(element, false);
      if (manualTokens.size === 0 && activeRequests === 0 && root.dataset.uiNavigating !== 'true') conceal();
    },
    navigation: startNavigation,
    reset: resetNavigation,
  });
})();
