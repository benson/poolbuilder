// Pool Builder - Sealed Pool Generator & Deckbuilder
import {
  fetchSets,
  createSetAutocomplete,
  fetchAllSetCards,
  generateSealedPoolFromBoosterData,
  getDailySeed,
  getBoosterEra
} from 'https://bensonperry.com/shared/mtg.js';

// State
let sets = [];
let currentPool = [];
let deck = [];
let basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
let basicLandCards = {};
let currentSort = 'color';
let currentMode = 'daily';
let selectedSet = null;
let autocomplete = null;

// Submission state
let mySubmission = null;
let allSubmissions = null;
let submissionMeta = null;
let loadedDailyDate = null;
const API_URL = 'https://poolbuilder-api.brostar.workers.dev';

// Basic land names
const BASIC_LAND_NAMES = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest'
};

// DOM elements
const setInput = document.getElementById('set-input');
const setSelect = document.getElementById('set-select');
const setDropdown = document.getElementById('set-dropdown');
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
const submissionTeaser = document.getElementById('submission-teaser');

// Initialize
async function init() {
  try {
    sets = await fetchSets();

    // Set up autocomplete using shared module
    autocomplete = createSetAutocomplete({
      inputEl: setInput,
      dropdownEl: setDropdown,
      hiddenEl: setSelect,
      sets: sets,
      onSelect: handleSetSelect
    });

    // Pre-select first set
    if (sets.length > 0) {
      autocomplete.setInitialSet(sets[0]);
      selectedSet = sets[0];
      generateBtn.disabled = false;
    }

    setInput.disabled = false;
    setInput.placeholder = 'type to search sets...';

    setupEventListeners();
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

  // Clear deck
  document.getElementById('clear-deck').addEventListener('click', clearDeck);

  // Submission buttons
  submitBtn.addEventListener('click', submitDeck);
  viewResultsBtn.addEventListener('click', showResults);
  document.getElementById('back-to-deck').addEventListener('click', hideResults);
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
  }
}

// Daily challenge
function updateDailyInfo() {
  const seed = getDailySeed();
  const dateStr = seed.replace('daily-', '');

  // Pick a set based on the date (rotate through recent sets)
  const recentSets = sets.filter(s => s.released && s.released >= '2020-01-01');
  if (recentSets.length > 0) {
    const dayIndex = hashDate(dateStr) % recentSets.length;
    const dailySet = recentSets[dayIndex];
    dailySetName.textContent = dailySet.name;
    dailyControls.dataset.setCode = dailySet.code;
  }

  dailySeed.textContent = seed;
}

function hashDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Generate pool
async function handleGenerate() {
  if (!selectedSet) return;
  await generatePool(selectedSet.code);
}

async function handleDailyGenerate() {
  loadingEl.classList.remove('hidden');
  poolSection.classList.add('hidden');

  try {
    // Try to load pre-generated daily pool
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch('daily.json?v=' + today);
    if (res.ok) {
      const daily = await res.json();
      if (daily.date === today) {
        currentPool = daily.pool;
        basicLandCards = daily.basicLands || {};

        // Update header info from cached data
        dailySetName.textContent = daily.set.name;
        dailySeed.textContent = daily.seed;

        loadedDailyDate = today;
        deck = [];
        basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        renderPool();
        renderDeck();
        poolSection.classList.remove('hidden');
        loadingEl.classList.add('hidden');
        checkSubmissionStatus();
        return;
      }
    }
  } catch (e) {
    // Fall through to live generation
  }

  // Fallback: generate live from Scryfall
  const setCode = dailyControls.dataset.setCode;
  if (!setCode) { loadingEl.classList.add('hidden'); return; }
  const seed = getDailySeed();
  await generatePool(setCode, seed);
  loadedDailyDate = new Date().toISOString().split('T')[0];
  checkSubmissionStatus();
}

async function generatePool(setCode, seed = null) {
  loadingEl.classList.remove('hidden');
  poolSection.classList.add('hidden');

  try {
    const set = sets.find(s => s.code === setCode);
    const era = set ? getBoosterEra(set.released) : 'play';
    const boosterType = era === 'play' ? 'play' : 'draft';

    const cards = await fetchAllSetCards(setCode, boosterType);

    // Use booster-data aware pool generation (respects slot definitions and mythic rates)
    currentPool = await generateSealedPoolFromBoosterData(setCode, cards, 6, seed);

    // Fetch basic lands for this set
    await fetchBasicLands(setCode);

    // Reset deck
    deck = [];
    basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

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
    const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`);
    if (!response.ok) {
      // Fallback to default basics if set doesn't have them
      await fetchDefaultBasics();
      return;
    }
    const data = await response.json();

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
    const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
    if (response.ok) {
      basicLandCards[color] = await response.json();
    }
  } catch (error) {
    console.error(`Failed to fetch ${name}:`, error);
  }
}

// Sorting
function setSort(sort) {
  currentSort = sort;
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'sort-' + sort);
  });
  renderPool();
  updateAllPoolCardClasses();
}

function sortCards(cards) {
  const sorted = [...cards];

  if (currentSort === 'color') {
    const colorOrder = { W: 0, U: 1, B: 2, R: 3, G: 4, multi: 5, colorless: 6, land: 7 };
    sorted.sort((a, b) => {
      const aColor = getColorCategory(a);
      const bColor = getColorCategory(b);
      if (colorOrder[aColor] !== colorOrder[bColor]) {
        return colorOrder[aColor] - colorOrder[bColor];
      }
      return a.cmc - b.cmc;
    });
  } else if (currentSort === 'rarity') {
    const rarityOrder = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
    sorted.sort((a, b) => {
      if (rarityOrder[a.rarity] !== rarityOrder[b.rarity]) {
        return rarityOrder[a.rarity] - rarityOrder[b.rarity];
      }
      return a.name.localeCompare(b.name);
    });
  } else if (currentSort === 'cmc') {
    sorted.sort((a, b) => {
      if (a.cmc !== b.cmc) return a.cmc - b.cmc;
      return a.name.localeCompare(b.name);
    });
  }

  return sorted;
}

function getColorCategory(card) {
  const colors = card.colors || [];
  if (card.type_line?.includes('Land')) return 'land';
  if (colors.length === 0) return 'colorless';
  if (colors.length > 1) return 'multi';
  return colors[0];
}

// Render pool
function renderPool() {
  const sorted = sortCards(currentPool);
  poolCount.textContent = '(' + currentPool.length + ' cards)';

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

    const groupEl = document.createElement('div');
    groupEl.className = 'card-column';
    groupEl.innerHTML = '<div class="column-header">' + groupNames[key] + ' (' + groupCards.length + ')</div>';

    const stackEl = document.createElement('div');
    stackEl.className = 'card-stack';
    groupCards.forEach((card, idx) => {
      const cardEl = createCardElement(card, 'pool');
      cardEl.style.setProperty('--stack-index', idx);
      stackEl.appendChild(cardEl);
    });

    groupEl.appendChild(stackEl);
    poolGrid.appendChild(groupEl);
  });
}

function renderLandColumn(nonBasicLands) {
  const groupEl = document.createElement('div');
  groupEl.className = 'card-column';

  // Count: non-basics + 5 basics
  const totalCount = nonBasicLands.length + 5;
  groupEl.innerHTML = '<div class="column-header">land (' + totalCount + ')</div>';

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
    if (card.type_line?.includes('Land')) {
      groups.land.push(card);
    } else if (card.rarity === 'mythic' || card.rarity === 'rare') {
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

    const groupEl = document.createElement('div');
    groupEl.className = 'card-column';
    groupEl.innerHTML = '<div class="column-header">' + groupNames[key] + ' (' + groupCards.length + ')</div>';

    const stackEl = document.createElement('div');
    stackEl.className = 'card-stack';
    groupCards.forEach((card, idx) => {
      const cardEl = createCardElement(card, 'pool');
      cardEl.style.setProperty('--stack-index', idx);
      stackEl.appendChild(cardEl);
    });

    groupEl.appendChild(stackEl);
    poolGrid.appendChild(groupEl);
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
    '6': [],
    '7+': [],
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
    else if (cmc === 6) groups['6'].push(card);
    else groups['7+'].push(card);
  });

  poolGrid.innerHTML = '';
  poolGrid.className = 'pool-columns';

  const cmcOrder = ['0-1', '2', '3', '4', '5', '6', '7+'];
  cmcOrder.forEach(key => {
    const groupCards = groups[key];
    if (groupCards.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'card-column';
    groupEl.innerHTML = '<div class="column-header">' + key + ' (' + groupCards.length + ')</div>';

    const stackEl = document.createElement('div');
    stackEl.className = 'card-stack';
    groupCards.forEach((card, idx) => {
      const cardEl = createCardElement(card, 'pool');
      cardEl.style.setProperty('--stack-index', idx);
      stackEl.appendChild(cardEl);
    });

    groupEl.appendChild(stackEl);
    poolGrid.appendChild(groupEl);
  });

  // Add land column with basics
  renderLandColumn(groups.land);
}

function createCardElement(card, context) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;

  const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
  // Only use lazy loading for pool cards (deck cards are always visible)
  const lazy = context === 'pool' ? ' loading="lazy"' : '';
  el.innerHTML = '<img src="' + smallUrl + '" alt="' + card.name + '"' + lazy + '>';
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

function createBasicLandElement(card, color) {
  const el = document.createElement('div');
  el.className = 'card basic-land';
  el.dataset.id = card.id;
  el.dataset.color = color;

  const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
  el.innerHTML = '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy">';
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
  updateDeckBasicsColumn();
  updateDeckCount();
  updatePoolBasicBadge(color);
}

function removeBasicFromDeck(color) {
  if (basics[color] > 0) {
    basics[color]--;
    updateDeckBasicsColumn();
    updateDeckCount();
    updatePoolBasicBadge(color);
  }
}

// Deck management
function addToDeck(card) {
  const inDeckCount = deck.filter(c => c.id === card.id).length;
  const inPoolCount = currentPool.filter(c => c.id === card.id).length;

  if (inDeckCount < inPoolCount) {
    deck.push(card);
    addCardToDeckColumn(card);
    updateDeckCount();
    updatePoolCardClasses(card.id);
  }
}

function removeFromDeck(card) {
  const idx = deck.findIndex(c => c.id === card.id);
  if (idx !== -1) {
    deck.splice(idx, 1);
    removeCardFromDeckColumn(card);
    updateDeckCount();
    updatePoolCardClasses(card.id);
  }
}

// Get CMC key for a card
function getCmcKey(card) {
  if (card.type_line?.includes('Land')) return 'lands';
  const cmc = card.cmc || 0;
  if (cmc <= 1) return '0-1';
  if (cmc >= 7) return '7+';
  return String(cmc);
}

// Get column index for CMC key
function getCmcColumnIndex(cmcKey) {
  const order = ['0-1', '2', '3', '4', '5', '6', '7+', 'lands'];
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
  const cardEl = stack.querySelector(`.card[data-id="${card.id}"]`);
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
  const inDeckCount = deck.filter(c => c.id === cardId).length;

  poolGrid.querySelectorAll(`.card[data-id="${cardId}"]`).forEach((el, idx) => {
    el.classList.toggle('in-deck', idx < inDeckCount);
  });
}

// Update all pool card classes (used after full pool re-render)
function updateAllPoolCardClasses() {
  const deckCounts = new Map();
  deck.forEach(c => deckCounts.set(c.id, (deckCounts.get(c.id) || 0) + 1));

  const seen = new Map();
  poolGrid.querySelectorAll('.card[data-id]').forEach(el => {
    const id = el.dataset.id;
    const idx = seen.get(id) || 0;
    seen.set(id, idx + 1);
    const inDeckCount = deckCounts.get(id) || 0;
    el.classList.toggle('in-deck', idx < inDeckCount);
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

  // Group into CMC columns (no deduplication - show each card individually)
  const cmcGroups = {
    '0-1': [],
    '2': [],
    '3': [],
    '4': [],
    '5': [],
    '6': [],
    '7+': [],
    'lands': []
  };

  deck.forEach(card => {
    cmcGroups[getCmcKey(card)].push(card);
  });

  // Build all content in a fragment first (off-DOM)
  const fragment = document.createDocumentFragment();

  const cmcOrder = ['0-1', '2', '3', '4', '5', '6', '7+'];
  cmcOrder.forEach(key => {
    const cards = cmcGroups[key];
    const groupEl = document.createElement('div');
    groupEl.className = 'card-column';

    groupEl.innerHTML = '<div class="column-header">' + key + (cards.length > 0 ? ' (' + cards.length + ')' : '') + '</div>';

    const stackEl = document.createElement('div');
    stackEl.className = 'card-stack';
    cards.forEach((card, idx) => {
      const cardEl = createCardElement(card, 'deck');
      cardEl.style.setProperty('--stack-index', idx);
      stackEl.appendChild(cardEl);
    });

    groupEl.appendChild(stackEl);
    fragment.appendChild(groupEl);
  });

  // Add lands column (non-basic lands from deck + basic lands)
  const nonBasicLands = cmcGroups['lands'];
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

  // Atomic swap - replaces all children in one operation
  deckGrid.replaceChildren(fragment);
}

function createDeckBasicElement(card, color) {
  const el = document.createElement('div');
  el.className = 'card basic-land';
  el.dataset.color = color;

  const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
  el.innerHTML = '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy">';
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
    return;
  }
  const totalCards = deck.length + Object.values(basics).reduce((a, b) => a + b, 0);
  if (mySubmission) {
    submitBtn.classList.add('hidden');
    viewResultsBtn.classList.remove('hidden');
  } else if (totalCards >= 40) {
    submitBtn.classList.remove('hidden');
    viewResultsBtn.classList.add('hidden');
  } else {
    submitBtn.classList.add('hidden');
    viewResultsBtn.classList.add('hidden');
  }
}

async function checkSubmissionStatus() {
  if (!loadedDailyDate) return;
  try {
    const fp = getFingerprint();
    const res = await fetch(`${API_URL}/submissions/${loadedDailyDate}?fingerprint=${fp}`);
    if (res.ok) {
      const data = await res.json();
      allSubmissions = data.submissions;
      submissionMeta = data.meta;
      mySubmission = allSubmissions.find(s => s.fingerprint === fp);
      updateSubmitButtonVisibility();
    } else if (res.status === 403) {
      const data = await res.json();
      if (data.count > 0) {
        submissionTeaser.textContent = data.count + ' builders today';
        submissionTeaser.classList.remove('hidden');
      }
      updateSubmitButtonVisibility();
    }
  } catch {
    // silently degrade
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
      allSubmissions = data.submissions;
      submissionMeta = data.meta;
      mySubmission = allSubmissions.find(s => s.fingerprint === getFingerprint()) ||
                     allSubmissions.find(s => s.id === data.id);
      localStorage.setItem('pb-submitted-date', loadedDailyDate);
      localStorage.setItem('pb-submission-id', data.id);
      submissionTeaser.classList.add('hidden');
      updateSubmitButtonVisibility();
      showResults();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'submission failed');
    }
  } catch {
    alert('could not reach server');
  }
}

function showResults() {
  poolSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  renderOverview();
  renderTheField();
  renderSubmissionsList();
}

function hideResults() {
  resultsSection.classList.add('hidden');
  poolSection.classList.remove('hidden');
  document.getElementById('results-comparison').classList.add('hidden');
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

function showComparison(otherSub) {
  const el = document.getElementById('results-comparison');
  el.classList.remove('hidden');

  // Resolve card IDs to card objects from pool
  const theirDeck = otherSub.cardIds.map(id => currentPool.find(c => c.id === id)).filter(Boolean);
  const theirBasics = otherSub.basics || {};

  // Build header
  const dots = (otherSub.colors || []).map(c => '<span class="color-dot color-' + c + '"></span>').join('');
  let html = '<div class="comparison-header">' +
    '<h3 class="results-section-title">' + otherSub.name + '\'s deck ' + dots + '</h3>' +
    '</div>';

  // Render their deck visually in CMC columns
  const cmcGroups = { '0-1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7+': [], 'lands': [] };
  theirDeck.forEach(card => { cmcGroups[getCmcKey(card)].push(card); });

  html += '<div class="comparison-deck deck-columns">';
  const cmcOrder = ['0-1', '2', '3', '4', '5', '6', '7+'];
  cmcOrder.forEach(key => {
    const cards = cmcGroups[key];
    html += '<div class="card-column"><div class="column-header">' + key + (cards.length > 0 ? ' (' + cards.length + ')' : '') + '</div><div class="card-stack">';
    cards.forEach((card, idx) => {
      const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
      const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
      const diffClass = mySubmission ? (mySubmission.cardIds.includes(card.id) ? 'shared' : 'only-theirs') : '';
      html += '<div class="card ' + diffClass + '" style="--stack-index:' + idx + '" data-normal-url="' + normalUrl + '">' +
        '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy"></div>';
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
    const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
    const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
    const diffClass = mySubmission ? (mySubmission.cardIds.includes(card.id) ? 'shared' : 'only-theirs') : '';
    html += '<div class="card ' + diffClass + '" style="--stack-index:' + idx++ + '" data-normal-url="' + normalUrl + '">' +
      '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy"></div>';
  });
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if (theirBasics[color] > 0 && basicLandCards[color]) {
      const card = basicLandCards[color];
      const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
      const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
      html += '<div class="card basic-land" style="--stack-index:' + idx++ + '" data-normal-url="' + normalUrl + '">' +
        '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy">' +
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

  el.scrollIntoView({ behavior: 'smooth' });
}

function countIds(ids) {
  const map = new Map();
  ids.forEach(id => map.set(id, (map.get(id) || 0) + 1));
  return map;
}

// Start
init();
