import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
import {
  COLOR_ORDER,
  expandCounts,
  readJson,
} from './lib/17lands.js';

const DEFAULT_QUEUE = 'data/17lands-sos-candidates.json';
const DEFAULT_API_URL = 'https://poolbuilder-api.brostar.workers.dev';

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

export function getTodayUTC() {
  return new Date().toISOString().split('T')[0];
}

export function selectCandidate(candidates, date, launchEpoch) {
  if (!candidates.length) {
    throw new Error('candidate queue is empty');
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const offset = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${launchEpoch}T00:00:00Z`)) / dayMs);
  const index = ((offset % candidates.length) + candidates.length) % candidates.length;
  return { candidate: candidates[index], index };
}

export function buildDailyPayload(queue, candidate, date, index) {
  const poolIds = expandCounts(candidate.pool);
  const pool = poolIds.map(id => {
    const card = queue.cards[id];
    if (!card) throw new Error(`candidate ${candidate.sourceId} references missing card ${id}`);
    return card;
  });

  return {
    date,
    seed: `expert-${date}`,
    mode: 'expert-ghost',
    set: queue.source.set,
    source: {
      provider: queue.source.provider,
      label: queue.source.label,
      format: queue.source.format,
      expansion: queue.source.expansion,
      sourceId: candidate.sourceId,
      queueIndex: index,
      filters: queue.source.filters,
      datasetUrl: queue.source.datasetUrl,
    },
    pool,
    basicLands: queue.basicLands,
  };
}

export function buildWorkerSeedPayload(queue, candidate, date) {
  return {
    date,
    sourceId: candidate.sourceId,
    reference: {
      id: 'expert-ghost',
      kind: 'reference',
      name: 'Expert Ghost',
      sourceId: candidate.sourceId,
      cardIds: expandCounts(candidate.reference.deck),
      basics: normalizeBasics(candidate.reference.basics),
      colors: candidate.reference.colors || [],
      mainColors: candidate.reference.mainColors || [],
      splashColors: candidate.reference.splashColors || [],
      stats: candidate.stats,
      source: {
        provider: queue.source.provider,
        label: queue.source.label,
        format: queue.source.format,
        expansion: queue.source.expansion,
      },
    },
  };
}

function normalizeBasics(basics = {}) {
  return Object.fromEntries(COLOR_ORDER.map(color => [color, Number(basics[color] || 0)]));
}

export async function seedWorker(payload, { apiUrl, adminSecret, required = false } = {}) {
  if (!adminSecret) {
    const message = 'POOLBUILDER_ADMIN_SECRET is not set; skipping worker reference seed';
    if (required) throw new Error(message);
    console.warn(message);
    return false;
  }

  const response = await fetch(`${apiUrl || DEFAULT_API_URL}/admin/daily`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminSecret}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poolbuilder-daily-generator/1.0',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`worker seed failed: ${response.status} ${text}`);
  }

  return true;
}

export async function generateDaily({ date, queuePath = DEFAULT_QUEUE, outputPath = 'daily.json', seed = true, requireWorker = false } = {}) {
  const queue = await readJson(queuePath);
  const selectedDate = date || getTodayUTC();
  const { candidate, index } = selectCandidate(queue.candidates, selectedDate, queue.source.launchEpoch);
  const daily = buildDailyPayload(queue, candidate, selectedDate, index);
  const workerPayload = buildWorkerSeedPayload(queue, candidate, selectedDate);

  await writeFile(outputPath, JSON.stringify(daily));
  console.log(`wrote ${outputPath} for ${selectedDate} (${candidate.sourceId})`);

  if (seed) {
    await seedWorker(workerPayload, {
      apiUrl: process.env.POOLBUILDER_API_URL || DEFAULT_API_URL,
      adminSecret: process.env.POOLBUILDER_ADMIN_SECRET || process.env.ADMIN_SECRET,
      required: requireWorker,
    });
  }

  return { daily, workerPayload, candidate, index };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await generateDaily({
    date: args.date || process.env.DAILY_DATE,
    queuePath: args.queue || DEFAULT_QUEUE,
    outputPath: args.output || 'daily.json',
    seed: !args['skip-worker'],
    requireWorker: Boolean(args['require-worker']),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
