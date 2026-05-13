// Smoke test the same MTGJSON path used by the browser app.
// The daily workflow downloads scripts/mtg.js from bensonperry.com/shared before running.

import { generateSealedPoolFromMtgjson } from './mtg.js';

const setCode = (process.argv[2] || 'dsk').toLowerCase();
const seed = process.argv[3] || 'poolbuilder-smoke';

const pool = await generateSealedPoolFromMtgjson(setCode, 'play', 6, seed);
const rarityCounts = pool.reduce((counts, card) => {
  const rarity = card.rarity || 'unknown';
  counts[rarity] = (counts[rarity] || 0) + 1;
  return counts;
}, {});

console.log(`Generated ${pool.length} cards for ${setCode.toUpperCase()} from MTGJSON booster weights.`);
console.log(JSON.stringify(rarityCounts, null, 2));

if (pool.length < 70 || pool.length > 120) {
  throw new Error(`Unexpected sealed-pool size: ${pool.length}`);
}
