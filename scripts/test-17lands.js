import assert from 'node:assert/strict';
import {
  buildCandidateQueue,
  DEFAULT_FILTERS,
  parseCsvLine,
  trimCard,
} from './lib/17lands.js';

const header = [
  'expansion',
  'event_type',
  'draft_id',
  'build_index',
  'main_colors',
  'splash_colors',
  'deck_Forest',
  'sideboard_Forest',
  'deck_Abrade',
  'sideboard_Abrade',
  'deck_Test Duplicate',
  'sideboard_Test Duplicate',
  'deck_Unresolved Card',
  'sideboard_Unresolved Card',
  'user_n_games_bucket',
  'user_game_win_rate_bucket',
];

const config = {
  expansion: 'TST',
  format: 'Sealed',
  set: { code: 'tst', name: 'Test Set' },
  scryfallSetCodes: ['tst'],
  datasetUrl: 'https://example.test/game.csv.gz',
  launchEpoch: '2026-06-06',
};

function card(name, id = name.toLowerCase().replaceAll(' ', '-')) {
  return trimCard({
    id,
    name,
    set: 'tst',
    set_name: 'Test Set',
    rarity: 'common',
    cmc: 2,
    colors: name === 'Abrade' ? ['R'] : ['G'],
    color_identity: [],
    type_line: 'Instant',
    collector_number: '1',
    image_uris: { small: `https://img.test/${id}-small`, normal: `https://img.test/${id}` },
  });
}

function row(values) {
  return Object.fromEntries(header.map(key => [key, values[key] ?? '0']));
}

const cardByName = new Map([
  ['Forest', card('Forest', 'forest')],
  ['Abrade', card('Abrade', 'abrade')],
  ['Test Duplicate', card('Test Duplicate', 'duplicate')],
]);

assert.deepEqual(
  parseCsvLine('"deck_Abigale, Poet Laureate",deck_Abrade,"a ""quoted"" card"'),
  ['deck_Abigale, Poet Laureate', 'deck_Abrade', 'a "quoted" card'],
  'quoted CSV fields parse correctly'
);

const rows = [
  row({
    draft_id: 'draft-a',
    build_index: '0',
    main_colors: 'RG',
    splash_colors: 'U',
    deck_Forest: '9',
    deck_Abrade: '2',
    sideboard_Abrade: '1',
    'deck_Test Duplicate': '1',
    'sideboard_Test Duplicate': '2',
    user_n_games_bucket: '100',
    user_game_win_rate_bucket: '0.60',
  }),
  row({
    draft_id: 'draft-a',
    build_index: '0',
    main_colors: 'RG',
    splash_colors: 'U',
    deck_Forest: '9',
    deck_Abrade: '2',
    sideboard_Abrade: '1',
    'deck_Test Duplicate': '1',
    'sideboard_Test Duplicate': '2',
    user_n_games_bucket: '100',
    user_game_win_rate_bucket: '0.60',
  }),
  row({
    draft_id: 'draft-low',
    build_index: '0',
    deck_Abrade: '1',
    user_n_games_bucket: '50',
    user_game_win_rate_bucket: '0.70',
  }),
  row({
    draft_id: 'draft-sideboard-build',
    build_index: '1',
    deck_Abrade: '1',
    user_n_games_bucket: '500',
    user_game_win_rate_bucket: '0.70',
  }),
];

const queue = buildCandidateQueue({
  expansionConfig: config,
  header,
  rows,
  cardByName,
  filters: DEFAULT_FILTERS,
});

assert.equal(queue.candidates.length, 1, 'filters to one unique high-bucket initial build');
const candidate = queue.candidates[0];
assert.equal(candidate.sourceId, '17l-tst-001');
assert.deepEqual(candidate.pool, { abrade: 3, duplicate: 3 }, 'pool uses deck plus sideboard nonbasics');
assert.deepEqual(candidate.reference.deck, { abrade: 2, duplicate: 1 }, 'reference deck uses deck nonbasics only');
assert.deepEqual(candidate.reference.basics, { W: 0, U: 0, B: 0, R: 0, G: 9 }, 'basic lands split out of reference deck');
assert.equal(candidate.stats.referenceDeckSize, 12, 'reference deck size includes basics');
assert.deepEqual(candidate.reference.mainColors, ['R', 'G']);
assert.deepEqual(candidate.reference.splashColors, ['U']);

assert.throws(
  () => buildCandidateQueue({
    expansionConfig: config,
    header,
    rows: [
      row({
        draft_id: 'draft-missing',
        build_index: '0',
        'deck_Unresolved Card': '1',
        user_n_games_bucket: '100',
        user_game_win_rate_bucket: '0.60',
      }),
    ],
    cardByName,
    filters: DEFAULT_FILTERS,
  }),
  /unresolved 17Lands card names: Unresolved Card/,
  'unresolved card names fail ingestion'
);

console.log('17lands ingestion tests passed');
