import assert from 'node:assert/strict';
import {
  buildDailyPayload,
  buildWorkerSeedPayload,
  selectCandidate,
} from './generate-daily.js';

const queue = {
  source: {
    provider: '17Lands',
    label: 'Anonymous 17Lands Expert Ghost',
    format: 'Sealed',
    expansion: 'TST',
    set: { code: 'tst', name: 'Test Set' },
    filters: { buildIndex: 0, minUserGamesBucket: 100, minUserWinRateBucket: 0.60 },
    datasetUrl: 'https://example.test/game.csv.gz',
    launchEpoch: '2026-06-06',
  },
  cards: {
    a: { id: 'a', name: 'Alpha', cmc: 2, colors: ['W'], type_line: 'Creature' },
    b: { id: 'b', name: 'Beta', cmc: 3, colors: ['U'], type_line: 'Creature' },
  },
  basicLands: {
    W: { id: 'plains', name: 'Plains', type_line: 'Basic Land - Plains' },
    U: { id: 'island', name: 'Island', type_line: 'Basic Land - Island' },
    B: { id: 'swamp', name: 'Swamp', type_line: 'Basic Land - Swamp' },
    R: { id: 'mountain', name: 'Mountain', type_line: 'Basic Land - Mountain' },
    G: { id: 'forest', name: 'Forest', type_line: 'Basic Land - Forest' },
  },
  candidates: [
    {
      sourceId: '17l-tst-001',
      pool: { a: 2, b: 1 },
      reference: {
        deck: { a: 1 },
        basics: { W: 9, U: 8, B: 0, R: 0, G: 0 },
        colors: ['W', 'U'],
        mainColors: ['W', 'U'],
        splashColors: [],
      },
      stats: { referenceDeckSize: 18 },
    },
    {
      sourceId: '17l-tst-002',
      pool: { b: 2 },
      reference: {
        deck: { b: 2 },
        basics: { W: 0, U: 9, B: 0, R: 0, G: 0 },
        colors: ['U'],
        mainColors: ['U'],
        splashColors: [],
      },
      stats: { referenceDeckSize: 11 },
    },
  ],
};

assert.equal(selectCandidate(queue.candidates, '2026-06-06', queue.source.launchEpoch).candidate.sourceId, '17l-tst-001');
assert.equal(selectCandidate(queue.candidates, '2026-06-07', queue.source.launchEpoch).candidate.sourceId, '17l-tst-002');
assert.equal(selectCandidate(queue.candidates, '2026-06-08', queue.source.launchEpoch).candidate.sourceId, '17l-tst-001');

const { candidate, index } = selectCandidate(queue.candidates, '2026-06-06', queue.source.launchEpoch);
const daily = buildDailyPayload(queue, candidate, '2026-06-06', index);
assert.equal(daily.mode, 'expert-ghost');
assert.equal(daily.source.sourceId, '17l-tst-001');
assert.equal(daily.pool.length, 3, 'daily pool expands card counts');
assert.equal(daily.reference, undefined, 'public daily payload does not include reference');
assert.equal(JSON.stringify(daily).includes('cardIds'), false, 'public daily payload does not leak reference card IDs');

const workerPayload = buildWorkerSeedPayload(queue, candidate, '2026-06-06');
assert.deepEqual(workerPayload.reference.cardIds, ['a']);
assert.deepEqual(workerPayload.reference.basics, { W: 9, U: 8, B: 0, R: 0, G: 0 });
assert.equal(workerPayload.reference.name, 'Expert Ghost');

console.log('daily generation tests passed');
