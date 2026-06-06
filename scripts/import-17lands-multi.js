import { createHash } from 'crypto';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  buildCandidateQueueFromGzipCsv,
  buildNameResolver,
  combineCandidateQueues,
  DEFAULT_FILTERS,
  downloadFile,
  fetchScryfallPrints,
} from './lib/17lands.js';

const FILTERS_URL = 'https://www.17lands.com/data/filters';
const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';
const DATASET_BASE_URL = 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data';
const OUTPUT_PATH = 'data/17lands-sealed-candidates.json';
const LAUNCH_EPOCH = '2026-06-06';
const MIN_RUNWAY_DAYS = 365;
const WIN_RATE_THRESHOLDS = [0.86, 0.84, 0.82, 0.80, 0.78, 0.76, 0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60];
const EXCLUDED_SCRYFALL_SET_TYPES = new Set(['alchemy', 'box', 'funny', 'memorabilia', 'promo', 'token']);
const ALWAYS_INCLUDE_SET_CODES = ['plst', 'spg'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'poolbuilder/17lands-ingest (https://bensonperry.com/poolbuilder)' },
  });
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return response.json();
}

function datasetUrl(expansion) {
  return `${DATASET_BASE_URL}/game_data_public.${expansion}.Sealed.csv.gz`;
}

function cachePath(expansion) {
  return join('.cache', `game_data_public.${expansion}.Sealed.csv.gz`);
}

function scryfallCachePath(setCodes) {
  const key = createHash('sha1').update(setCodes.join(',')).digest('hex').slice(0, 12);
  return join('.cache', `scryfall-prints-${key}.json`);
}

function normalSealedExpansionCodes(filters) {
  return Object.entries(filters.formats_by_expansion)
    .filter(([expansion, formats]) => /^[A-Z0-9]{3,}$/.test(expansion) && formats.includes('Sealed'))
    .map(([expansion]) => expansion)
    .sort();
}

async function existingDatasetExpansions(expansions) {
  const existing = [];
  for (const expansion of expansions) {
    const response = await fetch(datasetUrl(expansion), { method: 'HEAD' });
    if (response.ok) {
      existing.push(expansion);
    }
  }
  return existing;
}

function scryfallSetCodesForExpansion(expansion, scryfallSets) {
  const setCode = expansion.toLowerCase();
  const codes = [];

  if (scryfallSets.has(setCode)) codes.push(setCode);

  for (const set of scryfallSets.values()) {
    if (set.parent_set_code === setCode && !EXCLUDED_SCRYFALL_SET_TYPES.has(set.set_type)) {
      codes.push(set.code);
    }
  }

  return [...new Set([...codes, ...ALWAYS_INCLUDE_SET_CODES])];
}

function expansionConfig(expansion, scryfallSets, fallbackSetCodes) {
  const setCode = expansion.toLowerCase();
  const scryfallSet = scryfallSets.get(setCode);
  const primaryCodes = scryfallSetCodesForExpansion(expansion, scryfallSets);

  return {
    expansion,
    format: 'Sealed',
    set: { code: setCode, name: scryfallSet?.name || expansion },
    scryfallSetCodes: [...new Set([...primaryCodes, ...fallbackSetCodes])],
    datasetUrl: datasetUrl(expansion),
    launchEpoch: LAUNCH_EPOCH,
  };
}

async function buildQueuesAtThreshold({ expansions, scryfallSets, scryfallCards, fallbackSetCodes, threshold }) {
  const queues = [];
  const filters = {
    buildIndex: DEFAULT_FILTERS.buildIndex,
    minUserGamesBucket: DEFAULT_FILTERS.minUserGamesBucket,
    minUserWinRateBucket: threshold,
  };

  for (const expansion of expansions) {
    const config = expansionConfig(expansion, scryfallSets, fallbackSetCodes);
    const cardByName = buildNameResolver(scryfallCards, config.scryfallSetCodes);
    const { queue, rowCount } = await buildCandidateQueueFromGzipCsv({
      filePath: cachePath(expansion),
      expansionConfig: config,
      cardByName,
      filters,
    });

    if (queue.candidates.length) {
      queues.push(queue);
    }
    console.log(`${expansion}: scanned ${rowCount.toLocaleString()} rows, ${queue.candidates.length.toLocaleString()} candidates`);
  }

  return queues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output || OUTPUT_PATH;
  const minRunwayDays = Number(args.minRunwayDays || MIN_RUNWAY_DAYS);
  const requestedThreshold = args.minWinRate ? Number(args.minWinRate) : null;
  const filters = await fetchJson(FILTERS_URL);
  const allSealedExpansions = normalSealedExpansionCodes(filters);
  const expansions = args.expansions
    ? String(args.expansions).split(',').map(expansion => expansion.trim().toUpperCase()).filter(Boolean)
    : await existingDatasetExpansions(allSealedExpansions);

  console.log(`using ${expansions.length} sealed game-data files`);

  await mkdir('.cache', { recursive: true });
  for (const expansion of expansions) {
    const path = cachePath(expansion);
    if (await fileExists(path)) continue;
    console.log(`downloading ${expansion}`);
    await downloadFile(datasetUrl(expansion), path);
  }

  const scryfallSetsData = await fetchJson(SCRYFALL_SETS_URL);
  const scryfallSets = new Map(scryfallSetsData.data.map(set => [set.code, set]));
  const fallbackSetCodes = [...new Set([
    ...allSealedExpansions.map(expansion => expansion.toLowerCase()).filter(code => scryfallSets.has(code)),
    ...ALWAYS_INCLUDE_SET_CODES,
  ])];
  const allSetCodes = [...new Set(expansions.flatMap(expansion => (
    expansionConfig(expansion, scryfallSets, fallbackSetCodes).scryfallSetCodes
  )))];

  console.log(`fetching Scryfall prints from ${allSetCodes.length} set codes`);
  const cache = scryfallCachePath(allSetCodes);
  let scryfallCards = await readJsonIfExists(cache);
  if (scryfallCards) {
    console.log(`loaded Scryfall print cache ${cache}`);
  } else {
    scryfallCards = await fetchScryfallPrints(allSetCodes);
    await writeFile(cache, JSON.stringify(scryfallCards));
  }
  console.log(`loaded ${scryfallCards.length.toLocaleString()} Scryfall prints`);

  const thresholds = requestedThreshold ? [requestedThreshold] : WIN_RATE_THRESHOLDS;
  let selectedQueues = null;
  let selectedThreshold = null;

  for (const threshold of thresholds) {
    console.log(`\ntrying min win-rate bucket >= ${threshold.toFixed(2)}`);
    const queues = await buildQueuesAtThreshold({
      expansions,
      scryfallSets,
      scryfallCards,
      fallbackSetCodes,
      threshold,
    });
    const count = queues.reduce((sum, queue) => sum + queue.candidates.length, 0);
    console.log(`total candidates at >= ${threshold.toFixed(2)}: ${count.toLocaleString()}`);

    if (requestedThreshold || count >= minRunwayDays) {
      selectedQueues = queues;
      selectedThreshold = threshold;
      break;
    }
  }

  if (!selectedQueues) {
    throw new Error(`no threshold produced ${minRunwayDays} candidates`);
  }

  const selectedFilters = {
    buildIndex: DEFAULT_FILTERS.buildIndex,
    minUserGamesBucket: DEFAULT_FILTERS.minUserGamesBucket,
    minUserWinRateBucket: selectedThreshold,
  };
  const combinedQueue = combineCandidateQueues(selectedQueues, {
    filters: selectedFilters,
    launchEpoch: LAUNCH_EPOCH,
  });
  combinedQueue.source.minRunwayDays = minRunwayDays;

  await mkdir('data', { recursive: true });
  await writeFile(outputPath, JSON.stringify(combinedQueue));
  console.log(`\nwrote ${outputPath}`);
  console.log(`${combinedQueue.candidates.length.toLocaleString()} candidates at >= ${selectedThreshold.toFixed(2)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
