import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Swift/AppKit build and tests are macOS-only; skipped on this host.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../native/macos-tray/', import.meta.url));
const test = process.argv[2] === 'test';
const args = test ? ['test', '--disable-xctest'] : ['build', '-c', 'release'];
if (test) {
  // New CLT layouts keep Testing's compiler plugin in a subdirectory SwiftPM
  // does not yet discover. Full Xcode and older toolchains need no override.
  const swift = spawnSync('xcrun', ['--find', 'swift'], { encoding: 'utf8' }).stdout?.trim();
  if (swift) {
    const plugins = path.resolve(path.dirname(swift), '../lib/swift/host/plugins/testing');
    if (existsSync(path.join(plugins, 'libTestingMacros.dylib'))) args.push('-Xswiftc', '-plugin-path', '-Xswiftc', plugins);
  }
}
const result = spawnSync('xcrun', ['swift', ...args, '--package-path', root], { stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error('Swift command failed. See the compiler output above. Native builds require Xcode or Command Line Tools; tests require Swift 6+.');
  process.exit(result.status || 1);
}
if (!test) {
  const contents = path.join(root, 'build/TrackemTray.app/Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  copyFileSync(path.join(root, 'Info.plist'), path.join(contents, 'Info.plist'));
  const executable = path.join(contents, 'MacOS/TrackemTray');
  copyFileSync(path.join(root, '.build/release/TrackemTray'), executable);
  chmodSync(executable, 0o755);
  // electron-builder signs this nested app again with the release identity when configured.
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', path.join(root, 'build/TrackemTray.app')], { stdio: 'inherit' });
  if (signed.status !== 0) process.exit(signed.status || 1);
}
