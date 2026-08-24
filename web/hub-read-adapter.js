const MAX_JSON_BYTES = 512 * 1024;

export function isSafeRelativePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[?#]/.test(value) && !value.split('/').includes('..') ? value : null;
}

export function browserRequestOptions() {
  return { credentials: 'same-origin', cache: 'no-store' };
}

async function readJson(path, fetchImpl = globalThis.fetch) {
  const safePath = isSafeRelativePath(path);
  if (!safePath) throw new Error('AWH path is not safe');
  const response = await fetchImpl(safePath, browserRequestOptions());
  if (!response.ok) throw new Error(`AWH is unavailable (${response.status})`);
  const body = await response.text();
  if (body.length > MAX_JSON_BYTES) throw new Error('AWH response exceeds the browser bound');
  const value = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWH response is invalid');
  return value;
}

function fallback(error = 'AWH ยังไม่พร้อมใช้งาน') {
  return {
    product: { shortName: 'AWH', name: 'Art’s Workspace Hub' },
    control: { mode: 'UNAVAILABLE', available: false, authenticated: false, error },
  };
}

function config(value) {
  if (value?.mode !== 'CONTROL') return false;
  const apiBase = isSafeRelativePath(typeof value.apiBase === 'string' ? value.apiBase.replace(/\/$/, '') : '');
  return apiBase === '/api/v1';
}

/** The web shell has one product path: authenticated Control. There is no static preview dashboard. */
export async function loadWebData(fetchImpl = globalThis.fetch) {
  try {
    const [webConfig, bootstrap] = await Promise.all([readJson('/web-config.json', fetchImpl), readJson('/data.json', fetchImpl)]);
    if (!config(webConfig)) return fallback('AWH release นี้ยังไม่พร้อมใช้งาน');
    const { loadControlData } = await import('./control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__');
    try {
      return { product: bootstrap.product || { shortName: 'AWH', name: 'Art’s Workspace Hub' }, control: { available: true, ...(await loadControlData()) } };
    } catch (error) {
      return { product: bootstrap.product || { shortName: 'AWH', name: 'Art’s Workspace Hub' }, control: { mode: 'CONTROL', available: true, authenticated: false, error: error instanceof Error ? error.message : 'กรุณาเข้าสู่ AWH' } };
    }
  } catch (error) {
    return fallback(error instanceof Error ? error.message : 'AWH ยังไม่พร้อมใช้งาน');
  }
}
