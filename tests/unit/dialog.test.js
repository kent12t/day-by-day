// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDialog, isDialogOpen, openDialog } from "../../lib/dialog.js";

function makeDialog(id) {
  const overlay = document.createElement("div");
  overlay.className = "hidden";
  overlay.id = id;
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  const button = document.createElement("button");
  button.textContent = "Close";
  panel.append(button);
  overlay.append(panel);
  document.body.append(overlay);
  return { overlay, panel, button };
}

afterEach(() => {
  document.querySelectorAll("div").forEach((node) => {
    if (isDialogOpen(node)) closeDialog(node, { restoreFocus: false });
  });
  document.body.innerHTML = "";
});

describe("dialog helper", () => {
  it("opens, focuses the panel and closes with focus returned", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { overlay, panel, button } = makeDialog("one");

    openDialog({ overlay, panel, initialFocus: button });
    expect(overlay.classList.contains("hidden")).toBe(false);
    expect(isDialogOpen(overlay)).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(panel.getAttribute("tabindex")).toBe("-1");

    closeDialog(overlay);
    expect(overlay.classList.contains("hidden")).toBe(true);
    expect(isDialogOpen(overlay)).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("routes Escape to the top-most dialog only", () => {
    const lower = makeDialog("lower");
    const upper = makeDialog("upper");
    const onLower = vi.fn();
    const onUpper = vi.fn();
    openDialog({ overlay: lower.overlay, panel: lower.panel, onRequestClose: onLower });
    openDialog({ overlay: upper.overlay, panel: upper.panel, onRequestClose: onUpper });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onUpper).toHaveBeenCalledTimes(1);
    expect(onLower).not.toHaveBeenCalled();
  });

  it("closes by default on Escape when no handler is given", () => {
    const { overlay, panel } = makeDialog("plain");
    openDialog({ overlay, panel });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isDialogOpen(overlay)).toBe(false);
    expect(overlay.classList.contains("hidden")).toBe(true);
  });

  it("does not open the same overlay twice", () => {
    const { overlay, panel } = makeDialog("twice");
    const first = openDialog({ overlay, panel });
    expect(openDialog({ overlay, panel })).toBe(first);
  });
});
