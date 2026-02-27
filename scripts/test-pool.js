// Test: replicate the exact browser code path for pool generation
const SCRYFALL_API = 'https://api.scryfall.com';
const BOOSTER_DATA_URL = 'https://bensonperry.com/booster-data';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) { await delay(1000); continue; }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(100 * (i + 1));
    }
  }
}

// --- Booster data (same as mtg.js) ---
const COLLECTOR_EXCLUSIVE_PROMOS = ['fracturefoil','texturedfoil','ripplefoil','halofoil','confettifoil','galaxyfoil','surgefoil','raisedfoil','headliner'];
const COLLECTOR_EXCLUSIVE_FRAMES = ['inverted', 'extendedart'];
const JUMPSTART_SETS = new Set(['jmp', 'j22', 'j25']);
const PLAY_BOOSTER_START = '2024-02-09';
const SET_BOOSTER_START = '2020-09-25';
const COLLECTOR_BOOSTER_START = '2019-10-04';

let boosterIndexCache = null;
let boosterFileCache = {};

async function loadBoosterIndex() {
  if (boosterIndexCache) return boosterIndexCache;
  try {
    const response = await fetch(BOOSTER_DATA_URL + '/index.json');
    boosterIndexCache = await response.json();
  } catch (e) {
    console.log('  [WARN] Failed to load booster index:', e.message);
    boosterIndexCache = { version: '0.0.0', boosters: {} };
  }
  return boosterIndexCache;
}

async function loadBoosterFile(setCode, boosterType) {
  const key = setCode + '-' + boosterType;
  if (boosterFileCache[key]) return boosterFileCache[key];
  try {
    const response = await fetch(BOOSTER_DATA_URL + '/boosters/' + key + '.json');
    boosterFileCache[key] = await response.json();
    console.log(`  Loaded booster file: ${key}.json`);
  } catch (e) {
    console.log(`  [WARN] Failed to load booster file ${key}.json:`, e.message);
    boosterFileCache[key] = null;
  }
  return boosterFileCache[key];
}

function isInRange(cn, rangeStr) {
  const cnNum = parseInt(cn, 10);
  if (isNaN(cnNum)) return false;
  if (rangeStr.includes('-')) {
    const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
    return cnNum >= start && cnNum <= end;
  }
  return cnNum === parseInt(rangeStr, 10);
}

function isCollectorExclusive(card, setConfig = null) {
  if (setConfig) {
    const inPlay = isInPlayBooster(card, setConfig);
    if (inPlay === true) return false;
    if (inPlay === false) {
      const inCE = isCollectorExclusiveByConfig(card, setConfig);
      if (inCE === true) return true;
    }
  }
  const promos = card.promo_types || [];
  const frames = card.frame_effects || [];
  return promos.some(p => COLLECTOR_EXCLUSIVE_PROMOS.includes(p)) ||
    frames.some(f => COLLECTOR_EXCLUSIVE_FRAMES.includes(f));
}

function isInPlayBooster(card, setConfig) {
  if (!setConfig?.playBooster?.includeCollectorNumbers) return null;
  const cn = card.collector_number;
  return setConfig.playBooster.includeCollectorNumbers.some(range => isInRange(cn, range));
}

function isCollectorExclusiveByConfig(card, setConfig) {
  if (!setConfig?.collectorExclusive?.collectorNumbers) return null;
  const cn = card.collector_number;
  return setConfig.collectorExclusive.collectorNumbers.some(range => isInRange(cn, range));
}

// Exact copy of fetchSetConfig from mtg.js
async function fetchSetConfig(setCode) {
  const index = await loadBoosterIndex();
  const types = index.boosters[setCode];
  if (!types) return null;
  const playType = types.includes('play') ? 'play' : types.includes('draft') ? 'draft' : null;
  if (!playType) return null;
  const playFile = await loadBoosterFile(setCode, playType);
  if (!playFile) return null;
  const playRanges = [];
  for (const slot of playFile.slots) {
    if (slot.pool?.nonfoil) playRanges.push(...slot.pool.nonfoil);
    if (slot.pool?.foil) playRanges.push(...slot.pool.foil);
  }
  const config = {
    playBooster: { includeCollectorNumbers: [...new Set(playRanges)] }
  };
  if (types.includes('collector')) {
    const collectorFile = await loadBoosterFile(setCode, 'collector');
    if (collectorFile) {
      const collectorRanges = [];
      for (const slot of collectorFile.slots) {
        if (slot.name === 'collectorExclusive' && slot.pool) {
          for (const ranges of Object.values(slot.pool)) collectorRanges.push(...ranges);
        }
      }
      if (collectorRanges.length > 0) {
        config.collectorExclusive = { collectorNumbers: [...new Set(collectorRanges)] };
      }
    }
  }
  return config;
}

// Exact copy of fetchAllSetCards from mtg.js
async function fetchAllSetCards(setCode, boosterType = 'play') {
  const setConfig = await fetchSetConfig(setCode);
  let query = 'set:' + setCode + ' lang:en';
  const hasSetConfig = setConfig?.playBooster?.includeCollectorNumbers;
  console.log(`  hasSetConfig: ${!!hasSetConfig}`);
  if (!hasSetConfig && boosterType !== 'collector' && !JUMPSTART_SETS.has(setCode)) {
    query += ' is:booster';
  }
  console.log(`  Query: ${query}`);
  const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints';
  let cards = [];
  try {
    let data = await fetchWithRetry(url);
    cards = data.data || [];
    while (data.has_more && data.next_page) {
      await delay(100);
      data = await fetchWithRetry(data.next_page);
      cards = cards.concat(data.data || []);
    }
  } catch (error) {
    if (error.message !== 'HTTP 404') throw error;
  }
  console.log(`  Raw Scryfall results: ${cards.length}`);
  if (boosterType !== 'collector') {
    if (hasSetConfig) {
      cards = cards.filter(card => {
        const inPlayBooster = isInPlayBooster(card, setConfig);
        if (inPlayBooster === true) return true;
        if (isCollectorExclusiveByConfig(card, setConfig) === true) return false;
        return card.booster && !isCollectorExclusive(card);
      });
    } else {
      cards = cards.filter(card => !isCollectorExclusive(card));
    }
  }
  console.log(`  After filtering: ${cards.length}`);
  return cards;
}

function getBoosterEra(releaseDate) {
  if (releaseDate >= PLAY_BOOSTER_START) return 'play';
  if (releaseDate >= SET_BOOSTER_START) return 'set';
  if (releaseDate >= COLLECTOR_BOOSTER_START) return 'collector-era';
  return 'draft';
}

function pickRandom(arr, random) {
  return arr[Math.floor(random() * arr.length)];
}

function seededRandom(seed) {
  if (typeof seed === 'string') {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    seed = hash;
  }
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Exact copy of generateSealedPoolFromBoosterData
async function generateSealedPoolFromBoosterData(setCode, cards, numPacks = 6, seed = null) {
  const random = seed ? seededRandom(seed) : Math.random;
  const index = await loadBoosterIndex();
  const types = index.boosters[setCode];
  console.log(`  Index types for ${setCode}: ${JSON.stringify(types)}`);
  if (!types) {
    console.log('  -> FALLBACK: no types in index');
    return generateSealedPool(cards, seed);
  }
  const boosterType = types.includes('play') ? 'play' : types.includes('draft') ? 'draft' : null;
  console.log(`  Booster type: ${boosterType}`);
  if (!boosterType) {
    console.log('  -> FALLBACK: no play/draft type');
    return generateSealedPool(cards, seed);
  }
  const boosterFile = await loadBoosterFile(setCode, boosterType);
  if (!boosterFile?.slots) {
    console.log('  -> FALLBACK: no booster file/slots');
    return generateSealedPool(cards, seed);
  }
  console.log(`  Slots: ${boosterFile.slots.map(s => s.name + '(' + s.count + ')').join(', ')}`);
  const totalPerPack = boosterFile.slots.reduce((sum, s) => sum + (s.count || 0), 0);
  console.log(`  Total per pack: ${totalPerPack}, expected pool: ${totalPerPack * numPacks}`);

  const cardsByRarityInPool = {};
  for (const slot of boosterFile.slots) {
    if (!slot.pool || !slot.rarities) continue;
    const ranges = [];
    for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
    for (const rarity of slot.rarities) {
      if (!cardsByRarityInPool[rarity]) cardsByRarityInPool[rarity] = [];
      const matching = cards.filter(card =>
        card.rarity === rarity && ranges.some(range => isInRange(card.collector_number, range))
      );
      for (const card of matching) {
        if (!cardsByRarityInPool[rarity].some(c => c.id === card.id))
          cardsByRarityInPool[rarity].push(card);
      }
    }
  }
  console.log('  cardsByRarityInPool:', Object.fromEntries(Object.entries(cardsByRarityInPool).map(([k,v]) => [k, v.length])));

  const allInPool = cards.filter(card => {
    for (const slot of boosterFile.slots) {
      if (!slot.pool) continue;
      const ranges = [];
      for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
      if (ranges.some(range => isInRange(card.collector_number, range))) return true;
    }
    return false;
  });
  console.log(`  allInPool: ${allInPool.length}`);

  const pool = [];
  let warnings = 0;
  for (let pack = 0; pack < numPacks; pack++) {
    for (const slot of boosterFile.slots) {
      if (!slot.pool || !slot.count) continue;
      for (let i = 0; i < slot.count; i++) {
        let card = null;
        if (slot.rarities) {
          let rarity;
          if (slot.rarityWeights) {
            const roll = random();
            let cumulative = 0;
            for (const [r, weight] of Object.entries(slot.rarityWeights)) {
              cumulative += weight;
              if (roll < cumulative) { rarity = r; break; }
            }
            if (!rarity) rarity = slot.rarities[slot.rarities.length - 1];
          } else if (slot.rarities.includes('mythic') && slot.rarities.includes('rare')) {
            const mythicRate = slot.mythicRate ?? 0.125;
            const hasMythics = (cardsByRarityInPool.mythic?.length ?? 0) > 0;
            rarity = (hasMythics && random() < mythicRate) ? 'mythic' : 'rare';
          } else {
            rarity = slot.rarities[Math.floor(random() * slot.rarities.length)];
          }
          let rarityPool = cardsByRarityInPool[rarity] || [];
          if (slot.pool) {
            const slotRanges = [];
            for (const finishRanges of Object.values(slot.pool)) slotRanges.push(...finishRanges);
            rarityPool = rarityPool.filter(c =>
              slotRanges.some(range => isInRange(c.collector_number, range))
            );
          }
          if (rarityPool.length > 0) card = pickRandom(rarityPool, random);
        } else {
          const ranges = [];
          for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
          const slotCards = allInPool.filter(c => ranges.some(range => isInRange(c.collector_number, range)));
          if (slotCards.length > 0) card = pickRandom(slotCards, random);
        }
        if (card) pool.push(card);
        else { console.log(`  [MISS] slot=${slot.name} pack=${pack+1}`); warnings++; }
      }
    }
  }
  if (warnings > 0) console.log(`  Total missed picks: ${warnings}`);
  return pool;
}

function generateSealedPool(cards, seed = null) {
  const random = seed ? seededRandom(seed) : Math.random;
  const byRarity = {
    common: cards.filter(c => c.rarity === 'common'),
    uncommon: cards.filter(c => c.rarity === 'uncommon'),
    rare: cards.filter(c => c.rarity === 'rare'),
    mythic: cards.filter(c => c.rarity === 'mythic'),
  };
  console.log('  Legacy pools:', Object.fromEntries(Object.entries(byRarity).map(([k,v]) => [k, v.length])));
  const pool = [];
  for (let pack = 0; pack < 6; pack++) {
    const isMythic = random() < 0.125 && byRarity.mythic.length > 0;
    const rarePool = isMythic ? byRarity.mythic : byRarity.rare;
    if (rarePool.length > 0) pool.push(pickRandom(rarePool, random));
    for (let i = 0; i < 3; i++) if (byRarity.uncommon.length > 0) pool.push(pickRandom(byRarity.uncommon, random));
    for (let i = 0; i < 10; i++) if (byRarity.common.length > 0) pool.push(pickRandom(byRarity.common, random));
  }
  return pool;
}

// --- Main: replicate app.js generatePool flow ---
async function main() {
  const setCode = process.argv[2] || 'lrw';
  // Simulate: sets.find gives us the release date
  const setsUrl = 'https://bensonperry.com/shared/sets.json';
  const sets = await fetchWithRetry(setsUrl);
  const set = sets.find(s => s.code === setCode);
  console.log(`\n=== ${set ? set.name : setCode} (${setCode}) ===`);
  console.log(`Released: ${set?.released}`);

  const era = set ? getBoosterEra(set.released) : 'play';
  const boosterType = era === 'play' ? 'play' : 'draft';
  console.log(`Era: ${era}, boosterType for fetch: ${boosterType}\n`);

  console.log('--- fetchAllSetCards ---');
  const cards = await fetchAllSetCards(setCode, boosterType);

  const rarityCount = {};
  cards.forEach(c => { rarityCount[c.rarity] = (rarityCount[c.rarity] || 0) + 1; });
  console.log(`  Final card pool: ${cards.length} cards, by rarity: ${JSON.stringify(rarityCount)}\n`);

  console.log('--- generateSealedPoolFromBoosterData ---');
  const pool = await generateSealedPoolFromBoosterData(setCode, cards, 6, null);

  const poolRarity = {};
  pool.forEach(c => { poolRarity[c.rarity] = (poolRarity[c.rarity] || 0) + 1; });
  console.log(`\n=== RESULT: ${pool.length} cards ===`);
  console.log('By rarity:', JSON.stringify(poolRarity));
}

main().catch(err => { console.error(err); process.exit(1); });
