// Read-only deployment smoke check. Fails if a "200" contains HTML or wrong JSON.
const base = process.argv[2] || 'https://recompute.life';
const checks = [
  ['/health', body => body.ok === true],
  ['/dashboard', body => Number.isInteger(body.total_assets)],
  ['/assets', body => Array.isArray(body.assets)],
];
let failed = false;
for (const [path, valid] of checks) {
  const started = performance.now();
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api${path}`, { signal: AbortSignal.timeout(25000) });
    const json = /application\/json/i.test(res.headers.get('content-type') || '');
    const body = json ? await res.json() : null;
    const ok = res.ok && json && valid(body);
    console.log(JSON.stringify({ path, ok, status: res.status, ms: Math.round(performance.now() - started),
      challenge: res.headers.get('cf-mitigated') === 'challenge' || body?.code === 'UPSTREAM_CHALLENGE',
      code: body?.code || null, ray: res.headers.get('x-upstream-ray') || res.headers.get('cf-ray') }));
    if (!ok) failed = true;
  } catch (error) {
    failed = true; console.log(JSON.stringify({ path, ok: false, error: error.name, ms: Math.round(performance.now() - started) }));
  }
}
if (failed) process.exitCode = 1;
