// Minimal accessible modal helper: focus trap, Escape to close, focus return.
// Supports stacking (e.g. the delete confirmation above the memory sheet);
// only the top-most dialog reacts to keyboard events.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

const stack = [];

function focusableWithin(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (node) => !node.closest(".hidden") && node.getClientRects().length > 0
  );
}

function handleKeydown(event) {
  const top = stack[stack.length - 1];
  if (!top) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    top.requestClose();
    return;
  }

  if (event.key !== "Tab") return;
  const focusable = focusableWithin(top.panel);
  if (!focusable.length) {
    event.preventDefault();
    top.panel.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const outside = !top.panel.contains(active);

  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

function handleFocusIn(event) {
  const top = stack[stack.length - 1];
  if (!top || top.panel.contains(event.target)) return;
  const focusable = focusableWithin(top.panel);
  (focusable[0] || top.panel).focus();
}

// overlay: element toggled with .hidden; panel: the role="dialog" element.
// onRequestClose: called on Escape (and backdrop click when enabled).
export function openDialog({ overlay, panel = overlay, initialFocus, onRequestClose, returnFocus }) {
  const existing = stack.find((item) => item.overlay === overlay);
  if (existing) return existing;

  const record = {
    overlay,
    panel,
    returnFocus: returnFocus || document.activeElement,
    requestClose: () => (onRequestClose ? onRequestClose() : closeDialog(overlay)),
  };

  if (!stack.length) {
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("focusin", handleFocusIn);
  }
  stack.push(record);

  overlay.classList.remove("hidden");
  if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");

  const target = typeof initialFocus === "function" ? initialFocus() : initialFocus;
  const focusTarget = target || focusableWithin(panel)[0] || panel;
  focusTarget.focus({ preventScroll: true });

  return record;
}

export function closeDialog(overlay, { restoreFocus = true } = {}) {
  const index = stack.findIndex((item) => item.overlay === overlay);
  overlay.classList.add("hidden");
  if (index < 0) return;

  const [record] = stack.splice(index, 1);
  if (!stack.length) {
    document.removeEventListener("keydown", handleKeydown, true);
    document.removeEventListener("focusin", handleFocusIn);
  }

  if (!restoreFocus) return;
  const target = record.returnFocus;
  if (target && target.isConnected && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
}

export function isDialogOpen(overlay) {
  return stack.some((item) => item.overlay === overlay);
}
