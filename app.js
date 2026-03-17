const STORAGE_KEY = "dayByDay.entries.v1";
const PROMPT_ROTATION_KEY = "dayByDay.promptRotation.v1";
const SYNC_META_KEY = "dayByDay.sync.meta.v1";
const SYNC_DELETES_KEY = "dayByDay.sync.deletes.v1";
const API_BASE = "/api";
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
  photoDataUrl: "",
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
  activeMemoryId: "",
  pendingDeleteId: "",
  pendingDeletes: loadPendingDeletes(),
  sync: loadSyncMeta(),
};

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

const skyMeta = document.querySelector("#skyMeta");
const historyList = document.querySelector("#historyList");
const exportDataBtn = document.querySelector("#exportDataBtn");
const importDataBtn = document.querySelector("#importDataBtn");
const importDataInput = document.querySelector("#importDataInput");
const connectSyncBtn = document.querySelector("#connectSyncBtn");
const syncNowBtn = document.querySelector("#syncNowBtn");
const syncStatus = document.querySelector("#syncStatus");
const toast = document.querySelector("#toast");
const atlasPopup = document.querySelector("#atlasPopup");
const confirmOverlay = document.querySelector("#confirmOverlay");
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
  renderHistory();
  renderSyncStatus();
  bindEvents();
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
    localStorage.setItem(PROMPT_ROTATION_KEY, String(state.promptRotation));
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

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) {
      state.photoDataUrl = "";
      photoPreview.classList.add("hidden");
      return;
    }
    state.photoDataUrl = await readFileAsDataUrl(file);
    photoPreview.src = state.photoDataUrl;
    photoPreview.classList.remove("hidden");
  });

  saveEntryBtn.addEventListener("click", saveEntry);

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
    const deleteButton = event.target.closest(".history-delete-btn");
    if (deleteButton) {
      event.stopPropagation();
      openDeleteConfirm(deleteButton.dataset.entryId);
      return;
    }

    const card = event.target.closest(".history-item");
    if (!card) return;
    state.activeMemoryId = state.activeMemoryId === card.dataset.entryId ? "" : card.dataset.entryId;
    renderHistory();
  });

  cancelDeleteBtn.addEventListener("click", closeDeleteConfirm);
  confirmDeleteBtn.addEventListener("click", deleteSelectedMemory);

  exportDataBtn.addEventListener("click", exportEntries);
  importDataBtn.addEventListener("click", () => importDataInput.click());
  importDataInput.addEventListener("change", importEntriesFromFile);
  connectSyncBtn.addEventListener("click", connectSyncVault);
  syncNowBtn.addEventListener("click", syncNow);

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

    if (state.activeMemoryId && !event.target.closest("#historyList")) {
      state.activeMemoryId = "";
      renderHistory();
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
  reflectionSettings.classList.toggle("hidden", isQuick);
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
    return;
  }

  let topic = state.selectedTopic;
  if (topic === "wildcard") topic = chooseWildcardTopic();

  const relevant = state.prompts.filter((prompt) => prompt.topic === topic && prompt.depth === state.selectedDepth);
  const recentPromptIds = new Set(
    state.entries
      .slice(-30)
      .map((entry) => entry.promptId)
      .filter(Boolean)
  );

  let pool = relevant.filter((prompt) => !recentPromptIds.has(prompt.id));
  if (!pool.length) pool = relevant;

  if (!pool.length) {
    state.selectedPrompt = null;
    promptText.textContent = "No prompts found for this setup.";
    followUpText.textContent = "";
    return;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const seed = hashString(`${dayKey}-${topic}-${state.selectedDepth}-${state.entries.length}-${state.promptRotation}`);
  const index = Math.abs(seed) % pool.length;

  state.selectedPrompt = pool[index];
  promptKicker.textContent = TOPIC_LABELS[state.selectedPrompt.topic] || "Prompt";
  promptText.textContent = state.selectedPrompt.text;
  followUpText.textContent = state.selectedPrompt.followUp || "";
}

function chooseWildcardTopic() {
  const topicUsage = {
    self: 0,
    relationships: 0,
    work: 0,
    body: 0,
    gratitude: 0,
    dreams: 0,
  };

  state.entries.slice(-14).forEach((entry) => {
    if (topicUsage[entry.topic] !== undefined) topicUsage[entry.topic] += 1;
  });

  return Object.entries(topicUsage).sort((a, b) => a[1] - b[1])[0][0];
}

function saveEntry() {
  if (!state.selectedPrompt) {
    showToast("Reveal a prompt first.");
    return;
  }

  const text = journalText.value.trim();
  if (state.selectedMode === "text" && !text) {
    showToast("Add a short note, or choose a different method.");
    return;
  }

  if (state.selectedMode === "photo" && !state.photoDataUrl) {
    showToast("Add a photo before saving.");
    return;
  }

  const now = new Date();
  const topicForEntry = state.selectedTopic === "wildcard" ? state.selectedPrompt.topic : state.selectedTopic;

  const entry = {
    id: `${now.toISOString()}-${Math.abs(hashString(state.selectedPrompt.id + state.entries.length))}`,
    date: now.toISOString(),
    topic: topicForEntry,
    topicPicker: state.selectedTopic,
    depth: state.selectedDepth,
    promptId: state.selectedPrompt.id,
    promptText: state.selectedPrompt.text,
    followUp: state.selectedPrompt.followUp || "",
    mode: state.selectedMode,
    text,
    photoDataUrl: state.selectedMode === "photo" ? state.photoDataUrl : "",
    photoSynced: state.selectedMode !== "photo",
    updatedAt: now.toISOString(),
  };

  state.entries.push(entry);
  persistEntries();

  journalText.value = "";
  photoInput.value = "";
  state.photoDataUrl = "";
  photoPreview.src = "";
  photoPreview.classList.add("hidden");

  renderSkyAtlas(entry);
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

function renderHistory() {
  historyList.innerHTML = "";

  const latest = [...state.entries].reverse().slice(0, 16);
  if (!latest.length) {
    const empty = document.createElement("p");
    empty.className = "history-meta";
    empty.textContent = "No memories yet. Add your first reflection from the + button.";
    historyList.append(empty);
    return;
  }

  latest.forEach((entry) => {
    const card = document.createElement("article");
    card.className = `history-item ${entry.id === state.activeMemoryId ? "active" : ""}`;
    card.dataset.entryId = entry.id;

    const meta = document.createElement("p");
    meta.className = "history-meta";
    const day = new Date(entry.date).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    meta.textContent = `${day} • ${TOPIC_LABELS[entry.topic] || entry.topic} • ${entry.depth}`;

    const prompt = document.createElement("p");
    prompt.className = "history-text";
    prompt.textContent = entry.promptText;

    card.append(meta, prompt);

    if (entry.text) {
      const note = document.createElement("p");
      note.className = "history-meta";
      note.textContent = `"${truncate(entry.text, 150)}"`;
      card.append(note);
    }

    if (entry.photoDataUrl) {
      const img = document.createElement("img");
      img.className = "history-thumb";
      img.src = entry.photoDataUrl;
      img.alt = "Reflection photo";
      card.append(img);
    }

    if (entry.id === state.activeMemoryId) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "history-delete-btn";
      deleteBtn.dataset.entryId = entry.id;
      deleteBtn.setAttribute("aria-label", "Delete memory");
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M7 6l1 14h8l1-14" /><path d="M10 10v6" /><path d="M14 10v6" /></svg>';
      card.append(deleteBtn);
    }

    historyList.append(card);
  });
}

function openDeleteConfirm(entryId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  const day = new Date(entry.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  state.pendingDeleteId = entryId;
  confirmText.textContent = `Delete ${TOPIC_LABELS[entry.topic]} memory from ${day}? This cannot be undone.`;
  confirmOverlay.classList.remove("hidden");
}

function closeDeleteConfirm() {
  state.pendingDeleteId = "";
  confirmOverlay.classList.add("hidden");
}

function deleteSelectedMemory() {
  if (!state.pendingDeleteId) {
    closeDeleteConfirm();
    return;
  }

  const deletedAt = new Date().toISOString();
  state.pendingDeletes = state.pendingDeletes.filter((item) => item.id !== state.pendingDeleteId);
  state.pendingDeletes.push({ id: state.pendingDeleteId, deletedAt });
  persistPendingDeletes();

  const nextEntries = state.entries.filter((entry) => entry.id !== state.pendingDeleteId);
  state.entries = nextEntries;
  state.activeMemoryId = "";
  persistEntries();
  closeDeleteConfirm();

  renderSkyAtlas();
  renderHistory();
  pickPrompt();
  hideAtlasPopup();
  showToast("Memory deleted.");
}

function exportEntries() {
  if (!state.entries.length) {
    showToast("No memories to export yet.");
    return;
  }

  const payload = {
    app: "day-by-day",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const fileDate = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `day-by-day-backup-${fileDate}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("Memories exported.");
}

async function importEntriesFromFile() {
  const file = importDataInput.files?.[0];
  importDataInput.value = "";

  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedEntries = normalizeImportedEntries(parsed);

    if (!importedEntries.length) {
      showToast("No valid memories found in file.");
      return;
    }

    const mergedById = new Map();
    state.entries.forEach((entry) => mergedById.set(entry.id, entry));
    const sizeBefore = mergedById.size;
    importedEntries.forEach((entry) => mergedById.set(entry.id, entry));
    const addedCount = mergedById.size - sizeBefore;

    state.entries = [...mergedById.values()].sort((a, b) => a.date.localeCompare(b.date));
    persistEntries();
    renderSkyAtlas();
    renderHistory();
    pickPrompt();
    hideAtlasPopup();

    showToast(`Imported ${addedCount} new memories.`);
  } catch (err) {
    console.error("Import failed:", err);
    showToast("Could not import that file.");
  }
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
  const day = new Date(entry.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  atlasPopup.innerHTML = `<p class="popup-topic">${TOPIC_LABELS[entry.topic]}</p><p class="popup-date">${day}</p>`;

  const svgRect = skyAtlas.getBoundingClientRect();
  const x = clamp(event.clientX - svgRect.left, 26, svgRect.width - 26);
  const y = clamp(event.clientY - svgRect.top, 26, svgRect.height - 26);

  atlasPopup.style.left = `${x}px`;
  atlasPopup.style.top = `${y}px`;
  atlasPopup.classList.remove("hidden");
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
  } catch (err) {
    console.error("Failed to persist entries:", err);
    showToast("Could not save locally.");
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
    photoDataUrl: mode === "photo" ? photoDataUrl : "",
    photoSynced: mode === "photo" ? photoSynced : true,
    updatedAt,
  };
}

function renderSyncStatus() {
  const isConnected = Boolean(state.sync?.connected);
  const isSyncing = Boolean(state.sync?.syncing);

  connectSyncBtn.textContent = isConnected ? "Sync connected" : "Connect sync";
  connectSyncBtn.classList.toggle("subdued", isConnected);
  syncNowBtn.disabled = !isConnected || isSyncing;
  syncNowBtn.textContent = isSyncing ? "Syncing..." : "Sync now";

  if (!isConnected) {
    syncStatus.textContent = "Local-only mode. Connect to sync across devices.";
    return;
  }

  if (state.sync.lastSyncedAt) {
    const stamp = new Date(state.sync.lastSyncedAt).toLocaleString();
    syncStatus.textContent = `Connected. Last synced ${stamp}.`;
    return;
  }

  syncStatus.textContent = "Connected. Your data stays local until you tap Sync now.";
}

async function connectSyncVault() {
  if (state.sync.connected) {
    showToast("Sync is already connected.");
    return;
  }

  const key = window.prompt("Enter your sync key to connect. Leave blank to create a new one.");
  if (key === null) return;

  try {
    if (key.trim()) {
      await joinSyncVault(key.trim());
    } else {
      await createSyncVault();
    }
    renderSyncStatus();
  } catch (err) {
    console.error("Sync connect failed:", err);
    showToast("Could not connect sync.");
  }
}

async function createSyncVault() {
  const res = await apiFetch(`${API_BASE}/sync/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  state.sync = {
    ...state.sync,
    connected: true,
    syncing: false,
    userId: res.userId,
    cursor: Number(res.cursor || 0),
    lastSyncedAt: "",
    lastError: "",
  };
  persistSyncMeta();
  renderSyncStatus();

  window.prompt("Save this sync key in a safe place. You need it to reconnect on a new device.", res.syncKey);
  showToast("Sync vault created.");
}

async function joinSyncVault(syncKey) {
  const res = await apiFetch(`${API_BASE}/sync/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ syncKey }),
  });

  state.sync = {
    ...state.sync,
    connected: true,
    syncing: false,
    userId: res.userId,
    cursor: Number(res.cursor || 0),
    lastError: "",
  };
  persistSyncMeta();
  showToast("Sync connected.");
}

async function syncNow() {
  if (!state.sync.connected) {
    showToast("Connect sync first.");
    return;
  }

  state.sync.syncing = true;
  renderSyncStatus();

  try {
    await pushLocalChanges();
    let pulledCount = 0;
    do {
      pulledCount = await pullRemoteChanges();
    } while (pulledCount === 500);
    state.sync.lastSyncedAt = new Date().toISOString();
    state.sync.lastError = "";
    persistSyncMeta();
    persistEntries();
    renderSkyAtlas();
    renderHistory();
    showToast("Sync complete.");
  } catch (err) {
    console.error("Sync failed:", err);
    state.sync.lastError = err.message || "Sync failed";
    persistSyncMeta();
    showToast("Sync failed. Try again.");
  } finally {
    state.sync.syncing = false;
    renderSyncStatus();
  }
}

async function pushLocalChanges() {
  const entriesPayload = [];

  for (const entry of state.entries) {
    let uploadedPhotoKey = "";
    if (entry.mode === "photo" && !entry.photoSynced && entry.photoDataUrl?.startsWith("data:")) {
      uploadedPhotoKey = await uploadEntryPhoto(entry.id, entry.photoDataUrl);
      if (uploadedPhotoKey) {
        entry.photoSynced = true;
      }
    }
    entriesPayload.push(serializeEntryForCloud(entry, uploadedPhotoKey));
  }

  const res = await apiFetch(`${API_BASE}/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entries: entriesPayload,
      deletes: state.pendingDeletes,
    }),
  });

  state.pendingDeletes = [];
  persistPendingDeletes();
  state.sync.cursor = Number(res.cursor || state.sync.cursor || 0);
  persistSyncMeta();
}

function serializeEntryForCloud(entry, uploadedPhotoKey) {
  const hasRemotePhoto =
    Boolean(uploadedPhotoKey) ||
    Boolean(entry.photoSynced) ||
    (entry.mode === "photo" && Boolean(entry.photoDataUrl) && !entry.photoDataUrl.startsWith("data:"));

  return {
    id: entry.id,
    date: entry.date,
    topic: entry.topic,
    topicPicker: entry.topicPicker,
    depth: entry.depth,
    promptId: entry.promptId,
    promptText: entry.promptText,
    followUp: entry.followUp,
    mode: entry.mode,
    text: entry.text,
    updatedAt: entry.updatedAt || entry.date,
    hasPhoto: hasRemotePhoto,
    photoKey: uploadedPhotoKey || null,
  };
}

async function uploadEntryPhoto(entryId, photoDataUrl) {
  const res = await apiFetch(`${API_BASE}/photos/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId, photoDataUrl }),
  });
  return typeof res.photoKey === "string" ? res.photoKey : "";
}

async function pullRemoteChanges() {
  const since = Number(state.sync.cursor || 0);
  const res = await apiFetch(`${API_BASE}/sync/pull?since=${since}`);
  const remoteChanges = Array.isArray(res.changes) ? res.changes : [];
  if (!remoteChanges.length) {
    state.sync.cursor = Number(res.cursor || since);
    persistSyncMeta();
    return 0;
  }

  const entryMap = new Map(state.entries.map((entry) => [entry.id, entry]));

  remoteChanges.forEach((change) => {
    if (change.op === "delete") {
      entryMap.delete(change.id);
      state.pendingDeletes = state.pendingDeletes.filter((item) => item.id !== change.id);
      return;
    }

    const normalized = normalizeCloudEntry(change.entry);
    if (!normalized) return;

    const local = entryMap.get(normalized.id);
    if (!local) {
      entryMap.set(normalized.id, normalized);
      return;
    }

    const localStamp = Date.parse(local.updatedAt || local.date);
    const remoteStamp = Date.parse(normalized.updatedAt || normalized.date);
    if (Number.isNaN(localStamp) || remoteStamp >= localStamp) {
      entryMap.set(normalized.id, normalized);
    }
  });

  state.entries = [...entryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  persistPendingDeletes();
  state.sync.cursor = Number(res.cursor || since);
  persistSyncMeta();
  return remoteChanges.length;
}

function normalizeCloudEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  return normalizeEntry({
    id: entry.id,
    date: entry.date,
    topic: entry.topic,
    topicPicker: entry.topicPicker,
    depth: entry.depth,
    promptId: entry.promptId,
    promptText: entry.promptText,
    followUp: entry.followUp,
    mode: entry.mode,
    text: entry.text,
    photoDataUrl:
      entry.mode === "photo" && entry.hasPhoto
        ? `${API_BASE}/photos/view?entryId=${encodeURIComponent(entry.id)}`
        : "",
    photoSynced: entry.mode === "photo" && entry.hasPhoto,
    updatedAt: entry.updatedAt,
  });
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    ...options,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok || payload?.ok === false) {
    const message = payload?.error?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return payload;
}

function loadPromptRotation() {
  try {
    return Number(localStorage.getItem(PROMPT_ROTATION_KEY) || 0);
  } catch {
    return 0;
  }
}

function loadSyncMeta() {
  const defaults = {
    connected: false,
    syncing: false,
    userId: "",
    cursor: 0,
    lastSyncedAt: "",
    lastError: "",
  };

  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      connected: Boolean(parsed.connected),
      syncing: false,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
      cursor: Number(parsed.cursor || 0),
      lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : "",
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : "",
    };
  } catch {
    return defaults;
  }
}

function persistSyncMeta() {
  try {
    localStorage.setItem(
      SYNC_META_KEY,
      JSON.stringify({
        connected: state.sync.connected,
        userId: state.sync.userId,
        cursor: state.sync.cursor,
        lastSyncedAt: state.sync.lastSyncedAt,
        lastError: state.sync.lastError,
      })
    );
  } catch (err) {
    console.error("Failed to persist sync meta:", err);
  }
}

function loadPendingDeletes() {
  try {
    const raw = localStorage.getItem(SYNC_DELETES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && typeof item.deletedAt === "string");
  } catch {
    return [];
  }
}

function persistPendingDeletes() {
  try {
    localStorage.setItem(SYNC_DELETES_KEY, JSON.stringify(state.pendingDeletes));
  } catch (err) {
    console.error("Failed to persist pending deletes:", err);
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
