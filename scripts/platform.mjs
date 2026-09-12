import { spawnSync } from 'node:child_process';

const action = process.argv[2] ?? 'dev';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === 'darwin') {
  if (action === 'dev') run('swift', ['run', '--package-path', 'macos', 'Trackem']);
  else if (action === 'build') run('swift', ['build', '--package-path', 'macos', '-c', 'release']);
  else if (action === 'dist') run('sh', ['scripts/build-macos-app.sh']);
  else throw new Error(`Unknown action: ${action}`);
} else if (process.platform === 'win32') {
  run('pnpm', ['build:electron']);
  if (action === 'dev') run('electron', ['.']);
  else if (action === 'dist') run('electron-builder', ['--win', '--publish', 'never']);
  else if (action !== 'build') throw new Error(`Unknown action: ${action}`);
} else {
  throw new Error('Trackem supports macOS and Windows.');
}
