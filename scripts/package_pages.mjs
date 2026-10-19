import { readFile, writeFile } from 'node:fs/promises';

// Dashboard uploads support advanced-mode workers, not a functions/ source folder.
const proxy = await readFile(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
const worker = proxy + `\nexport default {\n  async fetch(request, env) {\n    const path = new URL(request.url).pathname;\n    if (path === '/api' || path.startsWith('/api/')) return onRequest({request, env});\n    return env.ASSETS.fetch(request);\n  }\n};\n`;
await writeFile(new URL('../frontend/dist-build/_worker.js', import.meta.url), worker);
