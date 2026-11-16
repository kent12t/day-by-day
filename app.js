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
const MILESTONES = new Set([7, 30, 100, 180, 365]);

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

const TOPIC_COLORS = {
  self: "#ffd58a",
  relationships: "#f6a7bd",
  work: "#9bbcff",
  body: "#8dd8c5",
  gratitude: "#d8a5f0",
  dreams: "#8fd8ff",
  creativity: "#ffb347",
  nature: "#90be6d",
  spirit: "#9a8c98",
  legacy: "#e29578",
  wildcard: "#ffe58f",
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
    lastX: 0,
    lastY: 0,
    dragDistance: 0,
    clickBlocked: false,
  },
  latestNode: null,
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

init();

async function init() {
  removeLegacySyncKeys();

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
  await migrateLegacyPhotoStorage();
}

function bindEvents() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.go));
  });

  revealPromptBtn.addEventListener("click", () => {
    promptFlipCard.classList.add("revealed");
    if (!state.selectedPrompt) pickPrompt();
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

  exportDataBtn.addEventListener("click", exportEntries);
  importDataBtn.addEventListener("click", () => importDataInput.click());
  importDataInput.addEventListener("change", importEntriesFromFile);

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
      zoomAtlas(event.deltaY > 0 ? -0.08 : 0.08, event.offsetX, event.offsetY);
    },
    { passive: false }
  );

  skyAtlas.addEventListener("pointerdown", (event) => {
    state.atlas.dragging = true;
    state.atlas.pointerId = event.pointerId;
    state.atlas.lastX = event.clientX;
    state.atlas.lastY = event.clientY;
    state.atlas.dragDistance = 0;
    skyAtlas.classList.add("dragging");
    skyAtlas.setPointerCapture(event.pointerId);
    hideAtlasPopup();
  });

  skyAtlas.addEventListener("pointermove", (event) => {
    if (!state.atlas.dragging || state.atlas.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.atlas.lastX;
    const dy = event.clientY - state.atlas.lastY;
    state.atlas.dragDistance += Math.abs(dx) + Math.abs(dy);
    const viewUnitsX = (dx / skyAtlas.clientWidth) * state.atlas.viewportWidth;
    const viewUnitsY = (dy / skyAtlas.clientHeight) * state.atlas.viewportHeight;

    state.atlas.x += viewUnitsX;
    state.atlas.y += viewUnitsY;
    state.atlas.lastX = event.clientX;
    state.atlas.lastY = event.clientY;

    clampAtlasPosition();
    applyAtlasTransform();
  });

  const endDrag = (event) => {
    if (state.atlas.pointerId !== null && event.pointerId !== state.atlas.pointerId) return;

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
  };

  skyAtlas.addEventListener("pointerup", endDrag);
  skyAtlas.addEventListener("pointercancel", endDrag);

  window.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#skyAtlas") && !event.target.closest("#atlasPopup")) {
      hideAtlasPopup();
    }
  });
}

function setActiveView(viewName) {
  state.activeView = viewName;

  viewSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.view === viewName);
  });

  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.go === viewName && button.classList.contains("nav-btn"));
  });

  if (viewName === "reflect") {
    promptFlipCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
  const links = makeLinks(nodes);

  skyMeta.textContent = `${state.entries.length} reflection${state.entries.length === 1 ? "" : "s"} so far`;

  renderAtmosphere();
  renderNebula(nodes);

  links.forEach((link) => {
    const line = createSvg("line", {
      x1: link.from.x,
      y1: link.from.y,
      x2: link.to.x,
      y2: link.to.y,
      stroke: "rgba(235, 244, 255, 0.28)",
      "stroke-width": String(link.strength),
      "stroke-linecap": "round",
    });
    linkLayer.append(line);
  });

  nodes.forEach((node, index) => {
    const entry = state.entries[index];
    const fill = TOPIC_COLORS[node.topic] || TOPIC_COLORS.self;
    const shape = makeNodeShape(node, fill);
    shape.classList.add("node");
    shape.style.animationDelay = `${(index % 9) * 0.31}s`;
    shape.setAttribute("filter", "url(#softGlow)");
    shape.setAttribute("tabindex", "0");
    shape.setAttribute("role", "button");
    shape.setAttribute("aria-label", `${TOPIC_LABELS[node.topic]} entry`);
    shape.addEventListener("click", (event) => {
      if (state.atlas.clickBlocked) return;
      showAtlasPopup(entry, event);
    });
    nodeLayer.append(shape);
  });

  if (newEntry) {
    const freshNode = nodes[nodes.length - 1];
    const burst = createSvg("circle", {
      cx: freshNode.x,
      cy: freshNode.y,
      r: "22",
      fill: "none",
      stroke: "rgba(253, 218, 166, 0.82)",
      "stroke-width": "2",
    });
    burst.classList.add("new-burst");
    eventLayer.append(burst);
  }

  if (MILESTONES.has(state.entries.length)) {
    const comet = createSvg("path", {
      d: "M 180 140 Q 680 50 1340 210",
      stroke: "rgba(255, 229, 184, 0.82)",
      "stroke-width": "3",
      "stroke-linecap": "round",
      "stroke-dasharray": "8 11",
      fill: "none",
    });
    eventLayer.append(comet);
  }
}

function makeNodeShape(node, fill) {
  if (node.shape === "diamond") {
    return createSvg("path", {
      d: `M ${node.x} ${node.y - node.size} L ${node.x + node.size} ${node.y} L ${node.x} ${node.y + node.size} L ${node.x - node.size} ${node.y} Z`,
      fill,
    });
  }

  if (node.shape === "spark") {
    return createSvg("path", {
      d: `M ${node.x} ${node.y - node.size} L ${node.x + node.size * 0.3} ${node.y - node.size * 0.3} L ${node.x + node.size} ${node.y} L ${node.x + node.size * 0.3} ${node.y + node.size * 0.3} L ${node.x} ${node.y + node.size} L ${node.x - node.size * 0.3} ${node.y + node.size * 0.3} L ${node.x - node.size} ${node.y} L ${node.x - node.size * 0.3} ${node.y - node.size * 0.3} Z`,
      fill,
    });
  }

  return createSvg("circle", {
    cx: node.x,
    cy: node.y,
    r: node.size,
    fill,
  });
}

function renderAtmosphere() {
  for (let i = 0; i < 36; i += 1) {
    const rng = mulberry32(hashString(`ambient-${i}`));
    const dot = createSvg("circle", {
      cx: String(26 + rng() * (WORLD_WIDTH - 52)),
      cy: String(26 + rng() * (WORLD_HEIGHT - 52)),
      r: String(0.9 + rng() * 1.8),
      fill: "rgba(220, 236, 255, 0.5)",
    });
    dot.classList.add("ambient-dot");
    dot.style.animationDelay = `${rng() * 3}s`;
    atmosphereLayer.append(dot);
  }

  const variety = new Set(state.entries.slice(-7).map((entry) => entry.topic)).size;
  if (variety >= 3) {
    const aurora = createSvg("path", {
      d: "M 0 640 Q 340 560 700 620 T 1600 580",
      stroke: "rgba(153, 210, 255, 0.24)",
      "stroke-width": "38",
      fill: "none",
      opacity: "0.82",
    });
    aurora.setAttribute("filter", "url(#nebulaBlur)");
    atmosphereLayer.append(aurora);
  }
}

function renderNebula(nodes) {
  const deepNodes = nodes.filter((node) => node.depth !== "gentle");
  deepNodes.forEach((node, index) => {
    if (index % 2 !== 0) return;
    const cloud = createSvg("ellipse", {
      cx: node.x,
      cy: node.y,
      rx: String(34 + (index % 3) * 11),
      ry: String(16 + (index % 4) * 7),
      fill: "rgba(166, 145, 255, 0.19)",
      opacity: "0.48",
    });
    cloud.setAttribute("filter", "url(#nebulaBlur)");
    nebulaLayer.append(cloud);
  });

  if (!nodes.length) {
    renderWrappedAtlasHint("Your first reflection will light this atlas.");
  }
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

  const meta = document.createElement("span");
  meta.className = "history-meta";
  const dot = document.createElement("span");
  dot.className = "topic-dot";
  dot.setAttribute("aria-hidden", "true");
  meta.append(dot, `${formatEntryDay(entry.date)} • ${TOPIC_LABELS[entry.topic] || entry.topic} • ${entry.depth}`);

  const prompt = document.createElement("span");
  prompt.className = "history-text";
  prompt.textContent = entry.promptText;

  card.append(meta, prompt);

  if (entry.text) {
    const note = document.createElement("span");
    note.className = "history-meta history-note";
    note.textContent = `"${truncate(entry.text, 150)}"`;
    card.append(note);
  }

  if (entryHasPhoto(entry)) {
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
  atlasReturnFocus = event?.target instanceof Element ? event.target : null;

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
  atlasPopup.classList.toggle("below", y < atlasPopup.offsetHeight + 18);

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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
  }, 1900);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
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
