import { access } from 'fs/promises';
import { join } from 'path';
import {
  buildCandidateQueueFromGzipCsv,
  buildNameResolver,
  DEFAULT_FILTERS,
  downloadFile,
  EXPANSION_CONFIGS,
  fetchScryfallPrints,
} from './lib/17lands.js';

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

function defaultInputPath(expansion) {
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    return join(process.env.USERPROFILE, 'Downloads', `game_data_public.${expansion}.Sealed.csv.gz`);
  }
  return join('.cache', `game_data_public.${expansion}.Sealed.csv.gz`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const expansion = String(args.expansion || 'SOS').toUpperCase();
  const config = EXPANSION_CONFIGS[expansion];
  if (!config) {
    throw new Error(`unsupported expansion ${expansion}; add it to EXPANSION_CONFIGS first`);
  }

  const input = args.input || process.env.SEVENTEENLANDS_INPUT || defaultInputPath(expansion);
  const output = args.output || join('data', `17lands-${expansion.toLowerCase()}-candidates.json`);
  const shouldDownload = args.download || !(await fileExists(input));

  if (shouldDownload) {
    console.log(`downloading ${config.datasetUrl}`);
    await downloadFile(config.datasetUrl, input);
  }

  console.log(`fetching Scryfall prints: ${config.scryfallSetCodes.join(', ')}`);
  const scryfallCards = await fetchScryfallPrints(config.scryfallSetCodes);
  const cardByName = buildNameResolver(scryfallCards, config.scryfallSetCodes);

  console.log(`reading ${input}`);
  const { queue, rowCount } = await buildCandidateQueueFromGzipCsv({
    filePath: input,
    expansionConfig: config,
    cardByName,
    filters: {
      buildIndex: Number(args.buildIndex ?? DEFAULT_FILTERS.buildIndex),
      minUserGamesBucket: Number(args.minGames ?? DEFAULT_FILTERS.minUserGamesBucket),
      minUserWinRateBucket: Number(args.minWinRate ?? DEFAULT_FILTERS.minUserWinRateBucket),
    },
  });
  console.log(`scanned ${rowCount.toLocaleString()} game rows`);

  await import('fs/promises').then(fs => fs.mkdir('data', { recursive: true }));
  await import('fs/promises').then(fs => fs.writeFile(output, JSON.stringify(queue)));
  console.log(`wrote ${output}`);
  console.log(`${queue.candidates.length.toLocaleString()} candidates, ${Object.keys(queue.cards).length.toLocaleString()} cards`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
