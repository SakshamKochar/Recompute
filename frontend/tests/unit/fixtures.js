import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Real backend responses recorded by scripts/build_demo_snapshot.py. */
export const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "public/demo/snapshot.json"), "utf8"));
export const responses = snapshot.responses;
export const meta = responses["GET /meta"];
export const assetRows = responses["GET /assets"].assets;
export const detail = (id) => responses[`GET /assets/${id}`];
export const history = (id) => responses[`GET /assets/${id}/history`];
