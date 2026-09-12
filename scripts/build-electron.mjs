import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const outputDirectory = fileURLToPath(new URL('../electron/dist/', import.meta.url));
rmSync(outputDirectory, { recursive: true, force: true });

const result = spawnSync('tsc', ['-p', 'electron/tsconfig.json'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
