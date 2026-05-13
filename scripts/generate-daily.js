// Pre-generate the daily challenge pool
// Runs via GitHub Actions on a daily schedule

import { fetchWithRetry, generateSealedPoolFromMtgjson, getDailySeed, pickDailySet } from './mtg.js';

const SCRYFALL_API = 'https://api.scryfall.com';
const SETS_URL = 'https://bensonperry.com/shared/sets.json';

// ============ Basic lands fetching ============

async function fetchBasicLands(setCode) {
  const basicNames = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const query = `set:${setCode} (${basicNames.map(n => `!"${n}"`).join(' or ')}) type:basic`;
  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=cards`;

  let lands = {};
  const colorMap = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

  try {
    const data = await fetchWithRetry(url);
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
        const card = await fetchWithRetry(`${SCRYFALL_API}/cards/named?exact=${encodeURIComponent(name)}`);
        lands[color] = trimCard(card);
      } catch (e) { /* skip */ }
    }
  }

  return lands;
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

  // Load sets directly via https — fetchSets() in mtg.js resolves the URL
  // relative to import.meta.url, which becomes file:// when mtg.js is curled
  // to disk in CI, and Node's fetch doesn't support file://.
  const sets = await (await fetch(SETS_URL)).json();
  const dailySet = pickDailySet(sets);
  console.log(`daily set: ${dailySet.name} (${dailySet.code})`);

  // Generate pool
  console.log('generating pool from mtgjson booster weights...');
  const pool = await generateSealedPoolFromMtgjson(dailySet.code, 'play', 6, seed);
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
