// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../functions/api/[[path]].js';
import { createHttpTransport } from '../../src/api/client.js';

const context = (path = '/health', init) => ({
  request: new Request(`https://recompute.life/api${path}`, init),
  env: { API_ORIGIN: 'https://recompute-api.onrender.com' },
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('upstream outage containment', () => {
  it('turns a provider challenge into safe JSON with a traceable Ray ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Just a moment secret-token</html>', {
      status: 429, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge', 'cf-ray': 'upstream-ray' },
    })));
    const response = await onRequest(context());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('cf-mitigated')).toBeNull();
    const json = await response.json();
    expect(json).toMatchObject({ code: 'UPSTREAM_CHALLENGE', request_id: 'upstream-ray' });
    expect(JSON.stringify(json)).not.toContain('<html>');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves Retry-After for plain rate limits and never replays a write', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '90' } })));
    const response = await onRequest(context('/recommend', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('90');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not treat an HTML loading page as healthy JSON', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Starting</html>', { headers: { 'content-type': 'text/html' } })));
    expect((await onRequest(context())).status).toBe(503);
  });
  it('keeps a deadline active while the upstream body is stalled', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async (_, { signal }) => ({ status: 200, headers: new Headers(), arrayBuffer: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) }));
    const pending = onRequest(context());
    await vi.advanceTimersByTimeAsync(20001);
    expect((await pending).status).toBe(504);
  });
});

describe('public reference cache', () => {
  function cacheFixture() {
    const stored = new Map();
    const cache = { match: vi.fn(async key => stored.get(key.url)?.clone()), put: vi.fn(async (key, response) => { stored.set(key.url, response.clone()); }) };
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model_version: '0.9' }, { headers: { vary: 'Origin, Accept-Encoding' } })));
    return cache;
  }
  it('serves repeated metadata reads from cache instead of contacting Render again', async () => {
    const cache = cacheFixture();
    expect((await onRequest(context('/meta'))).headers.get('X-Recompute-Cache')).toBe('MISS');
    expect((await onRequest(context('/meta'))).headers.get('X-Recompute-Cache')).toBe('HIT');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
  it('never caches health, fleet, authenticated or cookie-bearing requests', async () => {
    const cache = cacheFixture();
    for (const c of [context(), context('/assets'), context('/dashboard'), context('/meta', { headers: { authorization: 'Bearer test' } }), context('/meta', { headers: { cookie: 'session=test' } })]) await onRequest(c);
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('does not store errors or private upstream responses', async () => {
    const cache = cacheFixture();
    fetch.mockImplementation(async () => Response.json({ detail: 'private' }, { headers: { 'cache-control': 'private' } }));
    await onRequest(context('/meta'));
    fetch.mockImplementation(async () => Response.json({ detail: 'error' }, { status: 500 }));
    await onRequest(context('/meta'));
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('browser transport recovery', () => {
  it('does not expose raw HTML and signals the recovery coordinator once', async () => {
    const notify = vi.fn();
    const fetchImpl = vi.fn(async () => new Response('<html>challenge</html>', { status: 429, headers: { 'cf-mitigated': 'challenge', 'retry-after': '90' } }));
    const t = createHttpTransport({ fetchImpl, onUnavailable: notify });
    await expect(t.request('GET', '/assets')).rejects.toMatchObject({ kind: 'challenge', retryAfterMs: 90000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('classifies sanitized proxy challenges without rapidly retrying them', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ code: 'UPSTREAM_CHALLENGE', detail: 'Temporarily blocked', request_id: 'ray' }, { status: 503 }));
    const t = createHttpTransport({ fetchImpl });
    await expect(t.request('GET', '/assets')).rejects.toMatchObject({ kind: 'challenge', requestId: 'ray' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not send an already-cancelled request', async () => {
    const fetchImpl = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(createHttpTransport({ fetchImpl }).request('GET', '/assets', { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('times out while reading a response body, not only while waiting for headers', async () => {
    vi.useFakeTimers();
    const fetchImpl = async (_, { signal }) => ({ ok: true, headers: new Headers(), text: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) });
    const pending = createHttpTransport({ fetchImpl }).request('GET', '/assets', { timeout: 100, retries: 0 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ kind: 'timeout' });
  });
});

it('honors a long Retry-After without performing rapid retries', async () => {
  const notify = vi.fn();
  const fetchImpl = vi.fn(async () => Response.json({ detail: 'Starting' }, { status: 503, headers: { 'Retry-After': '60' } }));
  await expect(createHttpTransport({ fetchImpl, onUnavailable: notify }).request('GET', '/dashboard')).rejects.toMatchObject({ retryAfterMs: 60000 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
});
