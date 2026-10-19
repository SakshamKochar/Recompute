const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (s) => (s === null || s === undefined ? "" : String(s).replace(/[&<>"']/g, (c) => ESC[c]));

export const cls = (...parts) => parts.filter(Boolean).join(" ");

export const when = (cond, html, otherwise = "") => (cond ? html : otherwise);

export const list = (items, fn, empty = "") => (items && items.length ? items.map(fn).join("") : empty);
