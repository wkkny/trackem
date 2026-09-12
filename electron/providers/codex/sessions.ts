import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionUsageSummary {
  /** Model with the highest token usage across scanned sessions, or null. */
  topModel: string | null;
  tokensByModel: Record<string, number>;
  scannedFiles: number;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: SessionUsageSummary }>();

export async function readBoundedFile(file: string, maxBytes: number): Promise<string> {
  const handle = await fsPromises.open(file, 'r');
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - bytesRead));
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      chunks.push(buffer.subarray(0, result.bytesRead));
      bytesRead += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return Buffer.concat(chunks, bytesRead).toString('utf8');
}

async function listSessionFiles(home: string): Promise<string[]> {
  const roots = [path.join(home, 'archived_sessions'), path.join(home, 'sessions')];
  const files: string[] = [];
  const cutoff = Date.now() - WINDOW_MS;
  let visited = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++visited > 5000) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  }

  await Promise.all(roots.map((root) => walk(root, 0)));

  // Keep only recently touched files, newest first.
  const withMtime: Array<{ file: string; mtime: number }> = [];
  for (const file of files) {
    try {
      const mtime = (await fsPromises.stat(file)).mtimeMs;
      if (mtime >= cutoff) withMtime.push({ file, mtime });
    } catch {
      /* file vanished */
    }
  }
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, MAX_FILES).map((entry) => entry.file);
}

interface ModelTally {
  tokens: number;
  turns: number;
}

/**
 * Attribute tokens per model from native Codex session logs.
 * `turn_context` lines carry the active model; `event_msg`/`token_count` lines
 * carry usage in `payload.info` (total_token_usage or flat token counts).
 */
function tallyContent(content: string, byModel: Map<string, ModelTally>): void {
  let currentModel: string | null = null;
  let previousTotal = 0;
  for (const line of content.split('\n')) {
    // Inspect parsed event types, never matching model names inside prompt text.
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'turn_context') {
      const model = event.payload?.model ?? event.model;
      if (typeof model === 'string') {
        currentModel = model;
        const tally = byModel.get(model) ?? { tokens: 0, turns: 0 };
        tally.turns += 1;
        byModel.set(model, tally);
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
      const info = event.payload.info;
      const model = info?.model ?? info?.model_name ?? currentModel;
      const usage = info?.total_token_usage;
      const total = usage ? Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0) : info?.total_token_count;
      if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) continue;
      // Native counters are cumulative. Repeated events must not double-count tokens.
      const tokens = total >= previousTotal ? total - previousTotal : total;
      previousTotal = total;
      if (typeof model !== 'string') continue;

      const tally = byModel.get(model) ?? { tokens: 0, turns: 0 };
      tally.tokens += tokens;
      byModel.set(model, tally);
    }
  }
}

/** Scan local Codex session logs for per-model token usage. Best-effort, never throws. */
export async function scanSessionUsage(
  home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
): Promise<SessionUsageSummary> {
  const cached = cache.get(home);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.result;
  const byModel = new Map<string, ModelTally>();
  let scannedFiles = 0;
  let scannedBytes = 0;
  try {
    const files = await listSessionFiles(home);
    for (const file of files) {
      try {
        const stat = await fsPromises.stat(file);
        if (stat.size > MAX_FILE_BYTES || scannedBytes + stat.size > MAX_SCAN_BYTES) continue;
        const content = await readBoundedFile(file, Math.min(MAX_FILE_BYTES, MAX_SCAN_BYTES - scannedBytes));
        scannedBytes += Buffer.byteLength(content);
        if (scannedBytes > MAX_SCAN_BYTES) break;
        tallyContent(content, byModel);
        scannedFiles += 1;
      } catch { /* file vanished or is inaccessible */ }
    }
  } catch {
    /* scanning is best-effort */
  }

  let topModel: string | null = null;
  for (const [model, tally] of byModel) {
    if (tally.tokens <= 0) continue;
    if (!topModel || tally.tokens > (byModel.get(topModel)?.tokens ?? 0)) topModel = model;
  }

  const tokensByModel: Record<string, number> = {};
  for (const [model, tally] of byModel) tokensByModel[model] = tally.tokens;
  const result = { topModel, tokensByModel, scannedFiles };
  if (cache.size >= 21) cache.delete(cache.keys().next().value!);
  cache.set(home, { at: Date.now(), result });
  return result;
}
