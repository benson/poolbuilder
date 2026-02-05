// Pre-generate the daily challenge pool
// Runs via GitHub Actions on a daily schedule

const SCRYFALL_API = 'https://api.scryfall.com';
const SETS_URL = 'https://bensonperry.com/shared/sets.json';
const BOOSTER_DATA_URL = 'https://bensonperry.com/booster-data';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.status === 429) { await delay(1000); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  }
}

// ============ Daily set selection (mirrors app.js logic) ============

function getDailySeed() {
  const dateStr = new Date().toISOString().split('T')[0];
  return 'daily-' + dateStr;
}

function hashDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickDailySet(sets) {
  const seed = getDailySeed();
  const dateStr = seed.replace('daily-', '');
  const recentSets = sets.filter(s => s.released && s.released >= '2020-01-01');
  const dayIndex = hashDate(dateStr) % recentSets.length;
  return recentSets[dayIndex];
}

// ============ Seeded RNG (mirrors mtg.js) ============

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function seededRandom(seed) {
  if (typeof seed === 'string') seed = hashString(seed);
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, random) {
  return arr[Math.floor(random() * arr.length)];
}

// ============ Collector-exclusive detection ============

const COLLECTOR_EXCLUSIVE_PROMOS = [
  'fracturefoil', 'texturedfoil', 'ripplefoil',
  'halofoil', 'confettifoil', 'galaxyfoil', 'surgefoil',
  'raisedfoil', 'headliner'
];
const COLLECTOR_EXCLUSIVE_FRAMES = ['inverted', 'extendedart'];

function isCollectorExclusive(card) {
  const promos = card.promo_types || [];
  const frames = card.frame_effects || [];
  return promos.some(p => COLLECTOR_EXCLUSIVE_PROMOS.includes(p)) ||
    frames.some(f => COLLECTOR_EXCLUSIVE_FRAMES.includes(f));
}

// ============ CN range checking ============

function isInRange(cn, rangeStr) {
  const cnNum = parseInt(cn, 10);
  if (isNaN(cnNum)) return false;
  if (rangeStr.includes('-')) {
    const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
    return cnNum >= start && cnNum <= end;
  }
  return cnNum === parseInt(rangeStr, 10);
}

// ============ Card fetching ============

async function fetchAllSetCards(setCode, boosterFile) {
  let query = `set:${setCode} lang:en`;
  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints`;

  let cards = [];
  let data = await fetchJSON(url);
  cards = data.data || [];
  while (data.has_more && data.next_page) {
    await delay(100);
    data = await fetchJSON(data.next_page);
    cards = cards.concat(data.data || []);
  }

  // Filter to cards in booster ranges, excluding collector exclusives
  if (boosterFile?.slots) {
    const allRanges = [];
    for (const slot of boosterFile.slots) {
      if (!slot.pool) continue;
      for (const ranges of Object.values(slot.pool)) {
        allRanges.push(...ranges);
      }
    }
    cards = cards.filter(card =>
      allRanges.some(range => isInRange(card.collector_number, range)) &&
      !isCollectorExclusive(card)
    );
  } else {
    cards = cards.filter(card => card.booster && !isCollectorExclusive(card));
  }

  return cards;
}

async function fetchBasicLands(setCode) {
  const basicNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const query = `set:${setCode} (${basicNames.map(n => `!"${n}"`).join(' or ')}) type:basic`;
  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=cards`;

  let lands = {};
  const colorMap = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

  try {
    const data = await fetchJSON(url);
    for (const card of data.data) {
      const color = colorMap[card.name];
      if (color && !lands[color]) lands[color] = trimCard(card);
    }
  } catch (e) {
    // Fall back to default basics
  }

  // Fill in missing with defaults
  for (const [name, color] of Object.entries(colorMap)) {
    if (!lands[color]) {
      try {
        const card = await fetchJSON(`${SCRYFALL_API}/cards/named?exact=${encodeURIComponent(name)}`);
        lands[color] = trimCard(card);
      } catch (e) { /* skip */ }
    }
  }

  return lands;
}

// ============ Pool generation (mirrors mtg.js) ============

function generatePool(cards, boosterFile, seed) {
  const random = seededRandom(seed);

  if (!boosterFile?.slots) {
    // Legacy fallback
    const byRarity = {
      common: cards.filter(c => c.rarity === 'common'),
      uncommon: cards.filter(c => c.rarity === 'uncommon'),
      rare: cards.filter(c => c.rarity === 'rare'),
      mythic: cards.filter(c => c.rarity === 'mythic'),
    };
    const pool = [];
    for (let pack = 0; pack < 6; pack++) {
      const isMythic = random() < 0.125 && byRarity.mythic.length > 0;
      pool.push(pickRandom(isMythic ? byRarity.mythic : byRarity.rare, random));
      for (let i = 0; i < 3; i++) pool.push(pickRandom(byRarity.uncommon, random));
      for (let i = 0; i < 10; i++) pool.push(pickRandom(byRarity.common, random));
    }
    return pool;
  }

  // Pre-filter cards by rarity for each slot
  const cardsByRarity = {};
  for (const slot of boosterFile.slots) {
    if (!slot.pool || !slot.rarities) continue;
    const ranges = [];
    for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
    for (const rarity of slot.rarities) {
      if (!cardsByRarity[rarity]) cardsByRarity[rarity] = [];
      const matching = cards.filter(card =>
        card.rarity === rarity && ranges.some(range => isInRange(card.collector_number, range))
      );
      for (const card of matching) {
        if (!cardsByRarity[rarity].some(c => c.id === card.id)) {
          cardsByRarity[rarity].push(card);
        }
      }
    }
  }

  const allInPool = cards.filter(card => {
    for (const slot of boosterFile.slots) {
      if (!slot.pool) continue;
      const ranges = [];
      for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
      if (ranges.some(range => isInRange(card.collector_number, range))) return true;
    }
    return false;
  });

  const pool = [];
  for (let pack = 0; pack < 6; pack++) {
    for (const slot of boosterFile.slots) {
      if (!slot.pool || !slot.count) continue;
      for (let i = 0; i < slot.count; i++) {
        let card = null;
        if (slot.rarities) {
          let rarity;
          if (slot.rarities.includes('mythic') && slot.rarities.includes('rare')) {
            const mythicRate = slot.mythicRate ?? 0.125;
            const hasMythics = (cardsByRarity.mythic?.length ?? 0) > 0;
            rarity = (hasMythics && random() < mythicRate) ? 'mythic' : 'rare';
          } else {
            rarity = slot.rarities[Math.floor(random() * slot.rarities.length)];
          }
          const rarityPool = cardsByRarity[rarity] || [];
          if (rarityPool.length > 0) card = pickRandom(rarityPool, random);
        } else {
          const ranges = [];
          for (const finishRanges of Object.values(slot.pool)) ranges.push(...finishRanges);
          const slotCards = allInPool.filter(c => ranges.some(range => isInRange(c.collector_number, range)));
          if (slotCards.length > 0) card = pickRandom(slotCards, random);
        }
        if (card) pool.push(card);
      }
    }
  }
  return pool;
}

// ============ Trim card data ============

function trimCard(card) {
  const trimmed = {
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    cmc: card.cmc,
    colors: card.colors,
    type_line: card.type_line,
    collector_number: card.collector_number,
  };
  if (card.image_uris) {
    trimmed.image_uris = { small: card.image_uris.small, normal: card.image_uris.normal };
  }
  if (card.card_faces?.[0]?.image_uris) {
    trimmed.card_faces = card.card_faces.map(face => ({
      image_uris: { small: face.image_uris?.small, normal: face.image_uris?.normal }
    }));
  }
  return trimmed;
}

// ============ Main ============

async function main() {
  const seed = getDailySeed();
  const date = new Date().toISOString().split('T')[0];
  console.log(`generating daily pool for ${date} (seed: ${seed})`);

  // Load sets
  const sets = await fetchJSON(SETS_URL);
  const dailySet = pickDailySet(sets);
  console.log(`daily set: ${dailySet.name} (${dailySet.code})`);

  // Load booster data
  let boosterFile = null;
  try {
    const index = await fetchJSON(BOOSTER_DATA_URL + '/index.json');
    const types = index.boosters[dailySet.code];
    if (types) {
      const boosterType = types.includes('play') ? 'play' : types.includes('draft') ? 'draft' : null;
      if (boosterType) {
        boosterFile = await fetchJSON(`${BOOSTER_DATA_URL}/boosters/${dailySet.code}-${boosterType}.json`);
        console.log(`loaded booster data: ${dailySet.code}-${boosterType}`);
      }
    }
  } catch (e) {
    console.log('no booster data found, using legacy generation');
  }

  // Fetch cards
  console.log('fetching cards from scryfall...');
  const cards = await fetchAllSetCards(dailySet.code, boosterFile);
  console.log(`fetched ${cards.length} cards`);

  // Generate pool
  const pool = generatePool(cards, boosterFile, seed);
  console.log(`generated pool with ${pool.length} cards`);

  // Fetch basic lands
  console.log('fetching basic lands...');
  const basicLands = await fetchBasicLands(dailySet.code);

  // Trim and write
  const daily = {
    date,
    seed,
    set: { code: dailySet.code, name: dailySet.name },
    pool: pool.map(trimCard),
    basicLands
  };

  const { writeFileSync } = await import('fs');
  writeFileSync('daily.json', JSON.stringify(daily));
  console.log(`wrote daily.json (${(JSON.stringify(daily).length / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
