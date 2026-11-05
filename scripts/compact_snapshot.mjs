import { readFile, writeFile } from "node:fs/promises";
// Remove formatting bytes only. Every recorded response and demo value is retained.
const snapshot = new URL("../frontend/dist-build/demo/snapshot.json", import.meta.url);
await writeFile(snapshot, JSON.stringify(JSON.parse(await readFile(snapshot, "utf8"))));
