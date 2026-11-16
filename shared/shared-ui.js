// DOM wiring for the opt-in shared sky (issue #3): the Settings section, the "Today's sky" chip on the atlas and the
// faint distant stars. Kept out of app.js on purpose. Nothing here touches the network; shared-sky.js does, and only
// once sharing is switched on.
import { closeDialog, openDialog } from "../lib/dialog.js";
import { MOONLIT } from "../atlas/sky-scene.js";
import { createSharedSky } from "./shared-sky.js";
import { sharedStarPlacement } from "./star-rules.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Draws other people's stars into `layer` (a <g> in the crisp SVG layer, never the cached painting).
// Small, faint and topic-tinted; purely decorative, so no focus, no roles, no labels.
export function renderSharedStars(layer, stars, world) {
  layer.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const star of stars) {
    const { x, y, size, phase } = sharedStarPlacement(star, world);
    const [hue] = MOONLIT[star.topic] || MOONLIT.wildcard;
    const g = svgEl("g", { class: "shared-star" });
    g.style.animationDelay = `-${phase.toFixed(2)}s`;
    g.append(
      svgEl("circle", {
        cx: x.toFixed(1),
        cy: y.toFixed(1),
        r: (size * 5.4).toFixed(2),
        fill: `url(#starHalo-${star.topic})`,
        opacity: 0.6,
      })
    );
    g.append(
      svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: (size * 0.95).toFixed(2), fill: hue, opacity: 0.92 })
    );
    fragment.append(g);
  }
  layer.append(fragment);
}

export function initSharedSkyUi({ world, showToast = () => {}, sky = createSharedSky() }) {
  const $ = (selector) => document.querySelector(selector);
  const layer = $("#sharedLayer");
  const section = $("#sharedSkySection");
  const controls = $("#sharedSkyControls");
  const devNote = $("#sharedSkyDevNote");
  const switchBtn = $("#sharedSkySwitch");
  const statusLine = $("#sharedSkyStatus");
  const withdrawBtn = $("#sharedSkyWithdrawBtn");
  const bar = $("#sharedSkyBar");
  const chip = $("#sharedSkyChip");
  const countLine = $("#sharedSkyCount");
  const confirmOverlay = $("#sharedConfirmOverlay");
  const confirmCancel = $("#sharedConfirmCancel");
  const confirmOk = $("#sharedConfirmOk");
  const settingsBtn = $("#openSettingsBtn");

  if (!sky.isAvailable()) {
    // No Convex URL at build time: the feature does not exist. Only developers get a hint.
    if (import.meta.env && import.meta.env.DEV && section && devNote) {
      section.classList.remove("hidden");
      controls.classList.add("hidden");
      devNote.classList.remove("hidden");
    }
    return { publishEntry: async () => false, enabled: false };
  }

  let lastStarSignature = null;

  const STATUS_TEXT = {
    off: "Sharing is off. Nothing leaves this device.",
    connecting: "Connecting to the shared sky…",
    live: "Sharing is on. Each new reflection adds one anonymous star.",
    offline: "You seem to be offline. New stars will be shared when you are back online.",
  };

  function syncSwitch() {
    const on = sky.isEnabled();
    switchBtn.setAttribute("aria-checked", String(on));
    switchBtn.classList.toggle("on", on);
  }

  function syncStatus(snapshot = sky.getSnapshot()) {
    statusLine.textContent = STATUS_TEXT[sky.isEnabled() ? snapshot.status : "off"] || STATUS_TEXT.off;
  }

  function syncChip() {
    const on = sky.isEnabled();
    bar.classList.toggle("hidden", !on);
    const visible = sky.isSkyVisible();
    chip.setAttribute("aria-pressed", String(visible));
    layer.style.display = on && visible ? "" : "none";
  }

  function syncCount(snapshot) {
    let text = "";
    if (sky.isEnabled() && sky.isSkyVisible() && snapshot.status === "live") {
      text =
        snapshot.count > 0
          ? `${snapshot.count.toLocaleString()} ${snapshot.count === 1 ? "other" : "others"} reflected today`
          : "Be among the first to reflect today";
    }
    if (countLine.textContent !== text) countLine.textContent = text;
    countLine.classList.toggle("hidden", !text);
  }

  function syncStars(snapshot) {
    const stars = sky.isEnabled() && sky.isSkyVisible() ? snapshot.stars : [];
    const signature = stars.map((s) => `${s.topic}${s.depth}${s.seed}`).join("|");
    if (signature === lastStarSignature) return;
    lastStarSignature = signature;
    renderSharedStars(layer, stars, world);
  }

  function render(snapshot = sky.getSnapshot()) {
    syncSwitch();
    syncStatus(snapshot);
    syncChip();
    syncCount(snapshot);
    syncStars(snapshot);
  }

  sky.subscribe(render);

  switchBtn.addEventListener("click", async () => {
    const turnOn = switchBtn.getAttribute("aria-checked") !== "true";
    switchBtn.disabled = true;
    await sky.setEnabled(turnOn);
    switchBtn.disabled = false;
    render();
    if (!turnOn) showToast("Sharing is off.");
  });

  chip.addEventListener("click", () => {
    sky.setSkyVisible(!sky.isSkyVisible());
    render();
  });

  // Stop sharing & remove: confirm first (lib/dialog.js), then ask the server to delete this device's stars.
  const closeConfirm = () => closeDialog(confirmOverlay);
  withdrawBtn.addEventListener("click", () => {
    openDialog({
      overlay: confirmOverlay,
      panel: confirmOverlay.querySelector(".confirm-modal"),
      initialFocus: confirmCancel,
      onRequestClose: closeConfirm,
      returnFocus: withdrawBtn,
    });
  });
  confirmCancel.addEventListener("click", closeConfirm);
  confirmOverlay.addEventListener("click", (event) => {
    if (event.target === confirmOverlay) closeConfirm();
  });
  confirmOk.addEventListener("click", async () => {
    confirmOk.disabled = true;
    const result = await sky.withdraw();
    confirmOk.disabled = false;
    closeConfirm();
    render();
    if (result.ok) {
      statusLine.textContent = "Sharing is off, and your stars have been removed.";
      showToast("Your shared stars were removed.");
    } else {
      statusLine.textContent = "Could not reach the shared sky. Check your connection and try again.";
      showToast("Could not remove your stars. Try again when online.");
    }
  });

  if (settingsBtn) settingsBtn.addEventListener("click", () => render());

  section.classList.remove("hidden");
  render();
  // Start after first paint so the shared sky can never delay the app opening; no-op unless already switched on.
  setTimeout(() => {
    sky
      .init()
      .then(() => render())
      .catch((err) => console.warn("Shared sky init failed:", err));
  }, 1200);

  return {
    enabled: true,
    publishEntry: (entry) =>
      sky.publishEntry(entry).catch((err) => {
        console.warn("Shared sky publish failed:", err);
        return false;
      }),
  };
}
