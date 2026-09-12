import * as fsPromises from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionUsageSummary {
  /** Model with the highest token usage across scanned sessions, or null. */
  topModel: string | null;
  scannedFiles: number;
}

const MAX_FILES = 300;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function listSessionFiles(home: string): Promise<string[]> {
  const roots = [path.join(home, 'archived_sessions'), path.join(home, 'sessions')];
  const files: string[] = [];
  const cutoff = Date.now() - WINDOW_MS;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
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

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function usageTotal(value: unknown): number | null {
  const usage = asObject(value);
  if (!usage) return null;

  const total = asTokenCount(usage.total_tokens);
  if (total !== null) return total;

  const input = asTokenCount(usage.input_tokens);
  const output = asTokenCount(usage.output_tokens);
  return input === null && output === null ? null : (input ?? 0) + (output ?? 0);
}

function readModel(...sources: Array<JsonObject | null>): string | null {
  for (const source of sources) {
    const model = source?.model_name ?? source?.model;
    if (typeof model === 'string' && model.length > 0) return model;
  }
  return null;
}

/**
 * Attribute tokens per model from native Codex session logs.
 * `turn_context` lines carry the active model; `event_msg`/`token_count` lines
 * carry usage in `payload.info`.
 */
async function tallyFile(file: string, byModel: Map<string, number>): Promise<void> {
  let content: string;
  try {
    const stat = await fsPromises.stat(file);
    if (stat.size > MAX_FILE_BYTES) return;
    content = await fsPromises.readFile(file, 'utf8');
  } catch {
    return;
  }

  let currentModel: string | null = null;
  let previousTotal: number | null = null;
  let incrementalSinceTotal = 0;
  for (const line of content.split('\n')) {
    let event: JsonObject | null;
    try {
      event = asObject(JSON.parse(line));
    } catch {
      continue;
    }
    if (!event) continue;

    const payload = asObject(event.payload);
    if (event.type === 'turn_context') {
      currentModel = readModel(payload, event) ?? currentModel;
      continue;
    }

    if (event.type !== 'event_msg' || payload?.type !== 'token_count') continue;

    const info = asObject(payload.info);
    if (!info) continue;

    const cumulativeTotal = usageTotal(info.total_token_usage) ?? asTokenCount(info.total_token_count);
    const incrementalTotal = usageTotal(info.last_token_usage);
    let tokens = 0;

    if (incrementalTotal !== null) {
      tokens = incrementalTotal;
      if (cumulativeTotal === null) incrementalSinceTotal += incrementalTotal;
    } else if (cumulativeTotal !== null) {
      const counterReset = previousTotal !== null && cumulativeTotal < previousTotal;
      const cumulativeDelta = previousTotal === null || counterReset
        ? cumulativeTotal
        : cumulativeTotal - previousTotal;
      tokens = counterReset ? cumulativeDelta : Math.max(0, cumulativeDelta - incrementalSinceTotal);
    }

    if (cumulativeTotal !== null) {
      previousTotal = cumulativeTotal;
      incrementalSinceTotal = 0;
    }

    const model = readModel(info, payload, event) ?? currentModel;
    if (!model || tokens <= 0) continue;
    byModel.set(model, (byModel.get(model) ?? 0) + tokens);
  }
}

/** Scan local Codex session logs for per-model token usage. Best-effort, never throws. */
export async function scanSessionUsage(
  home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
): Promise<SessionUsageSummary> {
  const byModel = new Map<string, number>();
  let scannedFiles = 0;
  try {
    const files = await listSessionFiles(home);
    for (const file of files) {
      await tallyFile(file, byModel);
      scannedFiles += 1;
    }
  } catch {
    /* scanning is best-effort */
  }

  let topModel: string | null = null;
  for (const [model, tokens] of byModel) {
    if (!topModel || tokens > (byModel.get(topModel) ?? 0)) topModel = model;
  }

  return { topModel, scannedFiles };
}
