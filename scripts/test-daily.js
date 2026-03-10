// Test that pool generation via mtg.js produces correct results
import { fetchAllSetCards, generateSealedPoolFromBoosterData } from './mtg.js';

const SET = 'dsk'; // Duskmourn — a known play booster set
const SEED = 'test-determinism-seed';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  pass: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

async function main() {
  console.log(`fetching ${SET} cards...`);
  const cards = await fetchAllSetCards(SET);
  assert(cards.length > 0, `fetched ${cards.length} cards`);

  console.log('generating pool 1...');
  const pool1 = await generateSealedPoolFromBoosterData(SET, cards, 6, SEED);
  console.log('generating pool 2 (same seed)...');
  const pool2 = await generateSealedPoolFromBoosterData(SET, cards, 6, SEED);

  // Determinism: same seed produces same pool
  const ids1 = pool1.map(c => c.id).join(',');
  const ids2 = pool2.map(c => c.id).join(',');
  assert(ids1 === ids2, 'same seed produces identical pool');

  // Card count: standard play booster = 13 cards/pack * 6 packs = 78
  assert(pool1.length >= 60, `pool has ${pool1.length} cards (>= 60)`);
  assert(pool1.length <= 90, `pool has ${pool1.length} cards (<= 90)`);

  // Rarity distribution
  const rarities = {};
  for (const card of pool1) {
    rarities[card.rarity] = (rarities[card.rarity] || 0) + 1;
  }
  console.log('  rarities:', rarities);
  assert(rarities.common > 0, 'pool has commons');
  assert(rarities.uncommon > 0, 'pool has uncommons');
  assert((rarities.rare || 0) + (rarities.mythic || 0) > 0, 'pool has rares/mythics');

  // Different seed produces different pool
  const pool3 = await generateSealedPoolFromBoosterData(SET, cards, 6, 'different-seed');
  const ids3 = pool3.map(c => c.id).join(',');
  assert(ids1 !== ids3, 'different seed produces different pool');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
