import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const source = join('node_modules', '@benson', 'ui', 'dist');
const target = join('vendor', 'benson-ui');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

console.log(`synced ${source} -> ${target}`);
