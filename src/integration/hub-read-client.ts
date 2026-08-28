export type HubReadRoute = 'status' | 'projects' | 'devices' | 'builds' | 'releases';

export interface HubReadCredentialProvider {
  /** Return a short-lived or otherwise protected bearer credential. Never expose it to the model/tool payload. */
  getAccessToken(): Promise<string>;
}

export interface HubReadClientOptions {
  baseUrl: string;
  credentials: HubReadCredentialProvider;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

const ROUTES: Readonly<Record<HubReadRoute, string>> = Object.freeze({
  status: '/api/v1/status',
  projects: '/api/v1/projects',
  devices: '/api/v1/devices',
  builds: '/api/v1/builds',
  releases: '/api/v1/releases',
});

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

/**
 * Small, explicit read-only adapter for the existing Hub read authority.
 *
 * Security properties:
 * - no arbitrary paths or methods;
 * - HTTPS required except loopback development;
 * - redirects rejected (avoids bearer forwarding to a different origin);
 * - streamed response-size enforcement plus timeout;
 * - bearer token injected internally and never returned in tool output.
 *
 * This does not make the current global Hub read token suitable for multi-user
 * Plugin access. A principal-scoped credential provider is still required
 * before these routes are enabled for external users.
 */
export class HubReadClient {
  private readonly baseUrl: URL;
  private readonly credentials: HubReadCredentialProvider;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HubReadClientOptions) {
    this.baseUrl = normalizeAndValidateBaseUrl(options.baseUrl);
    this.credentials = options.credentials;
    this.timeoutMs = boundedPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250, 30_000, 'timeoutMs');
    this.maxResponseBytes = boundedPositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      5_000_000,
      'maxResponseBytes',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(route: HubReadRoute): Promise<unknown> {
    const path = ROUTES[route];
    const url = new URL(path, this.baseUrl);
    assertSameOrigin(this.baseUrl, url);

    const token = (await this.credentials.getAccessToken()).trim();
    if (token.length < 16 || token.length > 8_192 || /[\r\n]/.test(token)) {
      throw new Error('Hub read credential is invalid');
    }

    const response = await this.fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      // Do not include body text: it may contain operational or authentication details.
      throw new Error(`Hub read request failed with HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error('Hub read response is not JSON');
    }

    const declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== null && declaredLength > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Hub read response exceeds size limit');
    }

    const body = await readBoundedBody(response, this.maxResponseBytes);

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('Hub read response contains invalid JSON');
    }
  }
}

export function hubReadRoutePath(route: HubReadRoute): string {
  return ROUTES[route];
}

function normalizeAndValidateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Hub base URL is invalid');
  }

  if (url.username || url.password) throw new Error('Hub base URL must not contain credentials');
  if (url.search || url.hash) throw new Error('Hub base URL must not contain query or fragment');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Hub base URL must not contain a path');

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Hub base URL must use HTTPS outside loopback development');
  }

  url.pathname = '/';
  return url;
}

function assertSameOrigin(base: URL, target: URL): void {
  if (base.origin !== target.origin) throw new Error('Hub read route escaped configured origin');
}

function parseContentLength(value: string | null): number | null {
  if (value === null || value === '') return null;
  if (!/^[0-9]+$/.test(value)) throw new Error('Hub read response has invalid content length');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Hub read response has invalid content length');
  return parsed;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Hub read response exceeds size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8');
}

function boundedPositiveInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
