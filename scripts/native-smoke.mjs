import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('The AppKit smoke test requires a macOS desktop session.');
  process.exit(1);
}
const binary = fileURLToPath(new URL('../native/macos-tray/build/TrackemTray.app/Contents/MacOS/TrackemTray', import.meta.url));
const child = spawn(binary, ['--smoke-test'], { stdio: ['pipe', 'pipe', 'pipe'] });
let ready = false;
let output = '';
const timeout = setTimeout(() => { child.kill(); console.error('Native UI smoke test timed out.'); process.exitCode = 1; }, 10_000);
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  output += chunk;
  if (output.length > 1024) { child.kill(); return; }
  if (output.includes('\n')) {
    try { const message = JSON.parse(output.trim()); ready = message.version === 1 && message.type === 'ready'; }
    catch { child.kill(); }
  }
});
child.stderr.resume();
child.on('error', () => { console.error('Could not launch native UI smoke test. Build the helper first.'); process.exitCode = 1; clearTimeout(timeout); });
child.on('exit', code => {
  clearTimeout(timeout);
  if (code !== 0 || !ready) { console.error('Native UI smoke test failed.'); process.exitCode = 1; }
  else console.log('AppKit status item, popover construction and shutdown passed.');
});
