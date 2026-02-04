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
let basicLandCards = {}; // { W: cardObj, U: cardObj, ... }
let currentSort = 'color';
let currentMode = 'generator';
let selectedSet = null;
let autocomplete = null;

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
const dailyGenerateBtn = document.getElementById('daily-generate-btn');
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
  dailyGenerateBtn.addEventListener('click', handleDailyGenerate);

  // Sort buttons
  document.getElementById('sort-color').addEventListener('click', () => setSort('color'));
  document.getElementById('sort-rarity').addEventListener('click', () => setSort('rarity'));
  document.getElementById('sort-cmc').addEventListener('click', () => setSort('cmc'));

  // Clear deck
  document.getElementById('clear-deck').addEventListener('click', clearDeck);

  // View toggle
  document.getElementById('view-toggle').addEventListener('click', toggleView);
}

let currentView = 'pool'; // 'pool' or 'deck'

function toggleView() {
  const deckArea = document.getElementById('deck-area');
  const poolArea = document.getElementById('pool-area');
  const toggleBtn = document.getElementById('view-toggle');

  if (currentView === 'pool') {
    currentView = 'deck';
    deckArea.classList.remove('collapsed');
    deckArea.classList.add('expanded');
    poolArea.classList.remove('expanded');
    poolArea.classList.add('collapsed');
    toggleBtn.textContent = '[show pool]';
  } else {
    currentView = 'pool';
    poolArea.classList.remove('collapsed');
    poolArea.classList.add('expanded');
    deckArea.classList.remove('expanded');
    deckArea.classList.add('collapsed');
    toggleBtn.textContent = '[show deck]';
  }
}

// Mode toggle
function handleModeToggle(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-link').forEach(link => {
    link.classList.toggle('active', link.dataset.mode === mode);
  });
  generatorControls.classList.toggle('hidden', mode !== 'generator');
  dailyControls.classList.toggle('hidden', mode !== 'daily');
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
  const setCode = dailyControls.dataset.setCode;
  if (!setCode) return;
  const seed = getDailySeed();
  await generatePool(setCode, seed);
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
  el.innerHTML = '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy">';
  el.dataset.normalUrl = normalUrl;

  // Hover preview
  el.addEventListener('mouseenter', showCardPreview);
  el.addEventListener('mouseleave', hideCardPreview);

  if (context === 'pool') {
    const inDeckCount = deck.filter(c => c.id === card.id).length;
    const inPoolCount = currentPool.filter(c => c.id === card.id).length;
    if (inDeckCount >= inPoolCount) {
      el.classList.add('in-deck');
    }
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
  renderWithScrollLock();
}

function removeBasicFromDeck(color) {
  if (basics[color] > 0) {
    basics[color]--;
    renderWithScrollLock();
  }
}

// Deck management
function addToDeck(card) {
  const inDeckCount = deck.filter(c => c.id === card.id).length;
  const inPoolCount = currentPool.filter(c => c.id === card.id).length;

  if (inDeckCount < inPoolCount) {
    deck.push(card);
    renderWithScrollLock();
  }
}

function removeFromDeck(card) {
  const idx = deck.findIndex(c => c.id === card.id);
  if (idx !== -1) {
    deck.splice(idx, 1);
    renderWithScrollLock();
  }
}

function renderWithScrollLock() {
  const scrollY = window.scrollY;
  renderDeck();
  renderPool();
  // Double rAF to ensure DOM has fully settled before restoring scroll
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  });
}

function clearDeck() {
  deck = [];
  basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  renderDeck();
  renderPool();
}

function renderDeck() {
  const totalCards = deck.length + Object.values(basics).reduce((a, b) => a + b, 0);
  deckCount.textContent = totalCards;

  // Group by card and show counts
  const cardCounts = new Map();
  deck.forEach(card => {
    const count = cardCounts.get(card.id) || { card, count: 0 };
    count.count++;
    cardCounts.set(card.id, count);
  });

  // Group into CMC columns
  const cmcGroups = {
    '0-1': [],
    '2': [],
    '3': [],
    '4': [],
    '5': [],
    '6': [],
    '7+': []
  };

  [...cardCounts.values()].forEach(({ card, count }) => {
    const cmc = card.cmc || 0;
    const entry = { card, count };
    if (cmc <= 1) cmcGroups['0-1'].push(entry);
    else if (cmc === 2) cmcGroups['2'].push(entry);
    else if (cmc === 3) cmcGroups['3'].push(entry);
    else if (cmc === 4) cmcGroups['4'].push(entry);
    else if (cmc === 5) cmcGroups['5'].push(entry);
    else if (cmc === 6) cmcGroups['6'].push(entry);
    else cmcGroups['7+'].push(entry);
  });

  deckGrid.innerHTML = '';

  const cmcOrder = ['0-1', '2', '3', '4', '5', '6', '7+'];
  cmcOrder.forEach(key => {
    const entries = cmcGroups[key];
    const groupEl = document.createElement('div');
    groupEl.className = 'card-column';

    const count = entries.reduce((sum, e) => sum + e.count, 0);
    groupEl.innerHTML = '<div class="column-header">' + key + (count > 0 ? ' (' + count + ')' : '') + '</div>';

    const stackEl = document.createElement('div');
    stackEl.className = 'card-stack';
    entries.forEach(({ card, count }, idx) => {
      const cardEl = createCardElement(card, 'deck');
      cardEl.style.setProperty('--stack-index', idx);
      if (count > 1) {
        cardEl.innerHTML += '<span class="card-count-badge">' + count + '</span>';
      }
      stackEl.appendChild(cardEl);
    });

    groupEl.appendChild(stackEl);
    deckGrid.appendChild(groupEl);
  });

  // Add lands column for basics
  const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);
  const landsEl = document.createElement('div');
  landsEl.className = 'card-column';
  landsEl.innerHTML = '<div class="column-header">lands' + (basicsTotal > 0 ? ' (' + basicsTotal + ')' : '') + '</div>';

  const landsStack = document.createElement('div');
  landsStack.className = 'card-stack';

  let idx = 0;
  ['W', 'U', 'B', 'R', 'G'].forEach(color => {
    if (basics[color] > 0 && basicLandCards[color]) {
      const cardEl = createDeckBasicElement(basicLandCards[color], color);
      cardEl.style.setProperty('--stack-index', idx++);
      landsStack.appendChild(cardEl);
    }
  });

  landsEl.appendChild(landsStack);
  deckGrid.appendChild(landsEl);
}

function createDeckBasicElement(card, color) {
  const el = document.createElement('div');
  el.className = 'card basic-land';
  el.dataset.color = color;

  const smallUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  const normalUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
  el.innerHTML = '<img src="' + smallUrl + '" alt="' + card.name + '" loading="lazy">';
  el.dataset.normalUrl = normalUrl;

  // Show count
  if (basics[color] > 1) {
    el.innerHTML += '<span class="card-count-badge">' + basics[color] + '</span>';
  }

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

// Start
init();
