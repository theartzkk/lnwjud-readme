(() => {
  const $ = (id) => document.getElementById(id);

  function clearVisitedWhenSignedOut() {
    const workspace = $('workspace-view');
    if (workspace?.hidden === true) delete document.body.dataset.awhDashboardVisited;
  }

  function hardenImageInput() {
    const input = $('dashboard-image-input');
    if (!(input instanceof HTMLInputElement) || input.dataset.awhGuarded === '1') return false;
    input.dataset.awhGuarded = '1';
    input.accept = 'image/png,image/jpeg,image/webp';
    const hint = $('dashboard-image-file');
    if (hint && !input.files?.length) hint.textContent = 'PNG, JPG หรือ WebP · GIF แบบเคลื่อนไหวยังไม่รองรับการย่อ';
    input.addEventListener('change', (event) => {
      const file = input.files?.[0];
      if (!file) return;
      const gif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
      if (!gif) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.value = '';
      const process = $('dashboard-image-process');
      if (process instanceof HTMLButtonElement) process.disabled = true;
      const preview = $('dashboard-image-preview');
      if (preview) preview.hidden = true;
      const message = $('dashboard-image-message');
      if (message) message.textContent = 'GIF แบบเคลื่อนไหวยังไม่รองรับ เพราะการแปลงด้วย Canvas จะเหลือเพียงเฟรมแรก กรุณาใช้ JPG, PNG หรือ WebP';
      if (hint) hint.textContent = 'PNG, JPG หรือ WebP · GIF แบบเคลื่อนไหวยังไม่รองรับการย่อ';
    }, { capture: true });
    return true;
  }

  function start() {
    clearVisitedWhenSignedOut();
    const workspace = $('workspace-view');
    if (workspace) new MutationObserver(clearVisitedWhenSignedOut).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
    if (hardenImageInput()) return;
    const observer = new MutationObserver(() => { if (hardenImageInput()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
