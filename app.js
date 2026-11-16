import { createPaintedSky, renderAtlasOverlay } from "./atlas/atlas-view.js";
import { TOPIC_COLORS } from "./atlas/sky-scene.js";
import {
  blobToDataUrl,
  compressImage,
  dataUrlToBlob,
  deletePhoto,
  getPhoto,
  isInlinePhoto,
  migrateInlinePhotos,
  putPhoto,
  requestPersistentStorage,
} from "./lib/photo-store.js";
import {
  MEMORY_PAGE_SIZE,
  excerptFor,
  filterMemories,
  groupMemoriesByMonth,
  sortMemoriesNewestFirst,
} from "./lib/memories.js";
import { closeDialog, openDialog } from "./lib/dialog.js";
import {
  chooseLeastUsedTopic,
  countEntriesOnDay,
  customPromptId,
  localDayKey,
  pickRankedPrompt,
} from "./lib/prompt-logic.js";

const STORAGE_KEY = "dayByDay.entries.v1";
const PROMPT_ROTATION_KEY = "dayByDay.promptRotation.v1";
const LEGACY_SYNC_KEYS = ["dayByDay.sync.meta.v1", "dayByDay.sync.deletes.v1"];
const ATLAS_HINT_KEY = "dayByDay.atlasHintSeen.v1";
const MILESTONES = new Set([7, 30, 100, 180, 365]);
const ATLAS_HINT_MS = 6500;
const TOAST_MIN_MS = 2500;
const TOAST_MAX_MS = 9000;
const TOAST_MS_PER_CHAR = 55;
const VIEW_TITLES = { atlas: "Day by Day", reflect: "Reflect · Day by Day", memories: "Memories · Day by Day" };

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;

const TOPIC_LABELS = {
  self: "Self",
  relationships: "Relationships",
  work: "Work",
  body: "Body",
  gratitude: "Gratitude",
  dreams: "Dreams",
  creativity: "Creativity",
  nature: "Nature",
  spirit: "Spirit",
  legacy: "Legacy",
  wildcard: "Wildcard",
};

const TOPIC_CENTERS = {
  self: [0.22, 0.42],
  relationships: [0.73, 0.37],
  work: [0.62, 0.22],
  body: [0.37, 0.61],
  gratitude: [0.49, 0.43],
  dreams: [0.79, 0.68],
  creativity: [0.15, 0.75],
  nature: [0.55, 0.85],
  spirit: [0.10, 0.20],
  legacy: [0.85, 0.15],
};

const DEPTHS = ["gentle", "deeper", "bold", "ethereal"];

const state = {
  prompts: [],
  entries: loadEntries(),
  selectedTopic: "self",
  selectedDepth: "gentle",
  selectedPrompt: null,
  selectedMode: "offline",
  photoBlob: null,
  photoPreviewUrl: "",
  customPromptActive: false,
  savingEntry: false,
  promptRotation: loadPromptRotation(),
  activeView: "atlas",
  atlas: {
    zoom: 1,
    minZoom: 0.7,
    maxZoom: 2.7,
    viewportWidth: 1000,
    viewportHeight: 620,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    pointers: new Map(),
    pinch: null,
    lastX: 0,
    lastY: 0,
    dragDistance: 0,
    clickBlocked: false,
    panFrame: 0,
  },
  latestNode: null,
  atlasNodes: [],
  focusedStarId: "",
  memoryFilter: { topic: "all", query: "" },
  memoryVisibleCount: MEMORY_PAGE_SIZE,
  memorySheet: {
    entryId: "",
    editing: false,
    photoUrl: "",
    editBlob: null,
    editPreviewUrl: "",
    removePhoto: false,
    saving: false,
  },
  pendingDeleteId: "",
};

let memoryThumbObserver = null;
let loadMoreObserver = null;
let atlasReturnFocus = null;
let atlasHintTimer = 0;
let toastTimer = 0;
let toastRemaining = 0;
let toastShownAt = 0;
let toastHeld = false;
const memoryThumbUrls = new Map();

const viewSections = [...document.querySelectorAll(".view")];
const navButtons = [...document.querySelectorAll("[data-go]")];
const reflectView = document.querySelector('.view[data-view="reflect"]');

const promptFlipCard = document.querySelector("#promptFlipCard");
const revealPromptBtn = document.querySelector("#revealPromptBtn");
const customizeToggleBtn = document.querySelector("#customizeToggleBtn");
const customizePanel = document.querySelector("#customizePanel");
const customizeTitle = document.querySelector("#customizeTitle");
const customizeSubtitle = document.querySelector("#customizeSubtitle");
const reflectionSettings = document.querySelector("#reflectionSettings");
const topicList = document.querySelector("#topicList");
const depthList = document.querySelector("#depthList");
const promptKicker = document.querySelector("#promptKicker");
const promptText = document.querySelector("#promptText");
const followUpText = document.querySelector("#followUpText");
const usePromptBtn = document.querySelector("#usePromptBtn");
const customizeFromBackBtn = document.querySelector("#customizeFromBackBtn");
const newPromptBtn = document.querySelector("#newPromptBtn");
const modeList = document.querySelector("#modeList");
const journalText = document.querySelector("#journalText");
const photoInputWrap = document.querySelector("#photoInputWrap");
const photoInput = document.querySelector("#photoInput");
const photoPreview = document.querySelector("#photoPreview");
const saveEntryBtn = document.querySelector("#saveEntryBtn");
const writeOwnPromptBtn = document.querySelector("#writeOwnPromptBtn");
const customPromptWrap = document.querySelector("#customPromptWrap");
const customPromptInput = document.querySelector("#customPromptInput");
const cancelCustomPromptBtn = document.querySelector("#cancelCustomPromptBtn");

const skyMeta = document.querySelector("#skyMeta");
const historyList = document.querySelector("#historyList");
const memoriesSummary = document.querySelector("#memoriesSummary");
const memorySearchInput = document.querySelector("#memorySearchInput");
const memoryTopicFilters = document.querySelector("#memoryTopicFilters");
const memoryResultsStatus = document.querySelector("#memoryResultsStatus");
const loadMoreMemoriesBtn = document.querySelector("#loadMoreMemoriesBtn");
const memorySheetOverlay = document.querySelector("#memorySheetOverlay");
const memorySheet = document.querySelector("#memorySheet");
const memorySheetKicker = document.querySelector("#memorySheetKicker");
const memorySheetTitle = document.querySelector("#memorySheetTitle");
const memorySheetMeta = document.querySelector("#memorySheetMeta");
const memorySheetPrompt = document.querySelector("#memorySheetPrompt");
const memorySheetFollowUp = document.querySelector("#memorySheetFollowUp");
const memorySheetView = document.querySelector("#memorySheetView");
const memorySheetNoteLabel = document.querySelector("#memorySheetNoteLabel");
const memorySheetNote = document.querySelector("#memorySheetNote");
const memorySheetPhoto = document.querySelector("#memorySheetPhoto");
const memoryEditForm = document.querySelector("#memoryEditForm");
const memoryEditText = document.querySelector("#memoryEditText");
const memoryEditPreview = document.querySelector("#memoryEditPreview");
const memoryEditPhoto = document.querySelector("#memoryEditPhoto");
const memoryRemovePhotoBtn = document.querySelector("#memoryRemovePhotoBtn");
const memoryViewActions = document.querySelector("#memoryViewActions");
const memoryEditActions = document.querySelector("#memoryEditActions");
const closeMemorySheetBtn = document.querySelector("#closeMemorySheetBtn");
const editMemoryBtn = document.querySelector("#editMemoryBtn");
const deleteMemoryBtn = document.querySelector("#deleteMemoryBtn");
const cancelEditMemoryBtn = document.querySelector("#cancelEditMemoryBtn");
const saveEditMemoryBtn = document.querySelector("#saveEditMemoryBtn");
const memoriesHeading = document.querySelector("#memoriesHeading");
const openSettingsBtn = document.querySelector("#openSettingsBtn");
const settingsOverlay = document.querySelector("#settingsOverlay");
const settingsSheet = document.querySelector("#settingsSheet");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const exportSummary = document.querySelector("#exportSummary");
const skipAtlasLink = document.querySelector("#skipAtlasLink");
const atlasView = document.querySelector('.view[data-view="atlas"]');
const atlasStage = document.querySelector("#atlasStage");
const atlasHint = document.querySelector("#atlasHint");
const exportDataBtn = document.querySelector("#exportDataBtn");
const importDataBtn = document.querySelector("#importDataBtn");
const importDataInput = document.querySelector("#importDataInput");
const toast = document.querySelector("#toast");
const atlasPopup = document.querySelector("#atlasPopup");
const confirmOverlay = document.querySelector("#confirmOverlay");
const confirmModal = confirmOverlay.querySelector(".confirm-modal");
const confirmText = document.querySelector("#confirmText");
const cancelDeleteBtn = document.querySelector("#cancelDeleteBtn");
const confirmDeleteBtn = document.querySelector("#confirmDeleteBtn");

const skyAtlas = document.querySelector("#skyAtlas");
const worldLayer = document.querySelector("#worldLayer");
const atmosphereLayer = document.querySelector("#atmosphereLayer");
const nebulaLayer = document.querySelector("#nebulaLayer");
const linkLayer = document.querySelector("#linkLayer");
const nodeLayer = document.querySelector("#nodeLayer");
const eventLayer = document.querySelector("#eventLayer");

const zoomInBtn = document.querySelector("#zoomInBtn");
const zoomOutBtn = document.querySelector("#zoomOutBtn");
const recenterBtn = document.querySelector("#recenterBtn");
const focusLatestBtn = document.querySelector("#focusLatestBtn");
const paintedSky = createPaintedSky({ svg: skyAtlas, world: { width: WORLD_WIDTH, height: WORLD_HEIGHT } });

init();

async function init() {
  removeLegacySyncKeys();
  applyTopicPalette();
  applyTimeOfDay();
  setInterval(applyTimeOfDay, 10 * 60 * 1000);
  setActiveView(state.activeView);

  try {
    const res = await fetch("./prompts.v1.core.json");
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    state.prompts = await res.json();
  } catch (err) {
    console.error("Failed to load prompts:", err);
    state.prompts = []; // Fallback to empty if file is missing or invalid
  }
  updateViewportSize(true);
  applyAtlasTransform();

  renderTopics();
  renderDepths();
  pickPrompt();
  renderSkyAtlas();
  renderMemoryFilters();
  renderHistory();
  bindEvents();
  maybeShowAtlasHint();
  await migrateLegacyPhotoStorage();
}

// TOPIC_COLORS (shared with the sky painter) is the source of truth; styles.css carries the same values as fallbacks.
function applyTopicPalette() {
  const root = document.documentElement;
  Object.entries(TOPIC_COLORS).forEach(([topic, color]) => root.style.setProperty(`--${topic}`, color));
}

function timeOfDayFor(hour) {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "dusk";
  return "night";
}

// A faint tint on the UI chrome only; the painted sky is never repainted for it.
function applyTimeOfDay() {
  document.body.dataset.time = timeOfDayFor(new Date().getHours());
}

function bindEvents() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.go));
  });

  skipAtlasLink.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView("memories");
    memoriesHeading.focus({ preventScroll: true });
  });

  revealPromptBtn.addEventListener("click", () => revealPromptCard({ moveFocus: true }));

  // The card itself is a physical object: tapping its face turns it too (the button is the keyboard path).
  promptFlipCard.addEventListener("click", () => {
    if (!promptFlipCard.classList.contains("revealed")) revealPromptCard({ moveFocus: false });
  });

  customizeToggleBtn.addEventListener("click", () => {
    toggleCustomizePanel("custom");
  });

  usePromptBtn.addEventListener("click", () => {
    showCustomizePanel("quick");
  });

  customizeFromBackBtn.addEventListener("click", () => {
    showCustomizePanel("custom");
  });

  topicList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-topic]");
    if (!button) return;
    state.selectedTopic = button.dataset.topic;
    renderTopics();
    pickPrompt();
  });

  depthList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-depth]");
    if (!button) return;
    state.selectedDepth = button.dataset.depth;
    renderDepths();
    pickPrompt();
  });

  newPromptBtn.addEventListener("click", () => {
    state.promptRotation += 1;
    try {
      localStorage.setItem(PROMPT_ROTATION_KEY, String(state.promptRotation));
    } catch (err) {
      console.error("Failed to persist prompt rotation:", err);
    }
    stopCustomPrompt();
    pickPrompt();
    resetPromptDecisionFlow();
  });

  modeList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    state.selectedMode = button.dataset.mode;
    modeList.querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button));
    syncCaptureMode();
  });

  photoInput.addEventListener("change", handlePhotoSelection);

  saveEntryBtn.addEventListener("click", saveEntry);

  writeOwnPromptBtn.addEventListener("click", startCustomPrompt);
  cancelCustomPromptBtn.addEventListener("click", () => {
    stopCustomPrompt();
    pickPrompt();
    resetPromptDecisionFlow();
  });
  customPromptInput.addEventListener("input", renderCustomPromptCard);

  zoomInBtn.addEventListener("click", () => zoomAtlas(0.15));
  zoomOutBtn.addEventListener("click", () => zoomAtlas(-0.15));
  recenterBtn.addEventListener("click", () => {
    resetAtlasTransform();
    applyAtlasTransform();
    hideAtlasPopup();
  });

  focusLatestBtn.addEventListener("click", () => {
    recenterLatestEntry();
  });

  historyList.addEventListener("click", (event) => {
    const card = event.target.closest(".history-item");
    if (!card) return;
    openMemorySheet(card.dataset.entryId, card);
  });

  memorySearchInput.addEventListener("input", () => {
    state.memoryFilter.query = memorySearchInput.value;
    state.memoryVisibleCount = MEMORY_PAGE_SIZE;
    renderHistory();
  });

  memoryTopicFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter-topic]");
    if (!button) return;
    state.memoryFilter.topic = button.dataset.filterTopic;
    state.memoryVisibleCount = MEMORY_PAGE_SIZE;
    renderMemoryFilters();
    renderHistory();
  });

  loadMoreMemoriesBtn.addEventListener("click", showMoreMemories);

  closeMemorySheetBtn.addEventListener("click", requestCloseMemorySheet);
  editMemoryBtn.addEventListener("click", startMemoryEdit);
  cancelEditMemoryBtn.addEventListener("click", cancelMemoryEdit);
  saveEditMemoryBtn.addEventListener("click", saveMemoryEdit);
  memoryEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveMemoryEdit();
  });
  memoryEditPhoto.addEventListener("change", handleMemoryEditPhoto);
  memoryRemovePhotoBtn.addEventListener("click", removeMemoryEditPhoto);
  deleteMemoryBtn.addEventListener("click", () => {
    openDeleteConfirm(state.memorySheet.entryId, deleteMemoryBtn);
  });
  memorySheetOverlay.addEventListener("click", (event) => {
    if (event.target === memorySheetOverlay) requestCloseMemorySheet();
  });

  atlasPopup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open-entry]");
    if (!button) return;
    const entryId = button.dataset.openEntry;
    hideAtlasPopup();
    openMemorySheet(entryId, atlasReturnFocus);
  });

  cancelDeleteBtn.addEventListener("click", closeDeleteConfirm);
  confirmDeleteBtn.addEventListener("click", deleteSelectedMemory);

  openSettingsBtn.addEventListener("click", openSettingsSheet);
  closeSettingsBtn.addEventListener("click", closeSettingsSheet);
  settingsOverlay.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) closeSettingsSheet();
  });

  exportDataBtn.addEventListener("click", exportEntries);
  importDataBtn.addEventListener("click", () => importDataInput.click());
  importDataInput.addEventListener("change", importEntriesFromFile);

  toast.addEventListener("mouseenter", holdToast);
  toast.addEventListener("mouseleave", releaseToast);
  toast.addEventListener("focusin", holdToast);
  toast.addEventListener("focusout", releaseToast);

  confirmOverlay.addEventListener("click", (event) => {
    if (event.target === confirmOverlay) {
      closeDeleteConfirm();
    }
  });

  window.addEventListener("resize", () => {
    updateViewportSize(false);
    renderSkyAtlas();
    applyAtlasTransform();
    hideAtlasPopup();
  });

  skyAtlas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      dismissAtlasHint();
      const rect = skyAtlas.getBoundingClientRect();
      // trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels as larger steps
      const step = clamp(-event.deltaY * (event.ctrlKey ? 0.012 : 0.0012), -0.2, 0.2);
      zoomAtlas(step, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false }
  );

  skyAtlas.addEventListener("pointerdown", handleAtlasPointerDown);
  skyAtlas.addEventListener("pointermove", handleAtlasPointerMove);
  skyAtlas.addEventListener("pointerup", handleAtlasPointerEnd);
  skyAtlas.addEventListener("pointercancel", handleAtlasPointerEnd);

  nodeLayer.addEventListener("keydown", handleStarKeydown);
  nodeLayer.addEventListener("focusin", (event) => {
    const star = event.target.closest(".atlas-star");
    if (!star) return;
    setRovingStar(star);
    keepNodeInView(state.atlasNodes[atlasStars().indexOf(star)]);
  });

  // Browsers without overflow: clip may still scroll the stage to reveal a focused star; undo it (we pan instead).
  atlasStage.addEventListener("scroll", () => {
    atlasStage.scrollLeft = 0;
    atlasStage.scrollTop = 0;
  });

  atlasView.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || atlasPopup.classList.contains("hidden")) return;
    event.preventDefault();
    hideAtlasPopup();
    if (atlasReturnFocus && atlasReturnFocus.isConnected) atlasReturnFocus.focus({ preventScroll: true });
  });

  window.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#skyAtlas") && !event.target.closest("#atlasPopup")) {
      hideAtlasPopup();
    }
  });
}

/* ---------- atlas gestures: one-finger pan, two-finger pinch zoom ---------- */
function clientToViewport(clientX, clientY) {
  const rect = skyAtlas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / (rect.width || 1)) * state.atlas.viewportWidth,
    y: ((clientY - rect.top) / (rect.height || 1)) * state.atlas.viewportHeight,
  };
}

function startPinch() {
  const [a, b] = [...state.atlas.pointers.values()];
  const mid = clientToViewport((a.x + b.x) / 2, (a.y + b.y) / 2);
  state.atlas.pinch = {
    startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    startZoom: state.atlas.zoom,
    worldX: (mid.x - state.atlas.x) / state.atlas.zoom,
    worldY: (mid.y - state.atlas.y) / state.atlas.zoom,
  };
}

function updatePinch() {
  const [a, b] = [...state.atlas.pointers.values()];
  const pinch = state.atlas.pinch;
  const mid = clientToViewport((a.x + b.x) / 2, (a.y + b.y) / 2);
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  state.atlas.zoom = clamp(pinch.startZoom * (distance / pinch.startDistance), state.atlas.minZoom, state.atlas.maxZoom);
  // keep the world point first under the fingers' midpoint under it, so the pinch also pans
  state.atlas.x = mid.x - pinch.worldX * state.atlas.zoom;
  state.atlas.y = mid.y - pinch.worldY * state.atlas.zoom;
  clampAtlasPosition();
  applyAtlasTransform();
}

function handleAtlasPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  cancelAtlasPan();
  state.atlas.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try {
    skyAtlas.setPointerCapture(event.pointerId);
  } catch (err) {
    // capture can fail for synthetic pointers; panning still works without it
  }
  hideAtlasPopup();
  dismissAtlasHint();

  if (state.atlas.pointers.size === 1) {
    state.atlas.dragging = true;
    state.atlas.pointerId = event.pointerId;
    state.atlas.lastX = event.clientX;
    state.atlas.lastY = event.clientY;
    state.atlas.dragDistance = 0;
    skyAtlas.classList.add("dragging");
    return;
  }

  if (state.atlas.pointers.size === 2) {
    state.atlas.dragDistance += 100; // a pinch is never a tap
    startPinch();
  }
}

function handleAtlasPointerMove(event) {
  const pointer = state.atlas.pointers.get(event.pointerId);
  if (!pointer) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;

  if (state.atlas.pinch && state.atlas.pointers.size >= 2) {
    updatePinch();
    return;
  }

  if (!state.atlas.dragging || state.atlas.pointerId !== event.pointerId) return;
  const dx = event.clientX - state.atlas.lastX;
  const dy = event.clientY - state.atlas.lastY;
  state.atlas.dragDistance += Math.abs(dx) + Math.abs(dy);
  state.atlas.x += (dx / (skyAtlas.clientWidth || 1)) * state.atlas.viewportWidth;
  state.atlas.y += (dy / (skyAtlas.clientHeight || 1)) * state.atlas.viewportHeight;
  state.atlas.lastX = event.clientX;
  state.atlas.lastY = event.clientY;

  clampAtlasPosition();
  applyAtlasTransform();
}

function handleAtlasPointerEnd(event) {
  if (!state.atlas.pointers.has(event.pointerId)) return;
  state.atlas.pointers.delete(event.pointerId);

  if (state.atlas.pinch && state.atlas.pointers.size < 2) {
    state.atlas.pinch = null;
    // carry on panning with the finger that stayed down
    const [remainingId, remaining] = [...state.atlas.pointers.entries()][0] || [];
    if (remaining) {
      state.atlas.pointerId = remainingId;
      state.atlas.lastX = remaining.x;
      state.atlas.lastY = remaining.y;
      return;
    }
  } else if (state.atlas.pointers.size >= 2) {
    startPinch();
    return;
  } else if (state.atlas.pointers.size === 1) {
    return;
  }

  if (state.atlas.dragDistance > 6) {
    state.atlas.clickBlocked = true;
    setTimeout(() => {
      state.atlas.clickBlocked = false;
    }, 120);
  }

  state.atlas.dragging = false;
  state.atlas.pointerId = null;
  state.atlas.dragDistance = 0;
  skyAtlas.classList.remove("dragging");
}

/* ---------- atlas keyboard: roving focus between stars in date order ---------- */
function atlasStars() {
  return [...nodeLayer.querySelectorAll(".atlas-star")];
}

function setRovingStar(star) {
  state.focusedStarId = star.dataset.entryId || "";
  atlasStars().forEach((node) => node.setAttribute("tabindex", node === star ? "0" : "-1"));
}

function syncStarTabStops() {
  const stars = atlasStars();
  if (!stars.length) return;
  const current = stars.find((star) => star.dataset.entryId === state.focusedStarId) || stars[stars.length - 1];
  setRovingStar(current);
}

function handleStarKeydown(event) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const star = event.target.closest(".atlas-star");
  const stars = atlasStars();
  const index = stars.indexOf(star);
  if (index < 0) return;
  event.preventDefault();

  let next = index;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = stars.length - 1;
  next = clamp(next, 0, stars.length - 1);
  if (next === index) return;

  hideAtlasPopup();
  stars[next].focus({ preventScroll: true }); // focusin updates the roving tab stop and pans the star into view
}

// Pans (gently, unless motion is reduced) so a node sits inside the uncluttered middle of the screen.
function keepNodeInView(node) {
  if (!node) return;
  const { zoom, viewportWidth, viewportHeight } = state.atlas;
  const sx = node.x * zoom + state.atlas.x;
  const sy = node.y * zoom + state.atlas.y;
  const marginX = Math.min(120, viewportWidth * 0.18);
  const top = Math.min(130, viewportHeight * 0.2);
  const bottom = Math.min(170, viewportHeight * 0.26);
  const inside = sx > marginX && sx < viewportWidth - marginX && sy > top && sy < viewportHeight - bottom;
  if (inside) return;
  panAtlasTo(viewportWidth / 2 - zoom * node.x, (top + viewportHeight - bottom) / 2 - zoom * node.y);
}

function cancelAtlasPan() {
  if (state.atlas.panFrame) cancelAnimationFrame(state.atlas.panFrame);
  state.atlas.panFrame = 0;
}

function panAtlasTo(targetX, targetY) {
  cancelAtlasPan();
  const fromX = state.atlas.x;
  const fromY = state.atlas.y;
  state.atlas.x = targetX;
  state.atlas.y = targetY;
  clampAtlasPosition();
  const toX = state.atlas.x;
  const toY = state.atlas.y;

  if (prefersReducedMotion()) {
    applyAtlasTransform();
    return;
  }

  const start = performance.now();
  const duration = 320;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    state.atlas.x = fromX + (toX - fromX) * eased;
    state.atlas.y = fromY + (toY - fromY) * eased;
    applyAtlasTransform();
    state.atlas.panFrame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  state.atlas.panFrame = requestAnimationFrame(step);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) {
    return false;
  }
}

/* ---------- first-visit atlas hint ---------- */
function maybeShowAtlasHint() {
  let seen = false;
  try {
    seen = localStorage.getItem(ATLAS_HINT_KEY) === "1";
  } catch (err) {
    console.warn("Could not read the atlas hint flag:", err);
  }
  if (seen) return;
  atlasHint.classList.remove("hidden");
  requestAnimationFrame(() => atlasHint.classList.add("visible"));
  atlasHintTimer = setTimeout(dismissAtlasHint, ATLAS_HINT_MS);
}

function dismissAtlasHint() {
  if (atlasHint.classList.contains("hidden")) return;
  clearTimeout(atlasHintTimer);
  atlasHint.classList.remove("visible");
  setTimeout(() => atlasHint.classList.add("hidden"), 900);
  try {
    localStorage.setItem(ATLAS_HINT_KEY, "1");
  } catch (err) {
    console.warn("Could not remember the atlas hint:", err);
  }
}

function setActiveView(viewName) {
  const changed = state.activeView !== viewName;
  state.activeView = viewName;
  document.body.dataset.view = viewName;
  document.title = VIEW_TITLES[viewName] || VIEW_TITLES.atlas;

  viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === viewName);
  });

  // The painted sky stays behind every view as a dimmed backdrop, but only the atlas view is interactive.
  const atlasActive = viewName === "atlas";
  atlasView.inert = !atlasActive;
  atlasView.setAttribute("aria-hidden", String(!atlasActive));
  skipAtlasLink.classList.toggle("hidden", !atlasActive);
  if (!atlasActive) {
    hideAtlasPopup();
    dismissAtlasHint();
  }

  navButtons.forEach((button) => {
    const isCurrent = button.dataset.go === viewName;
    button.classList.toggle("active", isCurrent);
    if (isCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (changed) window.scrollTo({ top: 0, behavior: "instant" });
}

function revealPromptCard({ moveFocus = false } = {}) {
  promptFlipCard.classList.add("revealed");
  if (!state.selectedPrompt && !state.customPromptActive) pickPrompt();
  if (moveFocus) usePromptBtn.focus({ preventScroll: true });
}

function showCustomizePanel(mode = "custom") {
  lockPromptCard();
  applyCustomizeMode(mode);
  customizePanel.classList.remove("hidden");
  reflectView.classList.add("reflect-expanded");
  customizePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleCustomizePanel(mode = "custom") {
  const willShow = customizePanel.classList.contains("hidden");
  customizePanel.classList.toggle("hidden", !willShow);

  if (willShow) {
    lockPromptCard();
    applyCustomizeMode(mode);
    reflectView.classList.add("reflect-expanded");
  } else {
    unlockPromptCard();
    reflectView.classList.remove("reflect-expanded");
  }

  if (willShow) {
    customizePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function resetPromptDecisionFlow() {
  customizePanel.classList.add("hidden");
  reflectView.classList.remove("reflect-expanded");
  unlockPromptCard();
  applyCustomizeMode("custom");
  promptFlipCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

function lockPromptCard() {
  promptFlipCard.classList.add("revealed", "locked");
}

function unlockPromptCard() {
  promptFlipCard.classList.remove("locked");
}

function applyCustomizeMode(mode) {
  const isQuick = mode === "quick";
  const isOwn = mode === "own";
  if (!isOwn && state.customPromptActive) {
    stopCustomPrompt();
    pickPrompt();
  }
  reflectionSettings.classList.toggle("hidden", isQuick);
  if (isOwn) {
    customizeTitle.textContent = "Your Prompt";
    customizeSubtitle.textContent = "Ask yourself the question tonight needs.";
    return;
  }
  customizeTitle.textContent = isQuick ? "Use Prompt" : "Customize";
  customizeSubtitle.textContent = isQuick
    ? "Capture your reflection with this prompt."
    : "Shape your reflection flow.";
}

function renderTopics() {
  topicList.innerHTML = "";
  Object.entries(TOPIC_LABELS).forEach(([topic, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${topic === state.selectedTopic ? "active" : ""}`;
    btn.dataset.topic = topic;
    btn.textContent = label;
    topicList.append(btn);
  });
}

function renderDepths() {
  depthList.innerHTML = "";
  DEPTHS.forEach((depth) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `depth-btn ${depth === state.selectedDepth ? "active" : ""}`;
    btn.dataset.depth = depth;
    btn.textContent = depth;
    depthList.append(btn);
  });
}

function syncCaptureMode() {
  if (state.selectedMode === "text") {
    journalText.classList.remove("hidden");
    photoInputWrap.classList.add("hidden");
  } else if (state.selectedMode === "photo") {
    journalText.classList.add("hidden");
    photoInputWrap.classList.remove("hidden");
  } else {
    journalText.classList.add("hidden");
    photoInputWrap.classList.add("hidden");
  }
}

function pickPrompt() {
  if (!state.prompts.length) {
    state.selectedPrompt = null;
    promptText.textContent = "Prompts are loading...";
    followUpText.textContent = "";
    renderCustomPromptCard();
    return;
  }

  const dayKey = localDayKey();
  let topic = state.selectedTopic;
  if (topic === "wildcard") topic = chooseWildcardTopic(dayKey);

  const relevant = state.prompts.filter((prompt) => prompt.topic === topic && prompt.depth === state.selectedDepth);
  const recentPromptIds = new Set(
    state.entries
      .slice(-30)
      .map((entry) => entry.promptId)
      .filter(Boolean)
  );

  if (!relevant.length) {
    state.selectedPrompt = null;
    promptText.textContent = "No prompts found for this setup.";
    followUpText.textContent = "";
    renderCustomPromptCard();
    return;
  }

  // Seed with today's local date and how many reflections were saved today, so
  // deleting an older memory never reshuffles today's prompt (#10).
  const savedToday = countEntriesOnDay(state.entries, dayKey);
  const seed = `${dayKey}-${topic}-${state.selectedDepth}-${savedToday}`;

  state.selectedPrompt = pickRankedPrompt(relevant, seed, recentPromptIds, state.promptRotation);
  promptFlipCard.dataset.topic = state.selectedPrompt.topic;
  promptKicker.textContent = TOPIC_LABELS[state.selectedPrompt.topic] || "Prompt";
  promptText.textContent = state.selectedPrompt.text;
  followUpText.textContent = state.selectedPrompt.followUp || "";
  renderCustomPromptCard();
}

function chooseWildcardTopic(dayKey = localDayKey()) {
  const topics = Object.keys(TOPIC_CENTERS);
  return chooseLeastUsedTopic(state.entries.slice(-14), topics, `${dayKey}-${state.promptRotation}`);
}

function startCustomPrompt() {
  state.customPromptActive = true;
  customPromptWrap.classList.remove("hidden");
  showCustomizePanel("own");
  renderCustomPromptCard();
  customPromptInput.focus({ preventScroll: true });
}

function stopCustomPrompt() {
  state.customPromptActive = false;
  customPromptWrap.classList.add("hidden");
}

function renderCustomPromptCard() {
  if (!state.customPromptActive) return;
  const text = customPromptInput.value.trim();
  promptFlipCard.dataset.topic = getCustomTopic();
  promptKicker.textContent = "Your own prompt";
  promptText.textContent = text || "Write the question you want to sit with.";
  followUpText.textContent = "";
}

function getCustomTopic() {
  return state.selectedTopic === "wildcard" ? "self" : state.selectedTopic;
}

function buildPromptForEntry() {
  if (state.customPromptActive) {
    const text = customPromptInput.value.trim().replace(/\s+/g, " ");
    if (!text) return null;
    return { id: customPromptId(text), topic: getCustomTopic(), text, followUp: "" };
  }
  return state.selectedPrompt;
}

async function handlePhotoSelection() {
  const file = photoInput.files?.[0];
  clearSelectedPhoto({ keepInput: true });
  if (!file) return;

  saveEntryBtn.disabled = true;
  try {
    const blob = await compressImage(file);
    if (photoInput.files?.[0] !== file) return;
    state.photoBlob = blob;
    state.photoPreviewUrl = URL.createObjectURL(blob);
    photoPreview.src = state.photoPreviewUrl;
    photoPreview.classList.remove("hidden");
  } catch (err) {
    console.error("Could not process photo:", err);
    photoInput.value = "";
    showToast("Could not read that photo. Try a JPEG or PNG.");
  } finally {
    saveEntryBtn.disabled = false;
  }
}

function clearSelectedPhoto({ keepInput = false } = {}) {
  if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
  state.photoBlob = null;
  state.photoPreviewUrl = "";
  if (!keepInput) photoInput.value = "";
  photoPreview.removeAttribute("src");
  photoPreview.classList.add("hidden");
}

async function saveEntry() {
  if (state.savingEntry) return;

  if (state.customPromptActive && !customPromptInput.value.trim()) {
    showToast("Write your prompt first.");
    customPromptInput.focus();
    return;
  }

  const prompt = buildPromptForEntry();
  if (!prompt) {
    showToast("Reveal a prompt first.");
    return;
  }

  const text = journalText.value.trim();
  if (state.selectedMode === "text" && !text) {
    showToast("Add a short note, or choose a different method.");
    return;
  }

  const photoBlob = state.selectedMode === "photo" ? state.photoBlob : null;
  if (state.selectedMode === "photo" && !photoBlob) {
    showToast("Add a photo before saving.");
    return;
  }

  const now = new Date();
  const topicForEntry = state.customPromptActive
    ? getCustomTopic()
    : state.selectedTopic === "wildcard"
      ? prompt.topic
      : state.selectedTopic;

  const entry = {
    id: `${now.toISOString()}-${Math.abs(hashString(prompt.id + state.entries.length))}`,
    date: now.toISOString(),
    topic: topicForEntry,
    topicPicker: state.selectedTopic,
    depth: state.selectedDepth,
    promptId: prompt.id,
    promptText: prompt.text,
    followUp: prompt.followUp || "",
    mode: state.selectedMode,
    text,
    photoDataUrl: "",
    photoRef: "",
    photoSynced: state.selectedMode !== "photo",
    updatedAt: now.toISOString(),
  };

  state.savingEntry = true;
  saveEntryBtn.disabled = true;

  try {
    if (photoBlob) {
      try {
        await putPhoto(entry.id, photoBlob);
        entry.photoRef = entry.id;
        requestPersistentStorage();
      } catch (err) {
        console.error("Failed to store photo:", err);
        showToast("Could not store this photo on your device. Your reflection is still here.");
        return;
      }
    }

    state.entries.push(entry);
    if (!persistEntries()) {
      state.entries = state.entries.filter((item) => item.id !== entry.id);
      if (entry.photoRef) deletePhoto(entry.id).catch((err) => console.error("Photo cleanup failed:", err));
      showToast("Could not save locally. Your reflection is still here.");
      return;
    }
  } finally {
    state.savingEntry = false;
    saveEntryBtn.disabled = false;
  }

  journalText.value = "";
  clearSelectedPhoto();
  if (state.customPromptActive) {
    customPromptInput.value = "";
    stopCustomPrompt();
  }

  renderSkyAtlas(entry);
  renderMemoryFilters();
  renderHistory();
  pickPrompt();

  const milestoneHit = MILESTONES.has(state.entries.length);
  showToast(milestoneHit ? `Milestone: ${state.entries.length} reflections.` : "Your sky expanded tonight.");
  setActiveView("atlas");
}

function renderSkyAtlas(newEntry) {
  atmosphereLayer.innerHTML = "";
  nebulaLayer.innerHTML = "";
  linkLayer.innerHTML = "";
  nodeLayer.innerHTML = "";
  eventLayer.innerHTML = "";

  const nodes = state.entries.map((entry, index) => generateNode(entry, index));
  state.latestNode = nodes[nodes.length - 1] || null;
  state.atlasNodes = nodes;
  const links = makeLinks(nodes);

  const count = state.entries.length;
  skyMeta.textContent = count ? `${count} reflection${count === 1 ? "" : "s"}` : "Your sky is waiting";

  // the painted sky (milky way, nebulae, glows) repaints off the main thread only when the entries change
  paintedSky.update(nodes);

  if (!nodes.length) {
    renderWrappedAtlasHint("Your first reflection will light this atlas.");
  }

  renderAtlasOverlay({
    svg: skyAtlas,
    linkLayer,
    nodeLayer,
    eventLayer,
    nodes,
    links,
    entries: state.entries,
    labels: TOPIC_LABELS,
    newEntry,
    milestone: MILESTONES.has(state.entries.length),
    onSelect: (entry, event) => showAtlasPopup(entry, event),
    isClickBlocked: () => state.atlas.clickBlocked,
    describe: (entry, label) => `${label} reflection, ${formatEntryDay(entry.date, { weekday: "long", month: "long", day: "numeric" })}`,
  });
  syncStarTabStops();
}

function renderWrappedAtlasHint(message) {
  const maxLineWidth = (state.atlas.viewportWidth * 0.74) / Math.max(state.atlas.zoom, 1);
  const fontSize = clamp((state.atlas.viewportWidth * 0.052) / Math.max(state.atlas.zoom, 1), 18, 34);
  const lines = wrapTextToWidth(message, maxLineWidth, fontSize * 0.54);
  const lineHeight = fontSize * 1.2;
  const startY = WORLD_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    const hint = createSvg("text", {
      x: String(WORLD_WIDTH / 2),
      y: String(startY + index * lineHeight),
      fill: "rgba(234, 239, 255, 0.82)",
      "text-anchor": "middle",
      "font-size": String(fontSize),
      "font-family": "Cormorant Garamond, serif",
    });
    hint.textContent = line;
    nebulaLayer.append(hint);
  });
}

function wrapTextToWidth(text, maxWidth, avgCharWidth) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length * avgCharWidth <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function generateNode(entry, index) {
  const seed = hashString(`${entry.id}-${entry.topic}-${entry.depth}-${entry.mode}`);
  const rng = mulberry32(seed);
  const center = TOPIC_CENTERS[entry.topic] || [0.5, 0.45];

  const rangeX = WORLD_WIDTH * 0.2;
  const rangeY = WORLD_HEIGHT * 0.24;
  const randomX = center[0] * WORLD_WIDTH + (rng() - 0.5) * rangeX * 2;
  const randomY = center[1] * WORLD_HEIGHT + (rng() - 0.5) * rangeY * 2;

  const x = clamp(randomX + Math.sin(index * 0.29) * 30, 44, WORLD_WIDTH - 44);
  const y = clamp(randomY + Math.cos(index * 0.22) * 18, 40, WORLD_HEIGHT - 40);

  const sizeByDepth = { gentle: 3.8, deeper: 5.2, bold: 6.4, ethereal: 7.8 };
  const size = sizeByDepth[entry.depth] + rng() * 1.6;

  const shapePick = Math.floor(rng() * 3);
  const shape = shapePick === 0 ? "circle" : shapePick === 1 ? "diamond" : "spark";

  return { id: entry.id, x, y, size, topic: entry.topic, depth: entry.depth, shape };
}

function makeLinks(nodes) {
  const links = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const current = nodes[i];
    for (let j = i - 1; j >= 0; j -= 1) {
      const previous = nodes[j];
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (distance > 300) continue;

      if (current.topic === previous.topic || j === i - 1) {
        links.push({
          from: previous,
          to: current,
          strength: current.topic === previous.topic ? 1.35 : 0.75,
        });
        break;
      }
    }
  }

  return links;
}

function renderMemoryFilters() {
  memoryTopicFilters.innerHTML = "";
  const counts = new Map();
  state.entries.forEach((entry) => counts.set(entry.topic, (counts.get(entry.topic) || 0) + 1));

  if (state.memoryFilter.topic !== "all" && !counts.has(state.memoryFilter.topic)) {
    state.memoryFilter.topic = "all";
  }

  const topics = Object.keys(TOPIC_LABELS).filter((topic) => counts.has(topic));
  memoryTopicFilters.classList.toggle("hidden", topics.length < 2);

  [["all", "All"], ...topics.map((topic) => [topic, TOPIC_LABELS[topic]])].forEach(([topic, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${topic === state.memoryFilter.topic ? "active" : ""}`;
    btn.dataset.filterTopic = topic;
    if (topic !== "all") btn.dataset.topic = topic;
    btn.setAttribute("aria-pressed", String(topic === state.memoryFilter.topic));
    btn.textContent = topic === "all" ? label : `${label} · ${counts.get(topic)}`;
    memoryTopicFilters.append(btn);
  });
}

function renderHistory() {
  historyList.innerHTML = "";

  const total = state.entries.length;
  memoriesSummary.textContent = total
    ? `${total} moment${total === 1 ? "" : "s"} in your sky.`
    : "Every moment in your sky.";

  if (!total) {
    const empty = document.createElement("p");
    empty.className = "history-meta";
    empty.textContent = "No memories yet. Add your first reflection from the + button.";
    historyList.append(empty);
    memoryResultsStatus.textContent = "";
    loadMoreMemoriesBtn.classList.add("hidden");
    releaseMemoryThumbs(new Set());
    return;
  }

  const filtered = filterMemories(sortMemoriesNewestFirst(state.entries), state.memoryFilter);
  const visible = filtered.slice(0, state.memoryVisibleCount);
  const isFiltered = state.memoryFilter.topic !== "all" || Boolean(state.memoryFilter.query.trim());

  memoryResultsStatus.textContent = isFiltered
    ? `${filtered.length} of ${total} memories match.`
    : `Showing ${visible.length} of ${total}.`;

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "history-meta memory-empty";
    empty.textContent = "No memories match yet. Try another word or topic.";
    historyList.append(empty);
  }

  const monthTotals = new Map();
  groupMemoriesByMonth(filtered).forEach((group) => monthTotals.set(group.key, group.entries.length));

  groupMemoriesByMonth(visible).forEach((group) => {
    const section = document.createElement("section");
    section.className = "memory-month";
    section.setAttribute("aria-labelledby", `month-${group.key}`);

    const heading = document.createElement("h3");
    heading.className = "memory-month-title";
    heading.id = `month-${group.key}`;
    heading.textContent = group.label;
    const count = document.createElement("span");
    count.className = "memory-month-count";
    const monthTotal = monthTotals.get(group.key) || group.entries.length;
    count.textContent = `${monthTotal} ${monthTotal === 1 ? "memory" : "memories"}`;
    heading.append(count);

    const list = document.createElement("div");
    list.className = "memory-month-list";
    group.entries.forEach((entry) => list.append(createMemoryCard(entry)));

    section.append(heading, list);
    historyList.append(section);
  });

  const remaining = filtered.length - visible.length;
  loadMoreMemoriesBtn.classList.toggle("hidden", remaining <= 0);
  loadMoreMemoriesBtn.textContent = `Show older memories (${remaining} more)`;

  releaseMemoryThumbs(new Set(visible.map((entry) => entry.id)));
  observeLoadMore();
}

function createMemoryCard(entry) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "history-item";
  card.dataset.entryId = entry.id;
  card.dataset.topic = entry.topic;
  card.setAttribute("aria-haspopup", "dialog");

  const head = document.createElement("span");
  head.className = "memory-card-head";
  const dot = document.createElement("span");
  dot.className = "topic-dot";
  dot.setAttribute("aria-hidden", "true");
  const day = document.createElement("span");
  day.className = "memory-date";
  day.textContent = formatEntryDay(entry.date);
  const topic = document.createElement("span");
  topic.className = "memory-topic";
  topic.textContent = TOPIC_LABELS[entry.topic] || entry.topic;
  head.append(dot, day, topic, createDepthPips(entry.depth));
  card.append(head);

  const note = (entry.text || "").trim();
  if (note) {
    const noteNode = document.createElement("span");
    noteNode.className = "memory-note";
    noteNode.textContent = truncate(note.replace(/\s+/g, " "), 170);
    card.append(noteNode);
  }

  const prompt = document.createElement("span");
  prompt.className = note ? "memory-prompt" : "memory-prompt solo";
  prompt.textContent = entry.promptText;
  card.append(prompt);

  if (entryHasPhoto(entry)) {
    card.classList.add("has-photo");
    const img = document.createElement("img");
    img.className = "history-thumb";
    img.alt = "Reflection photo";
    img.decoding = "async";
    img.dataset.entryId = entry.id;
    card.append(img);
    observeMemoryThumb(img, entry);
  }

  return card;
}

// Depth as one to four small marks; the word itself is there for screen readers.
function createDepthPips(depth) {
  const wrap = document.createElement("span");
  wrap.className = "depth-pips";
  const level = Math.max(0, DEPTHS.indexOf(depth)) + 1;
  for (let i = 1; i <= DEPTHS.length; i += 1) {
    const pip = document.createElement("span");
    pip.className = i <= level ? "pip on" : "pip";
    pip.setAttribute("aria-hidden", "true");
    wrap.append(pip);
  }
  const label = document.createElement("span");
  label.className = "sr-only";
  label.textContent = `, ${depth} depth`;
  wrap.append(label);
  return wrap;
}

function formatEntryDay(dateValue, options = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(dateValue).toLocaleDateString(undefined, options);
}

function entryHasPhoto(entry) {
  return Boolean(entry.photoRef || entry.photoDataUrl);
}

// Resolves a displayable URL for an entry photo. `owned` URLs are object URLs
// that the caller must revoke.
async function resolveEntryPhotoUrl(entry) {
  if (entry.photoRef) {
    try {
      const blob = await getPhoto(entry.photoRef);
      if (blob) return { url: URL.createObjectURL(blob), owned: true };
    } catch (err) {
      console.error("Could not load photo:", err);
    }
  }
  if (entry.photoDataUrl) return { url: entry.photoDataUrl, owned: false };
  return { url: "", owned: false };
}

function observeMemoryThumb(img, entry) {
  const cached = memoryThumbUrls.get(entry.id);
  if (cached) {
    img.src = cached.url;
    return;
  }

  if (!("IntersectionObserver" in window)) {
    loadMemoryThumb(img, entry);
    return;
  }

  if (!memoryThumbObserver) {
    memoryThumbObserver = new IntersectionObserver(
      (records) => {
        records.forEach((record) => {
          if (!record.isIntersecting) return;
          memoryThumbObserver.unobserve(record.target);
          const target = state.entries.find((item) => item.id === record.target.dataset.entryId);
          if (target) loadMemoryThumb(record.target, target);
        });
      },
      { rootMargin: "240px 0px" }
    );
  }
  memoryThumbObserver.observe(img);
}

async function loadMemoryThumb(img, entry) {
  const cached = memoryThumbUrls.get(entry.id);
  if (cached) {
    img.src = cached.url;
    return;
  }

  const resolved = await resolveEntryPhotoUrl(entry);
  if (!resolved.url) {
    img.remove();
    return;
  }

  const existing = memoryThumbUrls.get(entry.id);
  if (existing) {
    if (resolved.owned) URL.revokeObjectURL(resolved.url);
    img.src = existing.url;
    return;
  }

  if (!img.isConnected) {
    if (resolved.owned) URL.revokeObjectURL(resolved.url);
    return;
  }

  memoryThumbUrls.set(entry.id, resolved);
  img.src = resolved.url;
}

function releaseMemoryThumbs(keepIds) {
  memoryThumbUrls.forEach((value, entryId) => {
    if (keepIds.has(entryId)) return;
    if (value.owned) URL.revokeObjectURL(value.url);
    memoryThumbUrls.delete(entryId);
  });
}

function observeLoadMore() {
  if (loadMoreObserver || !("IntersectionObserver" in window)) return;
  loadMoreObserver = new IntersectionObserver(
    (records) => {
      if (records.some((record) => record.isIntersecting)) showMoreMemories();
    },
    { rootMargin: "120px 0px" }
  );
  loadMoreObserver.observe(loadMoreMemoriesBtn);
}

function showMoreMemories() {
  if (loadMoreMemoriesBtn.classList.contains("hidden")) return;
  const hadFocus = document.activeElement === loadMoreMemoriesBtn;
  state.memoryVisibleCount += MEMORY_PAGE_SIZE;
  renderHistory();
  if (hadFocus && !loadMoreMemoriesBtn.classList.contains("hidden")) loadMoreMemoriesBtn.focus();
}

function openMemorySheet(entryId, returnFocus) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  resetMemoryEditState();
  state.memorySheet.entryId = entry.id;
  renderMemorySheet(entry);
  openDialog({
    overlay: memorySheetOverlay,
    panel: memorySheet,
    returnFocus: returnFocus || document.activeElement,
    initialFocus: closeMemorySheetBtn,
    onRequestClose: requestCloseMemorySheet,
  });
}

function renderMemorySheet(entry) {
  memorySheet.dataset.topic = entry.topic;
  memorySheetKicker.textContent = TOPIC_LABELS[entry.topic] || entry.topic;
  memorySheetTitle.textContent = formatEntryDay(entry.date, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const modeLabel = { offline: "Written offline", text: "Written here", photo: "Photo" }[entry.mode] || entry.mode;
  const edited = entry.updatedAt && entry.updatedAt !== entry.date ? " • edited" : "";
  memorySheetMeta.textContent = `Depth: ${entry.depth} • ${modeLabel}${edited}`;
  memorySheetPrompt.textContent = entry.promptText;
  memorySheetFollowUp.textContent = entry.followUp || "";
  memorySheetFollowUp.classList.toggle("hidden", !entry.followUp);

  memorySheetNoteLabel.classList.toggle("hidden", !entry.text);
  memorySheetNote.textContent = entry.text || (entry.mode === "offline" ? "You wrote this one offline." : "");
  memorySheetNote.classList.toggle("muted", !entry.text);

  loadSheetPhoto(entry);
}

async function loadSheetPhoto(entry) {
  releaseSheetPhoto();
  memorySheetPhoto.classList.add("hidden");
  if (!entryHasPhoto(entry)) return;

  const resolved = await resolveEntryPhotoUrl(entry);
  if (state.memorySheet.entryId !== entry.id || !resolved.url) {
    if (resolved.owned) URL.revokeObjectURL(resolved.url);
    return;
  }

  releaseSheetPhoto();
  state.memorySheet.photoUrl = resolved.owned ? resolved.url : "";
  memorySheetPhoto.src = resolved.url;
  memorySheetPhoto.alt = `Photo from your ${TOPIC_LABELS[entry.topic] || ""} reflection`;
  memorySheetPhoto.classList.remove("hidden");
}

function releaseSheetPhoto() {
  if (state.memorySheet.photoUrl) URL.revokeObjectURL(state.memorySheet.photoUrl);
  state.memorySheet.photoUrl = "";
  memorySheetPhoto.removeAttribute("src");
}

function requestCloseMemorySheet() {
  if (state.memorySheet.editing) {
    cancelMemoryEdit();
    return;
  }
  closeMemorySheet();
}

function closeMemorySheet({ restoreFocus = true } = {}) {
  resetMemoryEditState();
  releaseSheetPhoto();
  state.memorySheet.entryId = "";
  closeDialog(memorySheetOverlay, { restoreFocus });
}

function setMemoryEditing(editing) {
  state.memorySheet.editing = editing;
  memorySheetView.classList.toggle("hidden", editing);
  memoryEditForm.classList.toggle("hidden", !editing);
  memoryViewActions.classList.toggle("hidden", editing);
  memoryEditActions.classList.toggle("hidden", !editing);
}

function resetMemoryEditState() {
  const sheet = state.memorySheet;
  if (sheet.editPreviewUrl) URL.revokeObjectURL(sheet.editPreviewUrl);
  sheet.editBlob = null;
  sheet.editPreviewUrl = "";
  sheet.removePhoto = false;
  memoryEditPhoto.value = "";
  memoryEditPreview.removeAttribute("src");
  memoryEditPreview.classList.add("hidden");
  setMemoryEditing(false);
}

function startMemoryEdit() {
  const entry = state.entries.find((item) => item.id === state.memorySheet.entryId);
  if (!entry) return;

  resetMemoryEditState();
  memoryEditText.value = entry.text || "";
  if (memorySheetPhoto.getAttribute("src")) {
    memoryEditPreview.src = memorySheetPhoto.src;
    memoryEditPreview.classList.remove("hidden");
  }
  memoryRemovePhotoBtn.classList.toggle("hidden", !entryHasPhoto(entry));
  setMemoryEditing(true);
  memoryEditText.focus();
}

function cancelMemoryEdit() {
  resetMemoryEditState();
  editMemoryBtn.focus();
}

async function handleMemoryEditPhoto() {
  const file = memoryEditPhoto.files?.[0];
  if (!file) return;

  saveEditMemoryBtn.disabled = true;
  try {
    const blob = await compressImage(file);
    const sheet = state.memorySheet;
    if (sheet.editPreviewUrl) URL.revokeObjectURL(sheet.editPreviewUrl);
    sheet.editBlob = blob;
    sheet.removePhoto = false;
    sheet.editPreviewUrl = URL.createObjectURL(blob);
    memoryEditPreview.src = sheet.editPreviewUrl;
    memoryEditPreview.classList.remove("hidden");
    memoryRemovePhotoBtn.classList.remove("hidden");
  } catch (err) {
    console.error("Could not process photo:", err);
    memoryEditPhoto.value = "";
    showToast("Could not read that photo. Try a JPEG or PNG.");
  } finally {
    saveEditMemoryBtn.disabled = false;
  }
}

function removeMemoryEditPhoto() {
  const sheet = state.memorySheet;
  if (sheet.editPreviewUrl) URL.revokeObjectURL(sheet.editPreviewUrl);
  sheet.editBlob = null;
  sheet.editPreviewUrl = "";
  sheet.removePhoto = true;
  memoryEditPhoto.value = "";
  memoryEditPreview.removeAttribute("src");
  memoryEditPreview.classList.add("hidden");
  memoryRemovePhotoBtn.classList.add("hidden");
  memoryEditPhoto.focus();
}

async function saveMemoryEdit() {
  const sheet = state.memorySheet;
  if (sheet.saving) return;

  const index = state.entries.findIndex((item) => item.id === sheet.entryId);
  if (index < 0) {
    closeMemorySheet();
    return;
  }

  const original = state.entries[index];
  // id, date and topic stay fixed so the star keeps its place in the atlas.
  const updated = { ...original, text: memoryEditText.value.trim(), updatedAt: new Date().toISOString() };
  const photoChanged = Boolean(sheet.editBlob) || (sheet.removePhoto && entryHasPhoto(original));

  sheet.saving = true;
  saveEditMemoryBtn.disabled = true;

  try {
    if (sheet.editBlob) {
      try {
        await putPhoto(original.id, sheet.editBlob);
        requestPersistentStorage();
      } catch (err) {
        console.error("Failed to store edited photo:", err);
        showToast("Could not store the new photo on this device.");
        return;
      }
      updated.photoRef = original.id;
      updated.photoDataUrl = "";
      updated.photoSynced = false;
    } else if (sheet.removePhoto) {
      updated.photoRef = "";
      updated.photoDataUrl = "";
    }

    state.entries[index] = updated;
    if (!persistEntries()) {
      state.entries[index] = original;
      showToast("Could not save changes locally.");
      return;
    }

    if (sheet.removePhoto && !sheet.editBlob && original.photoRef) {
      deletePhoto(original.photoRef).catch((err) => console.error("Photo cleanup failed:", err));
    }
  } finally {
    sheet.saving = false;
    saveEditMemoryBtn.disabled = false;
  }

  if (photoChanged) forgetMemoryThumb(updated.id);
  resetMemoryEditState();
  renderMemorySheet(updated);
  renderHistory();
  editMemoryBtn.focus();
  showToast("Memory updated.");
}

function forgetMemoryThumb(entryId) {
  const cached = memoryThumbUrls.get(entryId);
  if (cached?.owned) URL.revokeObjectURL(cached.url);
  memoryThumbUrls.delete(entryId);
}

function openDeleteConfirm(entryId, returnFocus) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  const day = new Date(entry.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  state.pendingDeleteId = entryId;
  confirmText.textContent = `Delete ${TOPIC_LABELS[entry.topic]} memory from ${day}? This cannot be undone.`;
  openDialog({
    overlay: confirmOverlay,
    panel: confirmModal,
    returnFocus: returnFocus || document.activeElement,
    initialFocus: cancelDeleteBtn,
    onRequestClose: closeDeleteConfirm,
  });
}

function closeDeleteConfirm({ restoreFocus = true } = {}) {
  state.pendingDeleteId = "";
  closeDialog(confirmOverlay, { restoreFocus });
}

function deleteSelectedMemory() {
  if (!state.pendingDeleteId) {
    closeDeleteConfirm();
    return;
  }

  const deletedId = state.pendingDeleteId;
  const deletedEntry = state.entries.find((entry) => entry.id === deletedId);
  const nextEntries = state.entries.filter((entry) => entry.id !== deletedId);
  state.entries = nextEntries;
  persistEntries();
  closeDeleteConfirm({ restoreFocus: false });

  if (deletedEntry?.photoRef) {
    deletePhoto(deletedEntry.photoRef).catch((err) => console.error("Failed to delete photo:", err));
  }
  forgetMemoryThumb(deletedId);

  if (state.memorySheet.entryId === deletedId) closeMemorySheet({ restoreFocus: false });

  renderSkyAtlas();
  renderMemoryFilters();
  renderHistory();
  pickPrompt();
  hideAtlasPopup();
  if (state.activeView === "memories") memorySearchInput.focus({ preventScroll: true });
  showToast("Memory deleted.");
}

async function exportEntries() {
  if (!state.entries.length) {
    showToast("No memories to export yet.");
    return;
  }

  exportDataBtn.disabled = true;
  try {
    const entries = [];
    for (const entry of state.entries) {
      entries.push(await serializeEntryForExport(entry));
    }

    const payload = {
      app: "day-by-day",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `day-by-day-backup-${localDayKey()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Memories exported.");
  } catch (err) {
    console.error("Export failed:", err);
    showToast("Could not export memories.");
  } finally {
    exportDataBtn.disabled = false;
  }
}

// Backups stay self-contained: photos held in IndexedDB are embedded as data URLs.
async function serializeEntryForExport(entry) {
  if (!entry.photoRef) return { ...entry };
  try {
    const blob = await getPhoto(entry.photoRef);
    if (blob) return { ...entry, photoDataUrl: await blobToDataUrl(blob) };
  } catch (err) {
    console.error(`Could not read photo for export (${entry.id}):`, err);
  }
  return { ...entry };
}

async function importEntriesFromFile() {
  const file = importDataInput.files?.[0];
  importDataInput.value = "";

  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const normalized = normalizeImportedEntries(parsed);

    if (!normalized.length) {
      showToast("No valid memories found in file.");
      return;
    }

    const importedEntries = [];
    for (const entry of normalized) {
      importedEntries.push(await storeImportedPhoto(entry));
    }

    const previousEntries = state.entries;
    const mergedById = new Map();
    state.entries.forEach((entry) => mergedById.set(entry.id, entry));
    const sizeBefore = mergedById.size;
    importedEntries.forEach((entry) => mergedById.set(entry.id, entry));
    const addedCount = mergedById.size - sizeBefore;

    state.entries = [...mergedById.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!persistEntries()) {
      state.entries = previousEntries;
      return;
    }
    importedEntries.forEach((entry) => forgetMemoryThumb(entry.id));
    renderSkyAtlas();
    renderMemoryFilters();
    renderHistory();
    pickPrompt();
    hideAtlasPopup();

    showToast(`Imported ${addedCount} new memories.`);
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Could not import that file.");
  }
}

// Moves an imported inline photo into IndexedDB; keeps it inline if that fails.
async function storeImportedPhoto(entry) {
  if (!isInlinePhoto(entry.photoDataUrl)) return entry;
  try {
    await putPhoto(entry.id, dataUrlToBlob(entry.photoDataUrl));
    requestPersistentStorage();
    return { ...entry, photoRef: entry.id, photoDataUrl: "" };
  } catch (err) {
    console.error(`Could not store imported photo (${entry.id}):`, err);
    return entry;
  }
}

async function migrateLegacyPhotoStorage() {
  const legacy = state.entries.filter((entry) => isInlinePhoto(entry.photoDataUrl));
  if (!legacy.length) {
    if (state.entries.some((entry) => entry.photoRef)) requestPersistentStorage();
    return;
  }

  let migratedIds = [];
  try {
    migratedIds = await migrateInlinePhotos(legacy);
  } catch (err) {
    console.error("Photo migration failed:", err);
    return;
  }
  if (!migratedIds.length) return;

  const migrated = new Set(migratedIds);
  const sourceById = new Map(legacy.map((entry) => [entry.id, entry.photoDataUrl]));
  state.entries = state.entries.map((entry) =>
    migrated.has(entry.id) && entry.photoDataUrl === sourceById.get(entry.id)
      ? { ...entry, photoRef: entry.id, photoDataUrl: "" }
      : entry
  );

  const liveIds = new Set(state.entries.map((entry) => entry.id));
  migratedIds
    .filter((id) => !liveIds.has(id))
    .forEach((id) => deletePhoto(id).catch((err) => console.error("Photo cleanup failed:", err)));

  // Only now, with every photo verified in IndexedDB, drop the inline copies.
  if (persistEntries()) {
    migratedIds.forEach((id) => forgetMemoryThumb(id));
    renderHistory();
  }
  requestPersistentStorage();
}

function zoomAtlas(delta, pointerX, pointerY) {
  const previousZoom = state.atlas.zoom;
  state.atlas.zoom = clamp(state.atlas.zoom + delta, state.atlas.minZoom, state.atlas.maxZoom);
  const nextZoom = state.atlas.zoom;

  if (pointerX !== undefined && pointerY !== undefined && previousZoom !== nextZoom) {
    const focusX = (pointerX / skyAtlas.clientWidth) * state.atlas.viewportWidth;
    const focusY = (pointerY / skyAtlas.clientHeight) * state.atlas.viewportHeight;
    state.atlas.x = focusX - ((focusX - state.atlas.x) / previousZoom) * nextZoom;
    state.atlas.y = focusY - ((focusY - state.atlas.y) / previousZoom) * nextZoom;
  }

  clampAtlasPosition();
  applyAtlasTransform();
}

function resetAtlasTransform() {
  state.atlas.zoom = 1;
  syncAtlasMinZoom();
  state.atlas.zoom = Math.max(1, state.atlas.minZoom);
  state.atlas.x = (state.atlas.viewportWidth - WORLD_WIDTH * state.atlas.zoom) / 2;
  state.atlas.y = (state.atlas.viewportHeight - WORLD_HEIGHT * state.atlas.zoom) / 2;
}

function clampAtlasPosition() {
  const scaledWidth = WORLD_WIDTH * state.atlas.zoom;
  const scaledHeight = WORLD_HEIGHT * state.atlas.zoom;

  const minX = Math.min(0, state.atlas.viewportWidth - scaledWidth);
  const minY = Math.min(0, state.atlas.viewportHeight - scaledHeight);
  const maxX = 0;
  const maxY = 0;

  state.atlas.x = clamp(state.atlas.x, minX, maxX);
  state.atlas.y = clamp(state.atlas.y, minY, maxY);
}

function applyAtlasTransform() {
  worldLayer.setAttribute(
    "transform",
    `matrix(${state.atlas.zoom.toFixed(3)} 0 0 ${state.atlas.zoom.toFixed(3)} ${state.atlas.x.toFixed(2)} ${state.atlas.y.toFixed(2)})`
  );
  paintedSky.setTransform(state.atlas.zoom, state.atlas.x, state.atlas.y, state.atlas.viewportWidth, state.atlas.viewportHeight);
}

function recenterLatestEntry() {
  if (!state.latestNode) {
    showToast("Add a reflection to focus on its star.");
    return;
  }

  state.atlas.x = state.atlas.viewportWidth / 2 - state.atlas.zoom * state.latestNode.x;
  state.atlas.y = state.atlas.viewportHeight / 2 - state.atlas.zoom * state.latestNode.y;
  clampAtlasPosition();
  applyAtlasTransform();
  hideAtlasPopup();
}

function showAtlasPopup(entry, event) {
  const current = state.entries.find((item) => item.id === entry.id) || entry;

  atlasPopup.replaceChildren();
  atlasPopup.dataset.topic = current.topic;
  atlasPopup.setAttribute("role", "group");
  atlasPopup.setAttribute("aria-label", `${TOPIC_LABELS[current.topic] || "Memory"} preview`);

  const topic = document.createElement("p");
  topic.className = "popup-topic";
  const dot = document.createElement("span");
  dot.className = "topic-dot";
  dot.setAttribute("aria-hidden", "true");
  topic.append(dot, TOPIC_LABELS[current.topic] || current.topic);

  const date = document.createElement("p");
  date.className = "popup-date";
  date.textContent = formatEntryDay(current.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  const excerpt = document.createElement("p");
  excerpt.className = "popup-excerpt";
  excerpt.textContent = excerptFor(current, 96);

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "popup-open-btn";
  openBtn.dataset.openEntry = current.id;
  openBtn.textContent = "Open memory";

  atlasPopup.append(topic, date, excerpt, openBtn);
  const target = event?.target instanceof Element ? event.target : null;
  const starTarget = target?.closest(".atlas-star") || nodeLayer.querySelector(`.atlas-star[data-entry-id="${CSS.escape(current.id)}"]`);
  atlasReturnFocus = starTarget || target;
  if (starTarget) setRovingStar(starTarget);

  // Keyboard-triggered events have no pointer position; anchor to the star instead.
  const svgRect = skyAtlas.getBoundingClientRect();
  let clientX = event?.clientX;
  let clientY = event?.clientY;
  if (clientX === undefined || (!clientX && !clientY)) {
    const rect = atlasReturnFocus ? atlasReturnFocus.getBoundingClientRect() : svgRect;
    clientX = rect.left + rect.width / 2;
    clientY = rect.top + rect.height / 2;
  }

  atlasPopup.classList.remove("hidden", "below");
  const halfWidth = Math.min(atlasPopup.offsetWidth, svgRect.width - 16) / 2;
  const x = clamp(clientX - svgRect.left, halfWidth + 8, Math.max(halfWidth + 8, svgRect.width - halfWidth - 8));
  const y = clamp(clientY - svgRect.top, 26, svgRect.height - 26);
  // keep clear of the floating title: flip the popup below the star when it would rise into it
  const titleBottom = document.querySelector(".title-wrap").getBoundingClientRect().bottom - svgRect.top;
  atlasPopup.classList.toggle("below", y - atlasPopup.offsetHeight - 18 < Math.max(0, titleBottom + 6));

  atlasPopup.style.left = `${x}px`;
  atlasPopup.style.top = `${y}px`;
}

function hideAtlasPopup() {
  atlasPopup.classList.add("hidden");
}

function updateViewportSize(recenter) {
  const width = Math.max(320, Math.round(skyAtlas.clientWidth));
  const height = Math.max(280, Math.round(skyAtlas.clientHeight));

  state.atlas.viewportWidth = width;
  state.atlas.viewportHeight = height;
  skyAtlas.setAttribute("viewBox", `0 0 ${width} ${height}`);

  syncAtlasMinZoom();

  if (recenter) {
    resetAtlasTransform();
  } else {
    state.atlas.zoom = Math.max(state.atlas.zoom, state.atlas.minZoom);
    clampAtlasPosition();
  }
}

function syncAtlasMinZoom() {
  const coverX = state.atlas.viewportWidth / WORLD_WIDTH;
  const coverY = state.atlas.viewportHeight / WORLD_HEIGHT;
  state.atlas.minZoom = Math.max(0.7, coverX, coverY);
}

function persistEntries() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
    return true;
  } catch (err) {
    console.error("Failed to persist entries:", err);
    showToast("Could not save locally.");
    return false;
  }
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeImportedEntries(parsed);
  } catch {
    return [];
  }
}

function normalizeImportedEntries(input) {
  const source = Array.isArray(input) ? input : Array.isArray(input?.entries) ? input.entries : [];
  const normalized = source
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  const deduped = new Map();
  normalized.forEach((entry) => {
    deduped.set(entry.id, entry);
  });

  return [...deduped.values()];
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const promptId = typeof entry.promptId === "string" ? entry.promptId.trim() : "";
  const promptText = typeof entry.promptText === "string" ? entry.promptText.trim() : "";
  if (!promptId || !promptText) return null;

  const mode = ["offline", "text", "photo"].includes(entry.mode) ? entry.mode : "offline";
  const date = typeof entry.date === "string" && !Number.isNaN(Date.parse(entry.date)) ? entry.date : new Date().toISOString();
  const topic = Object.prototype.hasOwnProperty.call(TOPIC_LABELS, entry.topic) ? entry.topic : "self";
  const depth = DEPTHS.includes(entry.depth) ? entry.depth : "gentle";
  const text = typeof entry.text === "string" ? entry.text : "";
  const followUp = typeof entry.followUp === "string" ? entry.followUp : "";
  const photoDataUrl = typeof entry.photoDataUrl === "string" ? entry.photoDataUrl : "";
  const photoRef = typeof entry.photoRef === "string" ? entry.photoRef.trim() : "";
  const photoSynced =
    typeof entry.photoSynced === "boolean" ? entry.photoSynced : !(photoDataUrl && photoDataUrl.startsWith("data:"));
  const updatedAt =
    typeof entry.updatedAt === "string" && !Number.isNaN(Date.parse(entry.updatedAt)) ? entry.updatedAt : date;

  const idCandidate = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "";
  const fallbackId = `${date}-${Math.abs(hashString(`${promptId}-${promptText}-${text}-${photoDataUrl}`))}`;

  return {
    id: idCandidate || fallbackId,
    date,
    topic,
    topicPicker: Object.prototype.hasOwnProperty.call(TOPIC_LABELS, entry.topicPicker) ? entry.topicPicker : topic,
    depth,
    promptId,
    promptText,
    followUp,
    mode,
    text,
    // Photos may be attached to any entry via edit; photoRef points at IndexedDB.
    photoDataUrl: mode === "photo" || isInlinePhoto(photoDataUrl) ? photoDataUrl : "",
    photoRef,
    photoSynced: mode === "photo" ? photoSynced : true,
    updatedAt,
  };
}

function loadPromptRotation() {
  try {
    return Number(localStorage.getItem(PROMPT_ROTATION_KEY) || 0);
  } catch {
    return 0;
  }
}

function removeLegacySyncKeys() {
  try {
    LEGACY_SYNC_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    console.error("Failed to remove legacy sync keys:", err);
  }
}

// Longer messages stay longer; hovering or focusing the toast holds it until the pointer or focus leaves.
function toastDurationFor(message) {
  return clamp(TOAST_MIN_MS + String(message).length * TOAST_MS_PER_CHAR, TOAST_MIN_MS, TOAST_MAX_MS);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  toastRemaining = toastDurationFor(message);
  scheduleToastHide();
}

function scheduleToastHide() {
  clearTimeout(toastTimer);
  if (toastHeld) return;
  toastShownAt = Date.now();
  toastTimer = setTimeout(() => toast.classList.remove("visible"), toastRemaining);
}

function holdToast() {
  if (!toast.classList.contains("visible") || toastHeld) return;
  toastHeld = true;
  clearTimeout(toastTimer);
  toastRemaining = Math.max(1200, toastRemaining - (Date.now() - toastShownAt));
}

function releaseToast() {
  if (!toastHeld) return;
  toastHeld = false;
  toastRemaining = Math.min(toastRemaining, 1800); // it has been read; let it go soon after
  scheduleToastHide();
}

function openSettingsSheet() {
  const count = state.entries.length;
  exportSummary.textContent = count
    ? `Saves a JSON file with all ${count} ${count === 1 ? "memory" : "memories"}, photos included.`
    : "Nothing to export yet. Your first reflection will be here.";
  openDialog({
    overlay: settingsOverlay,
    panel: settingsSheet,
    returnFocus: openSettingsBtn,
    initialFocus: closeSettingsBtn,
    onRequestClose: closeSettingsSheet,
  });
}

function closeSettingsSheet() {
  closeDialog(settingsOverlay);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createSvg(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });
  return node;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
