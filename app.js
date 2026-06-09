// Pool Builder - Sealed Pool Generator & Deckbuilder
import {
  fetchSets,
  fetchWithRetry,
  generateSealedPoolFromMtgjson,
} from 'https://bensonperry.com/shared/mtg.js';
import { modal } from './vendor/vellum-ui/modal.js';
import { combobox } from './vendor/vellum-ui/combobox.js';

// ============ Theme Toggle ============
function applyTheme(theme) {
  const toggle = document.getElementById('theme-toggle');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (toggle) toggle.innerHTML = '<span class="theme-icon">☀</span> light';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (toggle) toggle.innerHTML = '<span class="theme-icon">☽</span> dark';
  }
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('theme', next);
    });
  }
})();

// State
let sets = [];
let currentPool = [];
let deck = [];
let basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
let basicLandCards = {};
let currentSort = 'color';
let currentDeckSort = 'cmc';
let hiddenPoolColumns = { color: new Set(), rarity: new Set(), cmc: new Set() };
let currentMode = 'daily';
let selectedSet = null;
let dailyWelcomeModal = null;
let dailyWelcomeShown = false;

// Submission state
let mySubmission = null;
let allSubmissions = null;
let submissionMeta = null;
let dailyReference = null;
let currentDaily = null;
let loadedDailyDate = null;
const API_URL = getApiUrl();

// Basic land names
const BASIC_LAND_NAMES = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest'
};

const BUILDER_PREFS_KEY = 'pb-builder-layout';
const BUILDER_MIN_DECK_HEIGHT = 180;
const BUILDER_MAX_DECK_HEIGHT = 720;
const DEFAULT_DECK_CARD_SIZE = 150;
const DEFAULT_POOL_CARD_SIZE = 155;

function getApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('api');
  if (override) {
    localStorage.setItem('pb-api-url', override);
    return override.replace(/\/$/, '');
  }
  return (localStorage.getItem('pb-api-url') || 'https://poolbuilder-api.bensonperry.workers.dev').replace(/\/$/, '');
}

function isLocalDev() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function isResultsRoute() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'results' || params.get('results') === 'today' || window.location.hash === '#results';
}

function setDailyRoute(view, { replace = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.delete('cache');
  url.searchParams.delete('preview');
  url.searchParams.delete('results');
  if (view === 'results') {
    url.searchParams.set('view', 'results');
  } else {
    url.searchParams.delete('view');
  }
  url.hash = '';

  const nextUrl = url.pathname + url.search + url.hash;
  if (nextUrl === window.location.pathname + window.location.search + window.location.hash) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', nextUrl);
}

function showSubmissionMessage(message) {
  submissionTeaser.textContent = message;
  submissionTeaser.classList.remove('hidden');
}

// DOM elements
const setInput = document.getElementById('set-input');
const setSelect = document.getElementById('set-select');
const generateBtn = document.getElementById('generate-btn');
const generatorControls = document.getElementById('generator-controls');
const dailyControls = document.getElementById('daily-controls');
const loadingEl = document.getElementById('loading');
const poolSection = document.getElementById('pool-section');
const poolGrid = document.getElementById('pool-grid');
const deckGrid = document.getElementById('deck-grid');
const poolCount = document.getElementById('pool-count');
const deckCount = document.getElementById('deck-count');
const dailySetName = document.getElementById('daily-set-name');
const dailySeed = document.getElementById('daily-seed');
const submitBtn = document.getElementById('submit-deck');
const viewResultsBtn = document.getElementById('view-results');
const resultsSection = document.getElementById('results-section');
const resultsReference = document.getElementById('results-reference');
const submissionTeaser = document.getElementById('submission-teaser');
const deckArea = document.getElementById('deck-area');
const poolArea = document.getElementById('pool-area');
const builderDivider = document.getElementById('builder-divider');
const deckSizeInput = document.getElementById('deck-card-size');
const poolSizeInput = document.getElementById('pool-card-size');
const poolHiddenColumnsEl = document.getElementById('pool-hidden-columns');
const dailyWelcomeModalEl = document.getElementById('daily-welcome-modal');

// Initialize
async function init() {
  try {
    const cutoff = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    sets = (await fetchSets()).filter(s => s.released <= cutoff);

    // Set search via vellum combobox
    setupSetCombobox();

    // Pre-select first set
    if (sets.length > 0) {
      applySetSelection(sets[0]);
    }

    setInput.disabled = false;
    setInput.placeholder = 'type to search sets...';

    setupEventListeners();
    setupBuilderLayoutControls();
    setupDailyWelcomeModal();
    updateDailyInfo();

    // Auto-load daily challenge on startup
    handleDailyGenerate();
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
}

function handleSetSelect(set) {
  selectedSet = set;
  generateBtn.disabled = false;
}

function formatSetDisplay(set) {
  return set.name.toLowerCase() + ' (' + set.released.slice(0, 4) + ')';
}

let selectedSetDisplay = '';

function applySetSelection(set) {
  selectedSetDisplay = formatSetDisplay(set);
  setInput.value = selectedSetDisplay;
  setSelect.value = set.code;
  handleSetSelect(set);
}

function setupSetCombobox() {
  // Stash the chosen set's display text and clear on focus so the list opens
  // unfiltered. Registered before combobox() so its focus refresh sees the
  // cleared value.
  setInput.addEventListener('focus', () => {
    if (setInput.value) selectedSetDisplay = setInput.value;
    setInput.value = '';
  });
  setInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!setInput.value && selectedSetDisplay) setInput.value = selectedSetDisplay;
    }, 150);
  });
  combobox(setInput, {
    getItems: query => {
      const filter = query.toLowerCase();
      return sets.filter(
        s => s.name.toLowerCase().includes(filter) || s.code.toLowerCase().includes(filter)
      );
    },
    onSelect: set => {
      applySetSelection(set);
      setInput.blur();
    },
    toLabel: set => set.name.toLowerCase(),
    toHint: set => '(' + set.released.slice(0, 4) + ')',
    toDataset: set => ({ code: set.code }),
    maxItems: 200,
  });
}

// Setup event listeners (non-autocomplete)
function setupEventListeners() {
  // Mode links
  document.querySelectorAll('.mode-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      handleModeToggle(link.dataset.mode);
    });
  });

  // Generate buttons
  generateBtn.addEventListener('click', handleGenerate);

  // Sort buttons
  document.getElementById('sort-color').addEventListener('click', () => setSort('color'));
  document.getElementById('sort-rarity').addEventListener('click', () => setSort('rarity'));
  document.getElementById('sort-cmc').addEventListener('click', () => setSort('cmc'));
  document.getElementById('deck-sort-color').addEventListener('click', () => setDeckSort('color'));
  document.getElementById('deck-sort-rarity').addEventListener('click', () => setDeckSort('rarity'));
  document.getElementById('deck-sort-cmc').addEventListener('click', () => setDeckSort('cmc'));

  // Clear deck
  document.getElementById('clear-deck').addEventListener('click', clearDeck);

  // Submission buttons
  submitBtn.addEventListener('click', submitDeck);
  viewResultsBtn.addEventListener('click', () => showResults({ updateUrl: true }));
  document.getElementById('back-to-deck').addEventListener('click', () => hideResults({ updateUrl: true }));
  window.addEventListener('popstate', handleRouteChange);

  // Pool info toggle
  const infoToggle = document.getElementById('pool-info-toggle');
  const infoPanel = document.getElementById('pool-info');
  infoToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = infoPanel.classList.toggle('hidden');
    infoToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  document.addEventListener('click', (e) => {
    if (infoPanel.classList.contains('hidden')) return;
    if (infoPanel.contains(e.target) || infoToggle.contains(e.target)) return;
    infoPanel.classList.add('hidden');
    infoToggle.setAttribute('aria-expanded', 'false');
  });
}

function setupBuilderLayoutControls() {
  if (!deckArea || !poolArea) return;

  const defaults = getDefaultBuilderLayout();
  const saved = readBuilderPrefs();
  const prefs = {
    deckCardSize: DEFAULT_DECK_CARD_SIZE,
    poolCardSize: DEFAULT_POOL_CARD_SIZE,
    deckHeight: defaults.deckHeight,
    ...saved,
  };

  applySectionCardSize(deckArea, deckSizeInput, prefs.deckCardSize);
  applySectionCardSize(poolArea, poolSizeInput, prefs.poolCardSize);
  applyBuilderDeckHeight(prefs.deckHeight);

  deckSizeInput?.addEventListener('input', () => {
    applySectionCardSize(deckArea, deckSizeInput, Number(deckSizeInput.value));
    saveCurrentBuilderPrefs();
  });

  poolSizeInput?.addEventListener('input', () => {
    applySectionCardSize(poolArea, poolSizeInput, Number(poolSizeInput.value));
    saveCurrentBuilderPrefs();
  });

  setupBuilderDivider();
}

function setupBuilderDivider() {
  if (!builderDivider || !deckArea) return;

  let dragState = null;

  builderDivider.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      deckHeight: deckArea.getBoundingClientRect().height,
    };
    builderDivider.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing-builder');
  });

  builderDivider.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    resizeBuilderPanes(dragState, event.clientY - dragState.startY);
  });

  const finishDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    builderDivider.releasePointerCapture?.(event.pointerId);
    dragState = null;
    document.body.classList.remove('resizing-builder');
    saveCurrentBuilderPrefs();
  };

  builderDivider.addEventListener('pointerup', finishDrag);
  builderDivider.addEventListener('pointercancel', finishDrag);

  builderDivider.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 24;
    adjustBuilderPanes(event.key === 'ArrowDown' ? step : -step);
  });

  builderDivider.addEventListener('dblclick', () => {
    const defaults = getDefaultBuilderLayout();
    applyBuilderDeckHeight(defaults.deckHeight);
    saveCurrentBuilderPrefs();
  });
}

function resizeBuilderPanes(startState, deltaY) {
  const deckHeight = clampNumber(startState.deckHeight + deltaY, BUILDER_MIN_DECK_HEIGHT, getMaxDeckHeight());
  applyBuilderDeckHeight(deckHeight);
}

function adjustBuilderPanes(deltaY) {
  const startState = {
    deckHeight: deckArea.getBoundingClientRect().height,
  };
  resizeBuilderPanes(startState, deltaY);
  saveCurrentBuilderPrefs();
}

function applyBuilderDeckHeight(deckHeight) {
  const height = deckHeight ?? getDefaultBuilderLayout().deckHeight;
  deckArea.style.setProperty('--builder-deck-height', Math.round(clampNumber(height, BUILDER_MIN_DECK_HEIGHT, getMaxDeckHeight())) + 'px');
}

function applySectionCardSize(area, input, rawSize) {
  const size = clampNumber(rawSize, 110, 220);
  area.style.setProperty('--card-column-width', size + 'px');
  area.style.setProperty('--card-stack-overlap', Math.round(size * -1.18) + 'px');
  if (input) input.value = String(size);
}

function saveCurrentBuilderPrefs() {
  if (!deckArea || !poolArea) return;
  const prefs = {
    deckCardSize: Number(deckSizeInput?.value) || DEFAULT_DECK_CARD_SIZE,
    poolCardSize: Number(poolSizeInput?.value) || DEFAULT_POOL_CARD_SIZE,
    deckHeight: Math.round(deckArea.getBoundingClientRect().height),
  };
  localStorage.setItem(BUILDER_PREFS_KEY, JSON.stringify(prefs));
}

function readBuilderPrefs() {
  try {
    const raw = localStorage.getItem(BUILDER_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const prefs = {
      deckCardSize: sanitizeNumber(parsed.deckCardSize, DEFAULT_DECK_CARD_SIZE, 110, 220),
      poolCardSize: sanitizeNumber(parsed.poolCardSize, DEFAULT_POOL_CARD_SIZE, 110, 220),
    };
    const deckHeight = sanitizeNumber(parsed.deckHeight, null, BUILDER_MIN_DECK_HEIGHT, BUILDER_MAX_DECK_HEIGHT);
    if (deckHeight != null) prefs.deckHeight = deckHeight;
    return prefs;
  } catch {
    return {};
  }
}

function getDefaultBuilderLayout() {
  const availableHeight = Math.max(640, window.innerHeight - 210);
  return {
    deckHeight: clampNumber(Math.round(availableHeight * 0.36), 230, 380),
  };
}

function getMaxDeckHeight() {
  return clampNumber(Math.round(window.innerHeight * 0.72), 360, BUILDER_MAX_DECK_HEIGHT);
}

function sanitizeNumber(value, fallback, min, max) {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? clampNumber(number, min, max) : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setupDailyWelcomeModal() {
  dailyWelcomeModal = modal(dailyWelcomeModalEl);
}

function maybeShowDailyWelcome() {
  if (currentMode !== 'daily' || isResultsRoute() || dailyWelcomeShown || !dailyWelcomeModal || !dailyWelcomeModalEl) return;
  dailyWelcomeShown = true;
  window.setTimeout(() => {
    if (currentMode === 'daily' && !isResultsRoute()) dailyWelcomeModal.open();
  }, 200);
}

// Mode toggle
function handleModeToggle(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-link').forEach(link => {
    link.classList.toggle('active', link.dataset.mode === mode);
  });
  generatorControls.classList.toggle('hidden', mode !== 'generator');
  dailyControls.classList.toggle('hidden', mode !== 'daily');
  resultsSection.classList.add('hidden');

  if (mode === 'daily') {
    handleDailyGenerate();
  } else {
    submitBtn.classList.add('hidden');
    viewResultsBtn.classList.add('hidden');
    submissionTeaser.classList.add('hidden');
    poolSection.classList.add('hidden');
    currentPool = [];
    deck = [];
    basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    loadedDailyDate = null;
    currentDaily = null;
    dailyReference = null;
    mySubmission = null;
    allSubmissions = null;
    submissionMeta = null;
  }
}

function handleRouteChange() {
  if (currentMode !== 'daily' || !loadedDailyDate) return;
  if (isResultsRoute()) {
    if (mySubmission) {
      showResults({ updateUrl: false });
    } else {
      showSubmissionMessage('submit a deck to reveal today\'s results');
    }
  } else {
    hideResults({ updateUrl: false });
  }
}

// Daily challenge
function updateDailyInfo() {
  dailySetName.textContent = 'daily challenge';
  dailySeed.textContent = 'loading';
}

// Generate pool
async function handleGenerate() {
  if (!selectedSet) return;
  await generatePool(selectedSet.code);
}

async function handleDailyGenerate() {
  loadingEl.classList.remove('hidden');
  poolSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  resetSubmissionState();
  const shouldOpenResults = isResultsRoute();

  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch('daily.json?v=' + today);
    if (!res.ok) {
      throw new Error(`daily.json returned ${res.status}`);
    }

    const daily = await res.json();
    if (daily.date !== today || daily.mode !== 'expert-ghost') {
      throw new Error('expert ghost daily is not ready for today');
    }

    currentDaily = daily;
    currentPool = preparePoolCopies(daily.pool);
    basicLandCards = daily.basicLands || {};
    resetPoolColumnVisibility();

    dailySetName.textContent = daily.set?.name || 'daily challenge';
    dailySeed.textContent = daily.source?.label || daily.seed || 'expert ghost';

    loadedDailyDate = today;
    deck = [];
    basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    renderPool();
    renderDeck();
    updateSubmitButtonVisibility();
    poolSection.classList.remove('hidden');
    loadingEl.classList.add('hidden');
    if (shouldPreviewGhost()) {
      await showLocalGhostPreview();
    } else {
      await checkSubmissionStatus();
      if (shouldOpenResults) {
        if (mySubmission) {
          showResults({ updateUrl: false });
        } else {
          showSubmissionMessage('submit a deck to reveal today\'s results');
        }
      }
    }
    if (!shouldOpenResults) maybeShowDailyWelcome();
    return;
  } catch (e) {
    showDailyUnavailable(e);
  }
}

function resetSubmissionState() {
  mySubmission = null;
  allSubmissions = null;
  submissionMeta = null;
  dailyReference = null;
  submissionTeaser.classList.add('hidden');
  if (resultsReference) resultsReference.innerHTML = '';
}

function showDailyUnavailable(error) {
  console.error('Daily expert ghost unavailable:', error);
  loadingEl.classList.add('hidden');
  poolSection.classList.add('hidden');
  currentDaily = null;
  currentPool = [];
  loadedDailyDate = null;
  deck = [];
  basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  dailySetName.textContent = 'daily unavailable';
  dailySeed.textContent = 'reference not seeded';
  updateSubmitButtonVisibility();
}

function shouldPreviewGhost() {
  const params = new URLSearchParams(window.location.search);
  return isLocalDev() && params.get('preview') === 'ghost';
}

async function showLocalGhostPreview() {
  try {
    const res = await fetch('data/17lands-sealed-candidates.json');
    if (!res.ok) throw new Error(`candidate queue returned ${res.status}`);
    const queue = await res.json();
    const candidate = queue.candidates.find(item => item.sourceId === currentDaily?.source?.sourceId);
    if (!candidate) throw new Error(`missing candidate ${currentDaily?.source?.sourceId}`);
    const source = candidate.source || queue.source;

    dailyReference = {
      id: 'expert-ghost',
      kind: 'reference',
      name: 'Expert Ghost',
      sourceId: candidate.sourceId,
      cardIds: expandCountObject(candidate.reference.deck),
      basics: candidate.reference.basics,
      colors: candidate.reference.colors || [],
      mainColors: candidate.reference.mainColors || [],
      splashColors: candidate.reference.splashColors || [],
      stats: candidate.stats || {},
      source: {
        provider: source.provider || queue.source.provider,
        label: source.label || queue.source.label,
        format: source.format || queue.source.format,
        expansion: source.expansion || queue.source.expansion,
      },
    };

    mySubmission = buildPreviewSubmission(candidate, dailyReference);
    allSubmissions = [mySubmission];
    submissionMeta = { count: 1, featured: [] };
    showResults();
  } catch (error) {
    console.error('Failed to render ghost preview:', error);
    showSubmissionMessage('could not load ghost preview');
  }
}

function buildPreviewSubmission(candidate, reference) {
  const ghostCounts = countIds(reference.cardIds);
  const previewCounts = new Map(ghostCounts);
  const poolCounts = countIds(expandCountObject(candidate.pool));
  const swapOut = reference.cardIds.slice(0, 5);

  swapOut.forEach(id => {
    const count = previewCounts.get(id) || 0;
    if (count <= 1) previewCounts.delete(id);
    else previewCounts.set(id, count - 1);
  });

  const added = [];
  for (const card of currentPool) {
    if (added.length >= swapOut.length) break;
    if (previewCounts.has(card.id)) continue;
    const used = previewCounts.get(card.id) || 0;
    const available = poolCounts.get(card.id) || 0;
    if (used < available) {
      previewCounts.set(card.id, used + 1);
      added.push(card.id);
    }
  }

  const basicsPreview = { ...reference.basics };
  if ((basicsPreview.W || 0) > 0) {
    basicsPreview.W = Math.max(0, basicsPreview.W - 1);
    basicsPreview.U = (basicsPreview.U || 0) + 1;
  } else if ((basicsPreview.G || 0) > 0) {
    basicsPreview.G = Math.max(0, basicsPreview.G - 1);
    basicsPreview.R = (basicsPreview.R || 0) + 1;
  }

  return {
    id: 'preview-you',
    name: 'you',
    fingerprint: 'preview',
    submittedAt: new Date().toISOString(),
    cardIds: expandMapCounts(previewCounts),
    basics: basicsPreview,
    colors: inferLane({ cardIds: expandMapCounts(previewCounts), basics: basicsPreview }).colors,
  };
}

function expandCountObject(counts = {}) {
  const ids = [];
  Object.entries(counts).forEach(([id, count]) => {
    for (let i = 0; i < count; i++) ids.push(id);
  });
  return ids;
}

function expandMapCounts(counts) {
  const ids = [];
  counts.forEach((count, id) => {
    for (let i = 0; i < count; i++) ids.push(id);
  });
  return ids;
}

function preparePoolCopies(cards = []) {
  const seen = new Map();
  return cards.map(card => {
    const baseId = card.id || card.name || crypto.randomUUID();
    const copyNumber = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, copyNumber);
    return {
      ...card,
      _poolCopyId: baseId + ':' + copyNumber,
    };
  });
}

async function generatePool(setCode, seed = null) {
  loadingEl.classList.remove('hidden');
  poolSection.classList.add('hidden');

  try {
    currentPool = preparePoolCopies(await generateSealedPoolFromMtgjson(setCode, 'play', 6, seed));

    // Fetch basic lands for this set
    await fetchBasicLands(setCode);

    // Reset deck
    deck = [];
    basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    resetPoolColumnVisibility();

    renderPool();
    renderDeck();

    poolSection.classList.remove('hidden');
  } catch (error) {
    console.error('Failed to generate pool:', error);
    alert('Failed to fetch cards. Please try again.');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

async function fetchBasicLands(setCode) {
  // Fetch one of each basic land from the set
  const basicNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const query = `set:${setCode} (${basicNames.map(n => `!"${n}"`).join(' or ')}) type:basic`;

  try {
    const data = await fetchWithRetry(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`);

    // Group by color and pick one of each
    basicLandCards = {};
    const colorMap = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

    data.data.forEach(card => {
      const color = colorMap[card.name];
      if (color && !basicLandCards[color]) {
        basicLandCards[color] = card;
      }
    });

    // Fill in any missing basics with defaults
    for (const color of ['W', 'U', 'B', 'R', 'G']) {
      if (!basicLandCards[color]) {
        await fetchDefaultBasic(color);
      }
    }
  } catch (error) {
    console.error('Failed to fetch basic lands:', error);
    await fetchDefaultBasics();
  }
}

async function fetchDefaultBasics() {
  for (const color of ['W', 'U', 'B', 'R', 'G']) {
    await fetchDefaultBasic(color);
  }
}

async function fetchDefaultBasic(color) {
  const name = BASIC_LAND_NAMES[color];
  try {
    basicLandCards[color] = await fetchWithRetry(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
  } catch (error) {
    console.error(`Failed to fetch ${name}:`, error);
  }
}

// Sorting
function setSort(sort) {
  currentSort = sort;
  document.querySelectorAll('.pool-sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'sort-' + sort);
  });
  renderPool();
  updateAllPoolCardClasses();
}

function setDeckSort(sort) {
  currentDeckSort = sort;
  document.querySelectorAll('.deck-sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'deck-sort-' + sort);
  });
  renderDeck();
}

function sortCards(cards, sort = currentSort) {
  const sorted = [...cards];

  if (sort === 'color') {
    const colorOrder = { W: 0, U: 1, B: 2, R: 3, G: 4, multi: 5, colorless: 6, land: 7 };
    sorted.sort((a, b) => {
      const aColor = getColorCategory(a);
      const bColor = getColorCategory(b);
      if (colorOrder[aColor] !== colorOrder[bColor]) {
        return colorOrder[aColor] - colorOrder[bColor];
      }
      return a.cmc - b.cmc;
    });
  } else if (sort === 'rarity') {
    const rarityOrder = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
    sorted.sort((a, b) => {
      if (rarityOrder[a.rarity] !== rarityOrder[b.rarity]) {
        return rarityOrder[a.rarity] - rarityOrder[b.rarity];
      }
      return a.name.localeCompare(b.name);
    });
  } else if (sort === 'cmc') {
    sorted.sort((a, b) => {
      if (a.cmc !== b.cmc) return a.cmc - b.cmc;
      return a.name.localeCompare(b.name);
    });
  }

  return sorted;
}

function getColorCategory(card) {
  let colors = card.colors;
  if (!colors && card.card_faces) {
    const faceColors = new Set();
    card.card_faces.forEach(f => (f.colors || []).forEach(c => faceColors.add(c)));
    colors = [...faceColors];
  }
  colors = colors || [];
  if (card.type_line?.includes('Land')) return 'land';
  if (colors.length === 0) return 'colorless';
  if (colors.length > 1) return 'multi';
  return colors[0];
}

function getPoolColumnSet(sort = currentSort) {
  if (!hiddenPoolColumns[sort]) hiddenPoolColumns[sort] = new Set();
  return hiddenPoolColumns[sort];
}

function resetPoolColumnVisibility() {
  hiddenPoolColumns = { color: new Set(), rarity: new Set(), cmc: new Set() };
  renderPoolHiddenColumns();
}

function isPoolColumnHidden(key, sort = currentSort) {
  return getPoolColumnSet(sort).has(key);
}

function hidePoolColumn(key) {
  getPoolColumnSet().add(key);
  renderPool();
  updateAllPoolCardClasses();
}

function showPoolColumn(sort, key) {
  getPoolColumnSet(sort).delete(key);
  renderPool();
  updateAllPoolCardClasses();
}

function showAllPoolColumns(sort = currentSort) {
  getPoolColumnSet(sort).clear();
  renderPool();
  updateAllPoolCardClasses();
}

function getPoolColumnLabels(sort = currentSort) {
  if (sort === 'color') {
    return {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      multi: 'multi',
      colorless: 'colorless',
      land: 'land',
    };
  }
  if (sort === 'rarity') {
    return {
      'mythic+rare': 'rare/mythic',
      uncommon: 'uncommon',
      common: 'common',
      land: 'land',
    };
  }
  return {
    '0-1': '0-1',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6+': '6+',
    land: 'land',
  };
}

function renderPoolHiddenColumns() {
  if (!poolHiddenColumnsEl) return;
  const hidden = [...getPoolColumnSet()];
  if (!hidden.length) {
    poolHiddenColumnsEl.classList.add('hidden');
    poolHiddenColumnsEl.innerHTML = '';
    return;
  }

  const labels = getPoolColumnLabels();
  poolHiddenColumnsEl.classList.remove('hidden');
  poolHiddenColumnsEl.innerHTML = '<span class="hidden-columns-label">hidden</span>';

  hidden.forEach(key => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-chip ui-chip-filter hidden-column-chip';
    button.textContent = labels[key] || key;
    button.setAttribute('aria-label', 'show ' + (labels[key] || key) + ' column');
    button.addEventListener('click', () => showPoolColumn(currentSort, key));
    poolHiddenColumnsEl.appendChild(button);
  });

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'hidden-columns-restore';
  restore.textContent = 'restore all';
  restore.addEventListener('click', () => showAllPoolColumns());
  poolHiddenColumnsEl.appendChild(restore);
}

function createPoolColumnHeader(label, count, key) {
  const header = document.createElement('div');
  header.className = 'column-header pool-column-header';

  const title = document.createElement('span');
  title.className = 'column-title';
  title.textContent = label + (count > 0 ? ' (' + count + ')' : '');
  header.appendChild(title);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'column-hide-btn';
  hideButton.textContent = 'hide';
  hideButton.setAttribute('aria-label', 'hide ' + label + ' column');
  hideButton.addEventListener('click', (event) => {
    event.stopPropagation();
    hidePoolColumn(key);
  });
  header.appendChild(hideButton);

  return header;
}

function appendPoolCardColumn(label, key, cards, countOverride = cards.length) {
  if (isPoolColumnHidden(key)) return;

  const groupEl = document.createElement('div');
  groupEl.className = 'card-column';
  groupEl.appendChild(createPoolColumnHeader(label, countOverride, key));

  const stackEl = document.createElement('div');
  stackEl.className = 'card-stack';
  cards.forEach((card, idx) => {
    const cardEl = createCardElement(card, 'pool');
    cardEl.style.setProperty('--stack-index', idx);
    stackEl.appendChild(cardEl);
  });

  groupEl.appendChild(stackEl);
  poolGrid.appendChild(groupEl);
}

// Render pool
function renderPool() {
  const sorted = sortCards(currentPool);
  poolCount.textContent = '(' + currentPool.length + ' cards)';
  renderPoolHiddenColumns();

  if (currentSort === 'color') {
    renderPoolByColor(sorted);
  } else if (currentSort === 'rarity') {
    renderPoolByRarity(sorted);
  } else if (currentSort === 'cmc') {
    renderPoolByCmc(sorted);
  }
}

function renderPoolByColor(cards) {
  const groups = {
    W: [], U: [], B: [], R: [], G: [],
    multi: [], colorless: [], land: []
  };

  // Filter out basic lands from pool (they'll be shown separately)
  const basicLandNames = Object.values(BASIC_LAND_NAMES);
  cards.forEach(card => {
    if (basicLandNames.includes(card.name) && card.type_line?.includes('Basic')) {
      return; // Skip basic lands from packs
    }
    const cat = getColorCategory(card);
    if (groups[cat]) {
      groups[cat].push(card);
    }
  });

  const groupNames = {
    W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
    multi: 'multi', colorless: 'colorless', land: 'land'
  };

  poolGrid.innerHTML = '';
  poolGrid.className = 'pool-columns';

  Object.entries(groups).forEach(([key, groupCards]) => {
    if (key === 'land') {
      // Add basic lands to land column
      renderLandColumn(groupCards);
      return;
    }

    if (groupCards.length === 0) return;

    groupCards.sort((a, b) => {
      if (a.cmc !== b.cmc) return a.cmc - b.cmc;
      return a.name.localeCompare(b.name);
    });

    appendPoolCardColumn(groupNames[key], key, groupCards);
  });
}

function renderLandColumn(nonBasicLands) {
  // Count: non-basics + 5 basics
  const totalCount = nonBasicLands.length + 5;
  if (isPoolColumnHidden('land')) return;

  const groupEl = document.createElement('div');
  groupEl.className = 'card-column';
  groupEl.appendChild(createPoolColumnHeader('land', totalCount, 'land'));
  const stackEl = document.createElement('div');
  stackEl.className = 'card-stack';

  // Add non-basic lands first
  let idx = 0;
  nonBasicLands.forEach(card => {
    const cardEl = createCardElement(card, 'pool');
    cardEl.style.setProperty('--stack-index', idx++);
    stackEl.appendChild(cardEl);
  });

  // Add basic lands
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    const basicCard = basicLandCards[color];
    if (basicCard) {
      const cardEl = createBasicLandElement(basicCard, color);
      cardEl.style.setProperty('--stack-index', idx++);
      stackEl.appendChild(cardEl);
    }
  });

  groupEl.appendChild(stackEl);
  poolGrid.appendChild(groupEl);
}

function renderPoolByRarity(cards) {
  const groups = {
    'mythic+rare': [],
    uncommon: [],
    common: [],
    land: []
  };

  const basicLandNames = Object.values(BASIC_LAND_NAMES);
  cards.forEach(card => {
    // Handle basic lands separately
    if (basicLandNames.includes(card.name) && card.type_line?.includes('Basic')) {
      return; // Skip basic lands
    }
    if (card.rarity === 'mythic' || card.rarity === 'rare') {
      groups['mythic+rare'].push(card);
    } else if (card.rarity === 'uncommon') {
      groups.uncommon.push(card);
    } else {
      groups.common.push(card);
    }
  });

  const groupNames = {
    'mythic+rare': 'rare/mythic',
    uncommon: 'uncommon',
    common: 'common'
  };

  poolGrid.innerHTML = '';
  poolGrid.className = 'pool-columns';

  const rarityOrder = ['mythic+rare', 'uncommon', 'common'];
  rarityOrder.forEach(key => {
    const groupCards = groups[key];
    if (groupCards.length === 0) return;
    appendPoolCardColumn(groupNames[key], key, groupCards);
  });

  // Add land column with basics
  renderLandColumn(groups.land);
}

function renderPoolByCmc(cards) {
  const groups = {
    '0-1': [],
    '2': [],
    '3': [],
    '4': [],
    '5': [],
    '6+': [],
    land: []
  };

  const basicLandNames = Object.values(BASIC_LAND_NAMES);
  cards.forEach(card => {
    // Handle basic lands separately
    if (basicLandNames.includes(card.name) && card.type_line?.includes('Basic')) {
      return; // Skip basic lands
    }
    if (card.type_line?.includes('Land')) {
      groups.land.push(card);
      return;
    }
    const cmc = card.cmc || 0;
    if (cmc <= 1) groups['0-1'].push(card);
    else if (cmc === 2) groups['2'].push(card);
    else if (cmc === 3) groups['3'].push(card);
    else if (cmc === 4) groups['4'].push(card);
    else if (cmc === 5) groups['5'].push(card);
    else groups['6+'].push(card);
  });

  poolGrid.innerHTML = '';
  poolGrid.className = 'pool-columns';

  const cmcOrder = ['0-1', '2', '3', '4', '5', '6+'];
  cmcOrder.forEach(key => {
    const groupCards = groups[key];
    if (groupCards.length === 0) return;
    appendPoolCardColumn(key, key, groupCards);
  });

  // Add land column with basics
  renderLandColumn(groups.land);
}

function createCardElement(card, context) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  if (card._poolCopyId) el.dataset.poolCopyId = card._poolCopyId;

  const normalUrl = getCardImageUrl(card, 'normal');
  // Only use lazy loading for pool cards (deck cards are always visible)
  const lazy = context === 'pool' ? ' loading="lazy"' : '';
  el.innerHTML = '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '"' + lazy + '>';
  el.dataset.normalUrl = normalUrl;

  // Hover preview
  el.addEventListener('mouseenter', showCardPreview);
  el.addEventListener('mouseleave', hideCardPreview);

  if (context === 'pool') {
    el.addEventListener('click', () => addToDeck(card));
  } else {
    el.addEventListener('click', () => removeFromDeck(card));
  }

  return el;
}

function getCardImageUrl(card, size = 'normal') {
  return card.image_uris?.[size] ||
    card.card_faces?.[0]?.image_uris?.[size] ||
    card.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.image_uris?.small ||
    card.card_faces?.[0]?.image_uris?.small ||
    '';
}

function createBasicLandElement(card, color) {
  const el = document.createElement('div');
  el.className = 'card basic-land';
  el.dataset.id = card.id;
  el.dataset.color = color;

  const normalUrl = getCardImageUrl(card, 'normal');
  el.innerHTML = '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '" loading="lazy">';
  el.dataset.normalUrl = normalUrl;

  // Show count if in deck
  if (basics[color] > 0) {
    el.innerHTML += '<span class="card-count-badge">' + basics[color] + '</span>';
  }

  // Hover preview
  el.addEventListener('mouseenter', showCardPreview);
  el.addEventListener('mouseleave', hideCardPreview);

  // Click to add to deck (unlimited)
  el.addEventListener('click', () => addBasicToDeck(color));

  return el;
}

function addBasicToDeck(color) {
  basics[color]++;
  renderDeck();
  updateDeckCount();
  updatePoolBasicBadge(color);
}

function removeBasicFromDeck(color) {
  if (basics[color] > 0) {
    basics[color]--;
    renderDeck();
    updateDeckCount();
    updatePoolBasicBadge(color);
  }
}

// Deck management
function addToDeck(card) {
  if (card._poolCopyId && deck.some(c => c._poolCopyId === card._poolCopyId)) return;

  const inDeckCount = deck.filter(c => c.id === card.id).length;
  const inPoolCount = currentPool.filter(c => c.id === card.id).length;

  if (inDeckCount < inPoolCount) {
    deck.push(card);
    renderDeck();
    updateDeckCount();
    updatePoolCardClasses(card.id);
  }
}

function removeFromDeck(card) {
  const idx = card._poolCopyId
    ? deck.findIndex(c => c._poolCopyId === card._poolCopyId)
    : deck.findIndex(c => c.id === card.id);
  if (idx !== -1) {
    deck.splice(idx, 1);
    renderDeck();
    updateDeckCount();
    updatePoolCardClasses(card.id);
  }
}

// Get CMC key for a card
function getCmcKey(card) {
  if (card.type_line?.includes('Land')) return 'lands';
  const cmc = card.cmc || 0;
  if (cmc <= 1) return '0-1';
  if (cmc >= 6) return '6+';
  return String(cmc);
}

// Get column index for CMC key
function getCmcColumnIndex(cmcKey) {
  const order = ['0-1', '2', '3', '4', '5', '6+', 'lands'];
  return order.indexOf(cmcKey);
}

// Add a single card to the appropriate deck column
function addCardToDeckColumn(card) {
  const cmcKey = getCmcKey(card);
  const colIndex = getCmcColumnIndex(cmcKey);
  const column = deckGrid.children[colIndex];
  if (!column) return;

  const stack = column.querySelector('.card-stack');
  const header = column.querySelector('.column-header');

  // Create and add the card
  const cardEl = createCardElement(card, 'deck');
  const newIndex = stack.children.length;
  cardEl.style.setProperty('--stack-index', newIndex);
  stack.appendChild(cardEl);

  // Update header count
  const count = stack.children.length;
  header.textContent = cmcKey + (count > 0 ? ' (' + count + ')' : '');
}

// Remove a single card from the deck column
function removeCardFromDeckColumn(card) {
  const cmcKey = getCmcKey(card);
  const colIndex = getCmcColumnIndex(cmcKey);
  const column = deckGrid.children[colIndex];
  if (!column) return;

  const stack = column.querySelector('.card-stack');
  const header = column.querySelector('.column-header');

  // Find and remove one instance of this card
  const cardEl = card._poolCopyId
    ? Array.from(stack.querySelectorAll('.card')).find(el => el.dataset.poolCopyId === card._poolCopyId)
    : stack.querySelector(`.card[data-id="${card.id}"]`);
  if (cardEl) {
    cardEl.remove();

    // Re-index remaining cards
    Array.from(stack.children).forEach((el, idx) => {
      el.style.setProperty('--stack-index', idx);
    });

    // Update header count
    const count = stack.children.length;
    header.textContent = cmcKey + (count > 0 ? ' (' + count + ')' : '');
  }
}

// Update just the basics in the lands column (preserves non-basic lands)
function updateDeckBasicsColumn() {
  const landsColumn = deckGrid.querySelector('.card-column:last-child');
  if (!landsColumn) return;

  const stack = landsColumn.querySelector('.card-stack');
  const header = landsColumn.querySelector('.column-header');

  // Remove existing basic land elements (keep non-basics)
  stack.querySelectorAll('.basic-land').forEach(el => el.remove());

  // Append basic lands after non-basics
  let idx = stack.children.length;
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if (basics[color] > 0 && basicLandCards[color]) {
      const cardEl = createDeckBasicElement(basicLandCards[color], color);
      cardEl.style.setProperty('--stack-index', idx++);
      stack.appendChild(cardEl);
    }
  });

  // Re-index all children
  Array.from(stack.children).forEach((el, i) => {
    el.style.setProperty('--stack-index', i);
  });

  // Update header with total lands count
  const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);
  const nonBasicCount = stack.querySelectorAll('.card:not(.basic-land)').length;
  const total = nonBasicCount + basicsTotal;
  header.textContent = 'lands' + (total > 0 ? ' (' + total + ')' : '');
}

// Update deck count display
function updateDeckCount() {
  const totalCards = deck.length + Object.values(basics).reduce((a, b) => a + b, 0);
  deckCount.textContent = totalCards;
  updateSubmitButtonVisibility();
}

// Update 'in-deck' class on pool cards without re-rendering
// Dims individual copies: if 2 in pool and 1 in deck, dim 1 card
function updatePoolCardClasses(cardId) {
  const selectedCopies = new Set(deck.filter(c => c.id === cardId).map(c => c._poolCopyId).filter(Boolean));
  const inDeckCount = deck.filter(c => c.id === cardId).length;

  poolGrid.querySelectorAll(`.card[data-id="${cardId}"]`).forEach((el, idx) => {
    if (el.dataset.poolCopyId && selectedCopies.size) {
      el.classList.toggle('in-deck', selectedCopies.has(el.dataset.poolCopyId));
    } else {
      el.classList.toggle('in-deck', idx < inDeckCount);
    }
  });
}

// Update all pool card classes (used after full pool re-render)
function updateAllPoolCardClasses() {
  const deckCounts = new Map();
  const selectedCopies = new Set();
  deck.forEach(c => deckCounts.set(c.id, (deckCounts.get(c.id) || 0) + 1));
  deck.forEach(c => {
    if (c._poolCopyId) selectedCopies.add(c._poolCopyId);
  });

  const seen = new Map();
  poolGrid.querySelectorAll('.card[data-id]').forEach(el => {
    const id = el.dataset.id;
    const idx = seen.get(id) || 0;
    seen.set(id, idx + 1);
    const inDeckCount = deckCounts.get(id) || 0;
    if (el.dataset.poolCopyId && selectedCopies.size) {
      el.classList.toggle('in-deck', selectedCopies.has(el.dataset.poolCopyId));
    } else {
      el.classList.toggle('in-deck', idx < inDeckCount);
    }
  });
}

// Update basic land badge in pool
function updatePoolBasicBadge(color) {
  const basicEl = poolGrid.querySelector(`.card.basic-land[data-color="${color}"]`);
  if (basicEl) {
    const badge = basicEl.querySelector('.card-count-badge');
    if (basics[color] > 0) {
      if (badge) {
        badge.textContent = basics[color];
      } else {
        basicEl.innerHTML += '<span class="card-count-badge">' + basics[color] + '</span>';
      }
    } else if (badge) {
      badge.remove();
    }
  }
}

function clearDeck() {
  deck = [];
  basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  renderDeck();
  renderPool();
  updateAllPoolCardClasses();
  updateSubmitButtonVisibility();
}

function renderDeck() {
  const totalCards = deck.length + Object.values(basics).reduce((a, b) => a + b, 0);
  deckCount.textContent = totalCards;

  if (currentDeckSort === 'color') {
    renderDeckByColor();
  } else if (currentDeckSort === 'rarity') {
    renderDeckByRarity();
  } else {
    renderDeckByCmc();
  }
}

function renderDeckByCmc() {
  const cmcGroups = {
    '0-1': [],
    '2': [],
    '3': [],
    '4': [],
    '5': [],
    '6+': [],
    'lands': []
  };

  deck.forEach(card => {
    cmcGroups[getCmcKey(card)].push(card);
  });

  renderDeckColumns([
    { key: '0-1', label: '0-1', cards: cmcGroups['0-1'] },
    { key: '2', label: '2', cards: cmcGroups['2'] },
    { key: '3', label: '3', cards: cmcGroups['3'] },
    { key: '4', label: '4', cards: cmcGroups['4'] },
    { key: '5', label: '5', cards: cmcGroups['5'] },
    { key: '6+', label: '6+', cards: cmcGroups['6+'] },
  ], cmcGroups['lands']);
}

function renderDeckByColor() {
  const groups = {
    W: [], U: [], B: [], R: [], G: [],
    multi: [], colorless: [], land: []
  };

  sortCards(deck, 'color').forEach(card => {
    const cat = getColorCategory(card);
    if (groups[cat]) groups[cat].push(card);
  });

  renderDeckColumns([
    { key: 'W', label: 'white', cards: groups.W },
    { key: 'U', label: 'blue', cards: groups.U },
    { key: 'B', label: 'black', cards: groups.B },
    { key: 'R', label: 'red', cards: groups.R },
    { key: 'G', label: 'green', cards: groups.G },
    { key: 'multi', label: 'multi', cards: groups.multi },
    { key: 'colorless', label: 'colorless', cards: groups.colorless },
  ], groups.land);
}

function renderDeckByRarity() {
  const groups = {
    'mythic+rare': [],
    uncommon: [],
    common: [],
  };

  sortCards(deck, 'rarity').forEach(card => {
    if (card.rarity === 'mythic' || card.rarity === 'rare') {
      groups['mythic+rare'].push(card);
    } else if (card.rarity === 'uncommon') {
      groups.uncommon.push(card);
    } else {
      groups.common.push(card);
    }
  });

  renderDeckColumns([
    { key: 'mythic+rare', label: 'rare/mythic', cards: groups['mythic+rare'] },
    { key: 'uncommon', label: 'uncommon', cards: groups.uncommon },
    { key: 'common', label: 'common', cards: groups.common },
  ], []);
}

function renderDeckColumns(columns, nonBasicLands) {
  const fragment = document.createDocumentFragment();

  columns.forEach(({ label, cards }) => {
    fragment.appendChild(renderDeckCardColumn(label, cards));
  });

  const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);
  const landsTotal = nonBasicLands.length + basicsTotal;
  const landsEl = document.createElement('div');
  landsEl.className = 'card-column';
  landsEl.innerHTML = '<div class="column-header">lands' + (landsTotal > 0 ? ' (' + landsTotal + ')' : '') + '</div>';

  const landsStack = document.createElement('div');
  landsStack.className = 'card-stack';

  let idx = 0;

  // Non-basic lands first
  nonBasicLands.forEach(card => {
    const cardEl = createCardElement(card, 'deck');
    cardEl.style.setProperty('--stack-index', idx++);
    landsStack.appendChild(cardEl);
  });

  // Then basic lands
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if (basics[color] > 0 && basicLandCards[color]) {
      const cardEl = createDeckBasicElement(basicLandCards[color], color);
      cardEl.style.setProperty('--stack-index', idx++);
      landsStack.appendChild(cardEl);
    }
  });

  landsEl.appendChild(landsStack);
  fragment.appendChild(landsEl);
  deckGrid.replaceChildren(fragment);
}

function renderDeckCardColumn(label, cards, countOverride = cards.length) {
  const groupEl = document.createElement('div');
  groupEl.className = 'card-column';
  groupEl.innerHTML = '<div class="column-header">' + label + (countOverride > 0 ? ' (' + countOverride + ')' : '') + '</div>';

  const stackEl = document.createElement('div');
  stackEl.className = 'card-stack';
  cards.forEach((card, idx) => {
    const cardEl = createCardElement(card, 'deck');
    cardEl.style.setProperty('--stack-index', idx);
    stackEl.appendChild(cardEl);
  });

  groupEl.appendChild(stackEl);
  return groupEl;
}

function createDeckBasicElement(card, color) {
  const el = document.createElement('div');
  el.className = 'card basic-land';
  el.dataset.color = color;

  const normalUrl = getCardImageUrl(card, 'normal');
  el.innerHTML = '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '" loading="lazy">';
  el.dataset.normalUrl = normalUrl;

  // Show count badge
  el.innerHTML += '<span class="card-count-badge">' + basics[color] + '</span>';

  // Hover preview
  el.addEventListener('mouseenter', showCardPreview);
  el.addEventListener('mouseleave', hideCardPreview);

  // Click to remove from deck
  el.addEventListener('click', () => removeBasicFromDeck(color));

  return el;
}

// Card Preview
const cardPreview = document.getElementById('card-preview');
const previewImg = cardPreview.querySelector('img');

function showCardPreview(e) {
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const normalUrl = card.dataset.normalUrl;

  if (!normalUrl) return;

  previewImg.src = normalUrl;
  cardPreview.classList.add('visible');

  const previewWidth = 300;
  const previewHeight = 418; // MTG card aspect ratio
  const padding = 20;

  // Determine left or right based on card position
  const cardCenterX = rect.left + rect.width / 2;
  const windowCenterX = window.innerWidth / 2;

  let left;
  if (cardCenterX < windowCenterX) {
    // Card is on left side, show preview to the right
    left = rect.right + padding;
  } else {
    // Card is on right side, show preview to the left
    left = rect.left - previewWidth - padding;
  }

  // Vertical position - center on the row but offset above
  let top = rect.top - previewHeight / 2 + rect.height / 2;

  // Keep within viewport
  top = Math.max(padding, Math.min(top, window.innerHeight - previewHeight - padding));
  left = Math.max(padding, Math.min(left, window.innerWidth - previewWidth - padding));

  cardPreview.style.left = left + 'px';
  cardPreview.style.top = top + 'px';
}

function hideCardPreview() {
  cardPreview.classList.remove('visible');
}

// --- Submission & Results ---

function getFingerprint() {
  let fp = localStorage.getItem('pb-fingerprint');
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem('pb-fingerprint', fp);
  }
  return fp;
}

function getDeckColors() {
  const colorSet = new Set();
  deck.forEach(card => {
    (card.colors || []).forEach(c => colorSet.add(c));
  });
  return [...colorSet].sort();
}

function updateSubmitButtonVisibility() {
  if (currentMode !== 'daily' || !loadedDailyDate) {
    submitBtn.classList.add('hidden');
    viewResultsBtn.classList.add('hidden');
    return;
  }
  const totalCards = deck.length + Object.values(basics).reduce((a, b) => a + b, 0);
  if (mySubmission) {
    submitBtn.classList.add('hidden');
    viewResultsBtn.classList.remove('hidden');
  } else {
    submitBtn.classList.remove('hidden');
    viewResultsBtn.classList.add('hidden');
    if (totalCards >= 40) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'submit deck';
    } else {
      submitBtn.disabled = true;
      submitBtn.textContent = 'submit deck - ' + (40 - totalCards) + ' more cards needed';
    }
  }
}

async function checkSubmissionStatus() {
  if (!loadedDailyDate) return;
  try {
    const fp = getFingerprint();
    const sourceId = currentDaily?.source?.sourceId || '';
    const res = await fetch(`${API_URL}/submissions/${loadedDailyDate}?fingerprint=${encodeURIComponent(fp)}&sourceId=${encodeURIComponent(sourceId)}`);
    if (res.ok) {
      const data = await res.json();
      if (!isCurrentDailyReference(data.reference)) {
        mySubmission = null;
        allSubmissions = null;
        submissionMeta = null;
        dailyReference = null;
        updateSubmitButtonVisibility();
        return;
      }
      allSubmissions = data.submissions;
      submissionMeta = data.meta;
      dailyReference = data.reference || null;
      mySubmission = allSubmissions.find(s => s.fingerprint === fp);
      updateSubmitButtonVisibility();
    } else if (res.status === 403) {
      const data = await res.json();
      if (data.count > 0) {
        showSubmissionMessage(data.count + ' builders today');
      }
      updateSubmitButtonVisibility();
    } else if (res.status === 503) {
      showSubmissionMessage('daily reference unavailable');
      updateSubmitButtonVisibility();
    }
  } catch {
    if (isLocalDev()) {
      showSubmissionMessage('could not reach API at ' + API_URL);
    }
  }
}

async function submitDeck() {
  const savedName = localStorage.getItem('pb-name') || '';
  const name = prompt('name (optional):', savedName);
  if (name === null) return; // cancelled

  if (name) localStorage.setItem('pb-name', name);

  const cardIds = deck.map(c => c.id);
  const body = {
    date: loadedDailyDate,
    name: name || undefined,
    fingerprint: getFingerprint(),
    sourceId: currentDaily?.source?.sourceId,
    cardIds,
    basics: { ...basics },
    colors: getDeckColors(),
  };

  try {
    const res = await fetch(`${API_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok || res.status === 409) {
      const data = await res.json();
      if (!isCurrentDailyReference(data.reference)) {
        throw new Error('daily reference changed; refresh and submit again');
      }
      allSubmissions = data.submissions;
      submissionMeta = data.meta;
      dailyReference = data.reference || null;
      mySubmission = allSubmissions.find(s => s.fingerprint === getFingerprint()) ||
                     allSubmissions.find(s => s.id === data.id);
      localStorage.setItem('pb-submitted-date', loadedDailyDate);
      localStorage.setItem('pb-submitted-source-id', currentDaily?.source?.sourceId || '');
      localStorage.setItem('pb-submission-id', data.id);
      submissionTeaser.classList.add('hidden');
      updateSubmitButtonVisibility();
      showResults({ updateUrl: true });
    } else {
      const err = await res.json().catch(() => ({}));
      showSubmissionMessage(err.error || 'submission failed');
      alert(err.error || 'submission failed');
    }
  } catch (error) {
    const message = error?.message || 'could not reach server';
    showSubmissionMessage(message);
    alert(message);
  }
}

function isCurrentDailyReference(reference) {
  const expectedSourceId = currentDaily?.source?.sourceId;
  return Boolean(reference?.sourceId && expectedSourceId && reference.sourceId === expectedSourceId);
}

function showResults({ updateUrl = false } = {}) {
  if (updateUrl) setDailyRoute('results');
  dailyWelcomeModal?.close();
  poolSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  renderReferenceComparison();
  if (mySubmission && dailyReference) {
    showComparison(dailyReference, { scroll: false });
  } else {
    document.getElementById('results-comparison').classList.add('hidden');
  }
  renderOverview();
  renderTheField();
  renderSubmissionsList();
}

function hideResults({ updateUrl = false } = {}) {
  if (updateUrl) setDailyRoute('deck');
  resultsSection.classList.add('hidden');
  poolSection.classList.remove('hidden');
  document.getElementById('results-comparison').classList.add('hidden');
}

function renderReferenceComparison() {
  if (!resultsReference) return;
  if (!mySubmission) {
    resultsReference.innerHTML = '';
    return;
  }

  if (!dailyReference) {
    resultsReference.innerHTML = '<section class="reference-panel"><h3 class="results-section-title">expert ghost</h3><p class="reference-muted">reference unavailable</p></section>';
    return;
  }

  const analysis = analyzeReferenceComparison(mySubmission, dailyReference);
  const ghostDots = renderColorDots(dailyReference.colors || analysis.ghostLane.colors);
  const laneSummary = sameColors(analysis.userLane.mainColors, analysis.ghostLane.mainColors) ? 'same lane' : 'different lane';
  const splashSummary = sameColors(analysis.userLane.splashColors, analysis.ghostLane.splashColors) ? 'same splash' : 'different splash';

  let html = '<section class="reference-panel">';
  html += '<div class="reference-header">';
  html += '<div><span class="results-section-title">expert ghost</span><h3>' + escapeHtml(dailyReference.name || 'Expert Ghost') + ' ' + ghostDots + '</h3></div>';
  html += '</div>';

  html += '<div class="reference-metrics">';
  html += referenceMetric('color lane', laneSummary, laneLine('you', analysis.userLane.mainColors) + laneLine('ghost', analysis.ghostLane.mainColors));
  html += referenceMetric('splash', splashSummary, laneLine('you', analysis.userLane.splashColors) + laneLine('ghost', analysis.ghostLane.splashColors));
  html += referenceMetric('nonbasic overlap', analysis.sharedNonbasics + '/' + analysis.ghostNonbasics, analysis.onlyMineCount + ' yours, ' + analysis.onlyGhostCount + ' ghost flex');
  html += referenceMetric('mana', basicsSummary(mySubmission.basics), basicsSummary(dailyReference.basics));
  html += '</div>';

  html += '<div class="reference-flex-grid">';
  html += renderFlexList('your flex', analysis.onlyMine);
  html += renderFlexList('ghost flex', analysis.onlyGhost);
  html += '</div>';
  html += '</section>';

  resultsReference.innerHTML = html;

  resultsReference.querySelectorAll('.reference-card-row').forEach(row => {
    row.addEventListener('mouseenter', showCardPreview);
    row.addEventListener('mouseleave', hideCardPreview);
  });
}

function analyzeReferenceComparison(submission, reference) {
  const myCounts = countIds(submission.cardIds || []);
  const ghostCounts = countIds(reference.cardIds || []);
  const allIds = new Set([...myCounts.keys(), ...ghostCounts.keys()]);
  const onlyMineCounts = new Map();
  const onlyGhostCounts = new Map();
  let sharedNonbasics = 0;
  let onlyMineCount = 0;
  let onlyGhostCount = 0;

  allIds.forEach(id => {
    const mine = myCounts.get(id) || 0;
    const ghost = ghostCounts.get(id) || 0;
    const shared = Math.min(mine, ghost);
    const mineOnly = Math.max(0, mine - ghost);
    const ghostOnly = Math.max(0, ghost - mine);
    sharedNonbasics += shared;
    onlyMineCount += mineOnly;
    onlyGhostCount += ghostOnly;
    if (mineOnly) onlyMineCounts.set(id, mineOnly);
    if (ghostOnly) onlyGhostCounts.set(id, ghostOnly);
  });

  const userLane = inferLane(submission);
  const ghostLane = {
    mainColors: reference.mainColors?.length ? reference.mainColors : inferLane(reference).mainColors,
    splashColors: reference.splashColors || [],
  };
  ghostLane.colors = mergeColorArrays(ghostLane.mainColors, ghostLane.splashColors);

  return {
    userLane,
    ghostLane,
    sharedNonbasics,
    ghostNonbasics: (reference.cardIds || []).length,
    onlyMineCount,
    onlyGhostCount,
    onlyMine: cardListFromCounts(onlyMineCounts),
    onlyGhost: cardListFromCounts(onlyGhostCounts),
  };
}

function inferLane(submission) {
  const basicsCounts = submission.basics || {};
  const cardColorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const activeColors = new Set();

  (submission.cardIds || []).forEach(id => {
    const card = findCardInPool(id);
    getCardColors(card).forEach(color => {
      if (cardColorCounts[color] != null) {
        cardColorCounts[color]++;
        activeColors.add(color);
      }
    });
  });

  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if ((basicsCounts[color] || 0) > 0) activeColors.add(color);
  });

  const scored = ['W', 'U', 'B', 'R', 'G']
    .filter(color => activeColors.has(color))
    .map(color => ({
      color,
      score: (basicsCounts[color] || 0) * 2 + cardColorCounts[color],
      basics: basicsCounts[color] || 0,
      cards: cardColorCounts[color],
    }))
    .sort((a, b) => b.score - a.score || b.basics - a.basics);

  let mainColors = scored
    .filter(item => item.basics >= 4 || item.cards >= 5)
    .map(item => item.color);

  if (!mainColors.length) {
    mainColors = scored.slice(0, 2).map(item => item.color);
  }
  if (mainColors.length > 3) {
    mainColors = mainColors.slice(0, 3);
  }

  const mainSet = new Set(mainColors);
  const splashColors = scored
    .map(item => item.color)
    .filter(color => !mainSet.has(color));

  return {
    mainColors: sortColors(mainColors),
    splashColors: sortColors(splashColors),
    colors: sortColors([...activeColors]),
  };
}

function getCardColors(card) {
  if (!card) return [];
  if (card.colors?.length) return card.colors;
  if (card.card_faces?.length) {
    return [...new Set(card.card_faces.flatMap(face => face.colors || []))];
  }
  return [];
}

function cardListFromCounts(counts) {
  const items = [...counts.entries()].map(([id, count]) => ({ card: findCardInPool(id), id, count }));
  return items.sort((a, b) => {
    const cardA = a.card || {};
    const cardB = b.card || {};
    if ((cardA.cmc || 0) !== (cardB.cmc || 0)) return (cardA.cmc || 0) - (cardB.cmc || 0);
    return (cardA.name || a.id).localeCompare(cardB.name || b.id);
  });
}

function renderFlexList(title, items) {
  let html = '<div class="reference-flex"><span class="results-section-title">' + escapeHtml(title) + '</span>';
  if (!items.length) {
    html += '<p class="reference-muted">none</p></div>';
    return html;
  }

  html += '<div class="reference-card-list">';
  items.slice(0, 12).forEach(({ card, id, count }) => {
    const name = card?.name || id;
    const normalUrl = card?.image_uris?.normal || card?.card_faces?.[0]?.image_uris?.normal || '';
    html += '<div class="reference-card-row" data-normal-url="' + escapeAttribute(normalUrl) + '">' +
      '<span class="field-name">' + escapeHtml(name) + '</span>' +
      '<span class="reference-card-count">' + (count > 1 ? 'x' + count : '') + '</span>' +
      '</div>';
  });
  if (items.length > 12) {
    html += '<p class="reference-muted">+' + (items.length - 12) + ' more</p>';
  }
  html += '</div></div>';
  return html;
}

function referenceMetric(label, value, detail) {
  return '<div class="reference-metric">' +
    '<span>' + escapeHtml(label) + '</span>' +
    '<strong>' + value + '</strong>' +
    '<small>' + detail + '</small>' +
    '</div>';
}

function laneLine(label, colors) {
  return '<span class="lane-line">' + escapeHtml(label) + ' ' + renderColorDots(colors) + colorText(colors) + '</span>';
}

function basicsSummary(basics = {}) {
  const parts = ['W', 'U', 'B', 'R', 'G']
    .filter(color => (basics[color] || 0) > 0)
    .map(color => BASIC_LAND_NAMES[color].toLowerCase() + ' ' + basics[color]);
  return escapeHtml(parts.length ? parts.join(' / ') : 'no basics');
}

function renderColorDots(colors = []) {
  const sorted = sortColors(colors);
  if (!sorted.length) return '<span class="color-dot color-C"></span>';
  return sorted.map(color => '<span class="color-dot color-' + color + '"></span>').join('');
}

function colorText(colors = []) {
  const sorted = sortColors(colors);
  return sorted.length ? ' ' + sorted.join('') : ' colorless';
}

function sameColors(a = [], b = []) {
  return sortColors(a).join('') === sortColors(b).join('');
}

function sortColors(colors = []) {
  const order = { W: 0, U: 1, B: 2, R: 3, G: 4 };
  return [...new Set(colors)].filter(color => order[color] != null).sort((a, b) => order[a] - order[b]);
}

function mergeColorArrays(...groups) {
  return sortColors(groups.flat());
}

function findCardInPool(id) {
  return currentPool.find(card => card.id === id);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function renderOverview() {
  const el = document.getElementById('results-overview');
  const count = allSubmissions ? allSubmissions.length : 0;
  el.innerHTML = '<p class="results-count">' + count + ' builder' + (count !== 1 ? 's' : '') + ' today</p>';
}

function renderTheField() {
  const el = document.getElementById('results-field');
  if (!allSubmissions || !currentPool.length) { el.innerHTML = ''; return; }

  const total = allSubmissions.length;

  // Count inclusion rate for each card in pool
  const cardCounts = new Map();
  currentPool.forEach(card => {
    if (!cardCounts.has(card.id)) {
      cardCounts.set(card.id, { card, count: 0 });
    }
  });

  allSubmissions.forEach(sub => {
    const seen = new Set();
    sub.cardIds.forEach(id => {
      if (cardCounts.has(id) && !seen.has(id)) {
        cardCounts.get(id).count++;
        seen.add(id);
      }
    });
  });

  // Group by color
  const colorGroups = { W: [], U: [], B: [], R: [], G: [], multi: [], colorless: [], land: [] };
  const colorNames = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', multi: 'multi', colorless: 'colorless', land: 'land' };

  cardCounts.forEach(({ card, count }) => {
    const cat = getColorCategory(card);
    if (colorGroups[cat]) {
      colorGroups[cat].push({ card, count, pct: Math.round((count / total) * 100) });
    }
  });

  // Sort each group by inclusion rate
  Object.values(colorGroups).forEach(group => group.sort((a, b) => b.pct - a.pct));

  let html = '<h3 class="results-section-title">the field</h3>';
  html += '<div class="field-columns">';

  const columnOrder = ['W', 'U', 'B', 'R', 'G', 'multi', 'colorless', 'land'];
  columnOrder.forEach(key => {
    const group = colorGroups[key];
    if (group.length === 0) return;
    html += '<div class="field-column">';
    html += '<div class="column-header">' + colorNames[key] + '</div>';
    group.forEach(({ card, pct }) => {
      const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
      html += '<div class="field-row" data-normal-url="' + normalUrl + '">' +
        '<span class="field-name">' + card.name + '</span>' +
        '<span class="field-bar-wrap"><span class="field-bar" style="width:' + pct + '%"></span></span>' +
        '<span class="field-pct">' + pct + '%</span>' +
        '</div>';
    });
    html += '</div>';
  });
  html += '</div>';

  // Average basics + color combos row
  html += '<div class="field-footer">';

  const avgBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  allSubmissions.forEach(sub => {
    ['W', 'U', 'B', 'R', 'G'].forEach(c => {
      avgBasics[c] += (sub.basics?.[c] || 0);
    });
  });
  html += '<div class="field-basics"><span class="results-section-title">avg basics</span><div class="basics-row">';
  ['W', 'U', 'B', 'R', 'G'].forEach(c => {
    const avg = (avgBasics[c] / total).toFixed(1);
    html += '<span class="basic-avg">' + BASIC_LAND_NAMES[c].toLowerCase() + ': ' + avg + '</span>';
  });
  html += '</div></div>';

  const combos = new Map();
  allSubmissions.forEach(sub => {
    const key = (sub.colors || []).sort().join('');
    combos.set(key, (combos.get(key) || 0) + 1);
  });
  const sortedCombos = [...combos.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedCombos.length > 0) {
    html += '<div class="field-combos"><span class="results-section-title">color combos</span><div class="combos-row">';
    sortedCombos.forEach(([combo, count]) => {
      const dots = (combo || 'C').split('').map(c => '<span class="color-dot color-' + c + '"></span>').join('');
      html += '<span class="combo-tag">' + dots + ' ' + count + '</span>';
    });
    html += '</div></div>';
  }

  html += '</div>';
  el.innerHTML = html;

  // Attach hover previews
  el.querySelectorAll('.field-row').forEach(row => {
    row.dataset.normalUrl = row.getAttribute('data-normal-url');
    row.addEventListener('mouseenter', showCardPreview);
    row.addEventListener('mouseleave', hideCardPreview);
  });
}

function renderSubmissionsList() {
  const el = document.getElementById('results-submissions');
  if (!allSubmissions) { el.innerHTML = ''; return; }

  const featured = new Set(submissionMeta?.featured || []);

  let html = '<h3 class="results-section-title">submissions</h3>';
  html += '<div class="submissions-list">';

  allSubmissions.forEach(sub => {
    const isFeatured = featured.has(sub.id);
    const isMine = mySubmission && sub.id === mySubmission.id;
    const colors = sub.colors || [];
    const cardCount = sub.cardIds.length + Object.values(sub.basics || {}).reduce((a, b) => a + b, 0);
    const dots = colors.length > 0
      ? colors.map(c => '<span class="color-dot color-' + c + '"></span>').join('')
      : '<span class="color-dot color-C"></span>';
    html += '<div class="submission-row' + (isFeatured ? ' featured' : '') + (isMine ? ' mine' : '') + '" data-id="' + sub.id + '">' +
      '<span class="sub-colors">' + dots + '</span>' +
      '<span class="sub-name">' + sub.name + (isMine ? ' (you)' : '') + '</span>' +
      '<span class="sub-count">' + cardCount + ' cards</span>' +
      '</div>';
  });

  html += '</div>';
  el.innerHTML = html;

  // Attach click handlers
  el.querySelectorAll('.submission-row').forEach(row => {
    row.addEventListener('click', () => {
      const sub = allSubmissions.find(s => s.id === row.dataset.id);
      if (sub) showComparison(sub);
    });
  });
}

function showComparison(otherSub, { scroll = true } = {}) {
  const el = document.getElementById('results-comparison');
  el.classList.remove('hidden');

  // Resolve card IDs to card objects from pool
  const theirDeck = otherSub.cardIds.map(id => currentPool.find(c => c.id === id)).filter(Boolean);
  const theirBasics = otherSub.basics || {};
  const diffTracker = mySubmission ? createDiffTracker(mySubmission.cardIds, otherSub.cardIds) : null;

  // Build header
  const dots = (otherSub.colors || []).map(c => '<span class="color-dot color-' + c + '"></span>').join('');
  let html = '<div class="comparison-header">' +
    '<h3 class="results-section-title">' + otherSub.name + '\'s deck ' + dots + '</h3>' +
    '</div>';

  // Render their deck visually in CMC columns
  const cmcGroups = { '0-1': [], '2': [], '3': [], '4': [], '5': [], '6+': [], 'lands': [] };
  theirDeck.forEach(card => { cmcGroups[getCmcKey(card)].push(card); });

  html += '<div class="comparison-deck deck-columns">';
  const cmcOrder = ['0-1', '2', '3', '4', '5', '6+'];
  cmcOrder.forEach(key => {
    const cards = cmcGroups[key];
    html += '<div class="card-column"><div class="column-header">' + key + (cards.length > 0 ? ' (' + cards.length + ')' : '') + '</div><div class="card-stack">';
    cards.forEach((card, idx) => {
      const normalUrl = getCardImageUrl(card, 'normal');
      const diffClass = diffTracker ? consumeDiffClass(diffTracker, card.id) : '';
      html += '<div class="card ' + diffClass + '" style="--stack-index:' + idx + '" data-normal-url="' + escapeAttribute(normalUrl) + '">' +
        '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '" loading="lazy"></div>';
    });
    html += '</div></div>';
  });

  // Lands column
  const nonBasicLands = cmcGroups['lands'];
  const basicsTotal = Object.values(theirBasics).reduce((a, b) => a + b, 0);
  const landsTotal = nonBasicLands.length + basicsTotal;
  html += '<div class="card-column"><div class="column-header">lands' + (landsTotal > 0 ? ' (' + landsTotal + ')' : '') + '</div><div class="card-stack">';
  let idx = 0;
  nonBasicLands.forEach(card => {
    const normalUrl = getCardImageUrl(card, 'normal');
    const diffClass = diffTracker ? consumeDiffClass(diffTracker, card.id) : '';
    html += '<div class="card ' + diffClass + '" style="--stack-index:' + idx++ + '" data-normal-url="' + escapeAttribute(normalUrl) + '">' +
      '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '" loading="lazy"></div>';
  });
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if (theirBasics[color] > 0 && basicLandCards[color]) {
      const card = basicLandCards[color];
      const normalUrl = getCardImageUrl(card, 'normal');
      html += '<div class="card basic-land" style="--stack-index:' + idx++ + '" data-normal-url="' + escapeAttribute(normalUrl) + '">' +
        '<img src="' + escapeAttribute(normalUrl) + '" alt="' + escapeAttribute(card.name) + '" loading="lazy">' +
        '<span class="card-count-badge">' + theirBasics[color] + '</span></div>';
    }
  });
  html += '</div></div>';
  html += '</div>';

  // Diff summary (compact)
  if (mySubmission) {
    const myCardIds = countIds(mySubmission.cardIds);
    const theirCardIds = countIds(otherSub.cardIds);
    const allIds = new Set([...myCardIds.keys(), ...theirCardIds.keys()]);
    let shared = 0, onlyYou = 0, onlyThem = 0;
    allIds.forEach(id => {
      const m = myCardIds.get(id) || 0;
      const t = theirCardIds.get(id) || 0;
      shared += Math.min(m, t);
      onlyYou += Math.max(0, m - t);
      onlyThem += Math.max(0, t - m);
    });
    html += '<div class="diff-summary">' +
      '<span>' + shared + ' shared</span>' +
      '<span class="only-mine-text">+' + onlyYou + ' only you</span>' +
      '<span class="only-theirs-text">+' + onlyThem + ' only them</span>' +
      '</div>';
  }

  el.innerHTML = html;

  // Attach hover previews to comparison deck cards
  el.querySelectorAll('.card').forEach(cardEl => {
    cardEl.dataset.normalUrl = cardEl.dataset.normalUrl || cardEl.getAttribute('data-normal-url');
    cardEl.addEventListener('mouseenter', showCardPreview);
    cardEl.addEventListener('mouseleave', hideCardPreview);
  });

  if (scroll) el.scrollIntoView({ behavior: 'smooth' });
}

function countIds(ids) {
  const map = new Map();
  ids.forEach(id => map.set(id, (map.get(id) || 0) + 1));
  return map;
}

function createDiffTracker(myIds = [], theirIds = []) {
  const mine = countIds(myIds);
  const theirs = countIds(theirIds);
  const shared = new Map();
  theirs.forEach((theirCount, id) => {
    shared.set(id, Math.min(mine.get(id) || 0, theirCount));
  });
  return { shared, seen: new Map() };
}

function consumeDiffClass(tracker, id) {
  const seen = (tracker.seen.get(id) || 0) + 1;
  tracker.seen.set(id, seen);
  return seen <= (tracker.shared.get(id) || 0) ? 'shared' : 'only-theirs';
}

// Start
init();
