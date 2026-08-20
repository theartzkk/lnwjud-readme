import { loadWebData } from './hub-read-adapter.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value == null ? '—' : String(value); };

  function render(data) {
    text('product-name', data.product.name);
    text('product-tagline', data.product.tagline);
    text('preview-label', data.preview.label);
    text('hub-status', data.hub.status);
    text('hub-summary', data.hub.summary);
    text('project-name', data.project.name);
    text('project-type', data.project.type);
    text('project-id', `Project ID · ${data.project.projectId}`);
    text('milestone', data.project.milestone);
    text('handoff-summary', data.project.handoffSummary);
    text('memory-ready', Object.values(data.project.memory).every((state) => state === 'present') ? 'READY' : 'PARTIAL');
    $('memory-ready').className = `status-pill ${Object.values(data.project.memory).every((state) => state === 'present') ? 'success' : 'warning'}`;
    const memory = $('memory-list');
    memory.replaceChildren();
    for (const [file, state] of Object.entries(data.project.memory)) {
      const item = document.createElement('li');
      const name = document.createElement('span'); name.textContent = file;
      const badge = document.createElement('span'); badge.textContent = state === 'present' ? 'Present' : 'Missing'; badge.className = `file-state ${state}`;
      item.append(name, badge); memory.append(item);
    }
    text('device-status', data.devices.status);
    text('device-summary', data.devices.summary);
    text('build-status', data.builds.status);
    text('build-summary', data.builds.summary);
    text('audit-status', data.audit.status);
    text('audit-summary', data.audit.summary);
  }

  loadWebData()
    .then(render)
    .catch((error) => { text('hub-status', 'Preview unavailable'); text('hub-summary', error.message); });
})();
