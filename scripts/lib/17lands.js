import { createReadStream } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';

export const BASIC_LAND_NAMES = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

export const BASIC_LAND_COLORS = Object.fromEntries(
  Object.entries(BASIC_LAND_NAMES).map(([color, name]) => [name, color])
);

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

export const EXPANSION_CONFIGS = {
  SOS: {
    expansion: 'SOS',
    format: 'Sealed',
    set: { code: 'sos', name: 'Secrets of Strixhaven' },
    scryfallSetCodes: ['sos', 'soc', 'soa', 'spg'],
    datasetUrl: 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.SOS.Sealed.csv.gz',
    launchEpoch: '2026-06-06',
  },
};

export const DEFAULT_FILTERS = {
  buildIndex: 0,
  minUserGamesBucket: 100,
  minUserWinRateBucket: 0.76,
};

export const SCRYFALL_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'poolbuilder/17lands-ingest (https://bensonperry.com/poolbuilder)',
};

const SCRYFALL_REQUEST_DELAY_MS = 250;

export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error('unterminated quoted CSV field');
  }

  fields.push(field);
  return fields;
}

export async function readGzipCsv(filePath) {
  const rows = [];
  let header = null;
  let lineNumber = 0;

  const input = createReadStream(filePath).pipe(createGunzip());
  const reader = createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    lineNumber++;
    if (lineNumber === 1) {
      header = parseCsvLine(stripBom(line));
      continue;
    }

    if (!line || isNullPaddingLine(line)) continue;
    const fields = parseCsvLine(line);
    if (fields.length !== header.length) {
      throw new Error(`CSV row ${lineNumber} has ${fields.length} fields; expected ${header.length}`);
    }

    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = fields[i];
    }
    rows.push(row);
  }

  if (!header) {
    throw new Error(`CSV file is empty: ${filePath}`);
  }

  return { header, rows };
}

export async function buildCandidateQueueFromGzipCsv({ filePath, expansionConfig, cardByName, filters = DEFAULT_FILTERS }) {
  let builder = null;
  let header = null;
  let lineNumber = 0;
  let rowCount = 0;

  const input = createReadStream(filePath).pipe(createGunzip());
  const reader = createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    lineNumber++;
    if (lineNumber === 1) {
      header = parseCsvLine(stripBom(line));
      builder = createCandidateQueueBuilder({ expansionConfig, header, cardByName, filters });
      continue;
    }

    if (!line || isNullPaddingLine(line)) continue;
    const fields = parseCsvLine(line);
    if (fields.length !== header.length) {
      throw new Error(`CSV row ${lineNumber} has ${fields.length} fields; expected ${header.length}`);
    }

    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = fields[i];
    }
    builder.addRow(row);
    rowCount++;
  }

  if (!builder) {
    throw new Error(`CSV file is empty: ${filePath}`);
  }

  return { queue: builder.finish(), rowCount };
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isNullPaddingLine(value) {
  return /^\0+$/.test(value);
}

export async function downloadFile(url, outputPath) {
  const response = await fetch(url, { headers: SCRYFALL_HEADERS });
  if (!response.ok) {
    throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

export async function fetchScryfallPrints(setCodes) {
  const cards = [];

  for (const setCode of setCodes) {
    let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${setCode} unique:prints`)}`;

    while (url) {
      const data = await fetchScryfallJson(url);
      cards.push(...(data.data || []));
      url = data.next_page || null;
    }
  }

  return cards;
}

async function fetchScryfallJson(url) {
  await sleep(SCRYFALL_REQUEST_DELAY_MS);
  const response = await fetch(url, { headers: SCRYFALL_HEADERS });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') || 60);
    await sleep(Math.max(retryAfter, 1) * 1000);
    return fetchScryfallJson(url);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Scryfall request failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildNameResolver(cards, setCodes) {
  const byName = new Map();

  for (const rawCard of cards) {
    const card = trimCard(rawCard);
    addNameCandidate(byName, card.name, card, setCodes);
    addNameCandidate(byName, normalizedNameKey(card.name), card, setCodes);

    for (const face of card.card_faces || []) {
      if (face.name) {
        addNameCandidate(byName, face.name, card, setCodes);
        addNameCandidate(byName, normalizedNameKey(face.name), card, setCodes);
      }
    }
  }

  return byName;
}

function addNameCandidate(map, name, card, setCodes) {
  const current = map.get(name);
  if (!current || compareCardPreference(card, current, setCodes) < 0) {
    map.set(name, card);
  }
}

function compareCardPreference(a, b, setCodes) {
  const setA = setCodes.indexOf(a.set);
  const setB = setCodes.indexOf(b.set);
  const priorityA = setA === -1 ? 999 : setA;
  const priorityB = setB === -1 ? 999 : setB;
  if (priorityA !== priorityB) return priorityA - priorityB;

  const arenaA = a.arena_id ? 0 : 1;
  const arenaB = b.arena_id ? 0 : 1;
  if (arenaA !== arenaB) return arenaA - arenaB;

  return compareCollectorNumbers(a.collector_number, b.collector_number);
}

function compareCollectorNumbers(a = '', b = '') {
  const numA = Number.parseInt(String(a).match(/\d+/)?.[0] || '9999', 10);
  const numB = Number.parseInt(String(b).match(/\d+/)?.[0] || '9999', 10);
  if (numA !== numB) return numA - numB;
  return String(a).localeCompare(String(b));
}

export function resolveCardName(cardByName, name) {
  return cardByName.get(name)
    || cardByName.get(normalizedNameKey(name))
    || cardByName.get(normalizedNameKey(stripArenaRebalancePrefix(name)));
}

function normalizedNameKey(name) {
  return `normalized:${String(name)
    .trim()
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()}`;
}

function stripArenaRebalancePrefix(name) {
  return String(name).replace(/^A-/i, '');
}

export function trimCard(card) {
  const trimmed = {
    id: card.id,
    name: card.name,
    set: card.set,
    set_name: card.set_name,
    rarity: card.rarity,
    cmc: card.cmc,
    colors: card.colors,
    color_identity: card.color_identity,
    mana_cost: card.mana_cost,
    type_line: card.type_line,
    collector_number: card.collector_number,
  };

  if (card.arena_id) trimmed.arena_id = card.arena_id;

  if (card.image_uris) {
    trimmed.image_uris = {
      small: card.image_uris.small,
      normal: card.image_uris.normal,
    };
  }

  if (card.card_faces?.length) {
    trimmed.card_faces = card.card_faces.map(face => {
      const trimmedFace = {
        name: face.name,
        mana_cost: face.mana_cost,
        colors: face.colors,
        type_line: face.type_line,
      };
      if (face.image_uris) {
        trimmedFace.image_uris = {
          small: face.image_uris.small,
          normal: face.image_uris.normal,
        };
      }
      return trimmedFace;
    });
  }

  return trimmed;
}

export function buildCandidateQueue({ expansionConfig, header, rows, cardByName, filters = DEFAULT_FILTERS }) {
  const builder = createCandidateQueueBuilder({ expansionConfig, header, cardByName, filters });
  for (const row of rows) {
    builder.addRow(row);
  }
  return builder.finish();
}

export function createCandidateQueueBuilder({ expansionConfig, header, cardByName, filters = DEFAULT_FILTERS }) {
  const deckColumns = header.filter(name => name.startsWith('deck_'));
  const sideboardColumns = header.filter(name => name.startsWith('sideboard_'));
  const sideboardColumnSet = new Set(sideboardColumns);
  const candidates = [];
  const seenBuilds = new Set();
  const missingNames = new Set();
  const cardsByIdForSorting = cardByIdFromNames(cardByName);

  function addRow(row) {
    const buildIndex = toNumber(row.build_index, -1);
    const userGamesBucket = toNumber(row.user_n_games_bucket, 0);
    const userWinRateBucket = toNumber(row.user_game_win_rate_bucket, 0);

    if (buildIndex !== filters.buildIndex) return;
    if (userGamesBucket < filters.minUserGamesBucket) return;
    if (userWinRateBucket < filters.minUserWinRateBucket) return;

    const key = `${row.draft_id}:${row.build_index}`;
    if (seenBuilds.has(key)) return;
    seenBuilds.add(key);

    const pool = {};
    const referenceDeck = {};
    const basics = emptyBasics();

    for (const deckColumn of deckColumns) {
      const cardName = deckColumn.slice('deck_'.length);
      const sideboardColumn = `sideboard_${cardName}`;
      if (!sideboardColumnSet.has(sideboardColumn)) continue;

      const deckCount = toNumber(row[deckColumn], 0);
      const sideboardCount = toNumber(row[sideboardColumn], 0);
      const poolCount = deckCount + sideboardCount;
      if (poolCount <= 0) continue;

      const basicColor = BASIC_LAND_COLORS[cardName];
      if (basicColor) {
        basics[basicColor] += deckCount;
        continue;
      }

      const card = resolveCardName(cardByName, cardName);
      if (!card) {
        missingNames.add(cardName);
        continue;
      }

      addCount(pool, card.id, poolCount);
      addCount(referenceDeck, card.id, deckCount);
    }

    candidates.push({
      draftId: row.draft_id,
      buildIndex,
      source: {
        provider: '17Lands',
        label: 'Anonymous 17Lands Expert Ghost',
        format: expansionConfig.format,
        expansion: expansionConfig.expansion,
        set: expansionConfig.set,
        datasetUrl: expansionConfig.datasetUrl,
      },
      userBuckets: {
        games: userGamesBucket,
        winRate: userWinRateBucket,
      },
      mainColors: parseColorString(row.main_colors),
      splashColors: parseColorString(row.splash_colors),
      pool,
      reference: {
        deck: referenceDeck,
        basics,
        mainColors: parseColorString(row.main_colors),
        splashColors: parseColorString(row.splash_colors),
        colors: mergeColors(parseColorString(row.main_colors), parseColorString(row.splash_colors)),
      },
    });
  }

  function finish() {
    if (missingNames.size) {
      throw new Error(`unresolved 17Lands card names: ${[...missingNames].sort().join(', ')}`);
    }

    candidates.sort((a, b) => a.draftId.localeCompare(b.draftId));

    const usedCardIds = new Set();
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      candidate.sourceId = `17l-${expansionConfig.expansion.toLowerCase()}-${String(i + 1).padStart(3, '0')}`;
      candidate.stats = {
        poolNonbasicCount: sumCounts(candidate.pool),
        referenceNonbasicCount: sumCounts(candidate.reference.deck),
        referenceDeckSize: sumCounts(candidate.reference.deck) + sumCounts(candidate.reference.basics),
      };

      for (const id of Object.keys(candidate.pool)) usedCardIds.add(id);
      candidate.pool = sortCounts(candidate.pool, cardsByIdForSorting);
      candidate.reference.deck = sortCounts(candidate.reference.deck, cardsByIdForSorting);
    }

    const cardsById = {};
    const basicLands = {};
    for (const card of new Set(cardByName.values())) {
      if (usedCardIds.has(card.id)) {
        cardsById[card.id] = card;
      }

      const color = BASIC_LAND_COLORS[card.name];
      if (color && !basicLands[color]) {
        basicLands[color] = card;
      }
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        provider: '17Lands',
        label: 'Anonymous 17Lands Expert Ghost',
        expansion: expansionConfig.expansion,
        format: expansionConfig.format,
        datasetUrl: expansionConfig.datasetUrl,
        set: expansionConfig.set,
        scryfallSetCodes: expansionConfig.scryfallSetCodes,
        launchEpoch: expansionConfig.launchEpoch,
        filters,
      },
      cards: sortCardsObject(cardsById),
      basicLands: sortBasicLands(basicLands),
      candidates,
    };
  }

  return { addRow, finish };
}

export function combineCandidateQueues(queues, {
  filters = DEFAULT_FILTERS,
  launchEpoch = '2026-06-06',
  label = 'Anonymous 17Lands Expert Ghost',
  shuffleSeed = 'poolbuilder-expert-ghosts-v1',
} = {}) {
  const cards = {};
  const basicLandsByExpansion = {};
  const candidates = [];
  const expansions = [];
  const datasetUrls = [];

  for (const queue of queues) {
    const expansion = queue.source.expansion;
    expansions.push(expansion);
    datasetUrls.push(queue.source.datasetUrl);
    Object.assign(cards, queue.cards);
    basicLandsByExpansion[expansion] = queue.basicLands;

    for (const candidate of queue.candidates) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  shuffleCandidates(candidates, shuffleSeed);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      provider: '17Lands',
      label,
      format: 'Sealed',
      expansion: 'MULTI',
      expansions,
      datasetUrls,
      filters,
      shuffleSeed,
      launchEpoch,
      minRunwayDays: candidates.length,
    },
    cards: sortCardsObject(cards),
    basicLands: queues[0]?.basicLands || {},
    basicLandsByExpansion,
    candidates,
  };
}

function shuffleCandidates(candidates, seed) {
  const random = mulberry32(hashString(seed));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function nextRandom() {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function cardByIdFromNames(cardByName) {
  const cardsById = new Map();
  for (const card of cardByName.values()) {
    cardsById.set(card.id, card);
  }
  return cardsById;
}

export function parseColorString(value = '') {
  return [...String(value).toUpperCase()]
    .filter(color => COLOR_ORDER.includes(color))
    .filter((color, index, colors) => colors.indexOf(color) === index);
}

export function mergeColors(...groups) {
  const colors = new Set(groups.flat());
  return COLOR_ORDER.filter(color => colors.has(color));
}

export function emptyBasics() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

export function addCount(counts, id, amount) {
  if (amount <= 0) return;
  counts[id] = (counts[id] || 0) + amount;
}

export function expandCounts(counts) {
  const ids = [];
  for (const [id, count] of Object.entries(counts || {})) {
    for (let i = 0; i < count; i++) {
      ids.push(id);
    }
  }
  return ids;
}

export function sumCounts(counts) {
  return Object.values(counts || {}).reduce((total, count) => total + Number(count || 0), 0);
}

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sortCounts(counts, cardsById) {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => {
      const cardA = cardsById.get(a);
      const cardB = cardsById.get(b);
      return compareCardsForOutput(cardA, cardB);
    })
  );
}

function sortCardsObject(cardsById) {
  return Object.fromEntries(
    Object.entries(cardsById).sort(([, a], [, b]) => compareCardsForOutput(a, b))
  );
}

function sortBasicLands(basicLands) {
  return Object.fromEntries(
    COLOR_ORDER
      .filter(color => basicLands[color])
      .map(color => [color, basicLands[color]])
  );
}

function compareCardsForOutput(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;
  return compareCollectorNumbers(a.collector_number, b.collector_number);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
