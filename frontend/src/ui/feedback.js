import { esc } from "../lib/html.js";

let toastTimer;

export function toast(message, { action = null, duration = 3600 } = {}) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.innerHTML = `${esc(message)}${action ? ` <button type="button" id="toast-action">${esc(action.label)}</button>` : ""}`;
  el.classList.add("show");
  clearTimeout(toastTimer);
  if (action) {
    el.querySelector("#toast-action").onclick = () => {
      el.classList.remove("show");
      action.run();
    };
  }
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 8000 : duration);
}

/**
 * Open the shared <dialog>. `render` returns inner HTML; `bind(dialog, close)` wires it.
 * Focus returns to the element that opened it when it closes.
 */
export function openDialog({ label, html, bind, wide = false }) {
  const dialog = document.querySelector("#dialog");
  const opener = document.activeElement;
  dialog.className = wide ? "rc-dialog wide" : "rc-dialog";
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = html;
  const close = () => dialog.open && dialog.close();
  dialog.onclose = () => {
    dialog.innerHTML = "";
    if (opener && document.contains(opener)) opener.focus();
  };
  dialog.onclick = (e) => {
    if (e.target.closest("[data-close]")) close();
  };
  dialog.showModal();
  bind?.(dialog, close);
  const first = dialog.querySelector("[autofocus], textarea, input, select, button:not([data-close])");
  first?.focus();
  return { dialog, close };
}

/** Promise-based confirmation. When `requireNote` is set, the user must write a non-blank note. */
export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", requireNote = false, noteLabel = "Note", notePlaceholder = "", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const { dialog } = openDialog({
      label: title,
      html: `<form method="dialog" class="confirm-form" novalidate>
        <div class="row"><h2>${esc(title)}</h2><button type="button" class="close" data-close aria-label="Close">×</button></div>
        <div class="confirm-body">${body}</div>
        ${
          requireNote
            ? `<label for="confirm-note" class="field-label">${esc(noteLabel)} <span class="req">required</span></label>
               <textarea id="confirm-note" rows="3" maxlength="2000" placeholder="${esc(notePlaceholder)}" aria-describedby="confirm-note-error" required></textarea>
               <p class="field-error" id="confirm-note-error" role="alert"></p>`
            : ""
        }
        <div class="modalactions"><button type="button" class="btn secondary" data-close>${esc(cancelLabel)}</button><button type="submit" class="btn ${danger ? "danger" : ""}" id="confirm-ok">${esc(confirmLabel)}</button></div>
      </form>`,
      bind(d, close) {
        d.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          let note = null;
          if (requireNote) {
            note = d.querySelector("#confirm-note").value.trim();
            if (!note) {
              d.querySelector("#confirm-note-error").textContent = "Explain why. The note is stored with the lifecycle event.";
              d.querySelector("#confirm-note").setAttribute("aria-invalid", "true");
              d.querySelector("#confirm-note").focus();
              return;
            }
          }
          finish({ confirmed: true, note });
          close();
        };
      },
    });
    dialog.addEventListener("close", () => finish({ confirmed: false, note: null }), { once: true });
  });
}
