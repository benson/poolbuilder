// Pool Builder - Sealed Pool Generator & Deckbuilder
import { fetchAllSetCards, generateSealedPool, getDailySeed, getBoosterEra } from 'https://bensonperry.com/shared/mtg.js';

// State
let sets = [];
let currentPool = [];
let deck = [];
let basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
let currentSort = 'color';
let currentMode = 'generator';
let selectedSet = null;

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
  await loadSets();
  setupEventListeners();
  updateDailyInfo();
}

// Load sets from shared module
async function loadSets() {
  try {
    const response = await fetch('https://bensonperry.com/shared/sets.json');
    sets = await response.json();
    // Sets are already filtered in sets.json
  } catch (error) {
    console.error('Failed to load sets:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Mode toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => handleModeToggle(btn.dataset.mode));
  });

  // Set autocomplete
  setInput.addEventListener('input', handleSetInput);
  setInput.addEventListener('focus', () => {
    if (setInput.value.length > 0) showDropdown();
  });
  setInput.addEventListener('keydown', handleSetKeydown);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      hideDropdown();
    }
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

  // Basic land buttons
  document.querySelectorAll('.basic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      const delta = btn.classList.contains('plus') ? 1 : -1;
      updateBasics(color, delta);
    });
  });
}

// Mode toggle
function handleModeToggle(mode) {
  currentMode = mode;
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  generatorControls.classList.toggle('hidden', mode !== 'generator');
  dailyControls.classList.toggle('hidden', mode !== 'daily');
}

// Set autocomplete
function handleSetInput() {
  const query = setInput.value.toLowerCase().trim();
  if (query.length === 0) {
    hideDropdown();
    generateBtn.disabled = true;
    selectedSet = null;
    return;
  }

  const matches = sets.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.code.toLowerCase() === query
  ).slice(0, 10);

  if (matches.length > 0) {
    renderDropdown(matches);
    showDropdown();
  } else {
    hideDropdown();
  }
}

function handleSetKeydown(e) {
  const options = setDropdown.querySelectorAll('.option');
  const highlighted = setDropdown.querySelector('.option.highlighted');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!highlighted && options.length > 0) {
      options[0].classList.add('highlighted');
    } else if (highlighted && highlighted.nextElementSibling) {
      highlighted.classList.remove('highlighted');
      highlighted.nextElementSibling.classList.add('highlighted');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (highlighted && highlighted.previousElementSibling) {
      highlighted.classList.remove('highlighted');
      highlighted.previousElementSibling.classList.add('highlighted');
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlighted) {
      selectSet(highlighted.dataset.code);
    }
  } else if (e.key === 'Escape') {
    hideDropdown();
  }
}

function renderDropdown(matches) {
  setDropdown.innerHTML = matches.map(s => {
    const year = s.released ? s.released.split('-')[0] : '';
    return `<div class="option" data-code="${s.code}">${s.name}<span class="year">${year}</span></div>`;
  }).join('');

  setDropdown.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', () => selectSet(opt.dataset.code));
    opt.addEventListener('mouseenter', () => {
      setDropdown.querySelector('.option.highlighted')?.classList.remove('highlighted');
      opt.classList.add('highlighted');
    });
  });
}

function selectSet(code) {
  const set = sets.find(s => s.code === code);
  if (set) {
    selectedSet = set;
    setInput.value = set.name;
    setSelect.value = code;
    generateBtn.disabled = false;
    hideDropdown();
  }
}

function showDropdown() {
  setDropdown.classList.remove('hidden');
}

function hideDropdown() {
  setDropdown.classList.add('hidden');
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
    currentPool = generateSealedPool(cards, seed);

    // Reset deck
    deck = [];
    basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    updateBasicsDisplay();

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
  poolCount.textContent = `(${currentPool.length} cards)`;

  if (currentSort === 'color') {
    renderPoolByColor(sorted);
  } else {
    renderPoolFlat(sorted);
  }
}

function renderPoolByColor(cards) {
  const groups = {
    W: [], U: [], B: [], R: [], G: [],
    multi: [], colorless: [], land: []
  };

  cards.forEach(card => {
    const cat = getColorCategory(card);
    if (groups[cat]) {
      groups[cat].push(card);
    }
  });

  const groupNames = {
    W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
    multi: 'multicolor', colorless: 'colorless', land: 'land'
  };

  poolGrid.innerHTML = '';

  Object.entries(groups).forEach(([key, groupCards]) => {
    if (groupCards.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'color-group';
    groupEl.innerHTML = `<div class="color-group-header">${groupNames[key]} (${groupCards.length})</div>`;

    const gridEl = document.createElement('div');
    gridEl.className = 'card-grid';
    groupCards.forEach(card => {
      gridEl.appendChild(createCardElement(card, 'pool'));
    });

    groupEl.appendChild(gridEl);
    poolGrid.appendChild(groupEl);
  });
}

function renderPoolFlat(cards) {
  poolGrid.innerHTML = '';
  const gridEl = document.createElement('div');
  gridEl.className = 'card-grid';
  cards.forEach(card => {
    gridEl.appendChild(createCardElement(card, 'pool'));
  });
  poolGrid.appendChild(gridEl);
}

function createCardElement(card, context) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;

  const imgUrl = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  el.innerHTML = `<img src="${imgUrl}" alt="${card.name}" loading="lazy">`;

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

// Deck management
function addToDeck(card) {
  const inDeckCount = deck.filter(c => c.id === card.id).length;
  const inPoolCount = currentPool.filter(c => c.id === card.id).length;

  if (inDeckCount < inPoolCount) {
    deck.push(card);
    renderDeck();
    renderPool();
  }
}

function removeFromDeck(card) {
  const idx = deck.findIndex(c => c.id === card.id);
  if (idx !== -1) {
    deck.splice(idx, 1);
    renderDeck();
    renderPool();
  }
}

function clearDeck() {
  deck = [];
  basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  updateBasicsDisplay();
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

  deckGrid.innerHTML = '';
  const sorted = sortCards([...cardCounts.values()].map(c => c.card));

  sorted.forEach(card => {
    const { count } = cardCounts.get(card.id);
    const el = createCardElement(card, 'deck');
    if (count > 1) {
      el.innerHTML += `<span class="card-count">${count}</span>`;
    }
    deckGrid.appendChild(el);
  });
}

// Basic lands
function updateBasics(color, delta) {
  basics[color] = Math.max(0, basics[color] + delta);
  updateBasicsDisplay();
  renderDeck();
}

function updateBasicsDisplay() {
  Object.keys(basics).forEach(color => {
    document.getElementById('basic-' + color).textContent = basics[color];
  });
}

// Start
init();
