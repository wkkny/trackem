import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SessionUsageSummary {
  /** Model with the highest token usage across scanned sessions, or null. */
  topModel: string | null;
  tokensByModel: Record<string, number>;
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
    let entries;
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

interface ModelTally {
  tokens: number;
  turns: number;
}

/**
 * Attribute tokens per model from native Codex session logs.
 * `turn_context` lines carry the active model; `event_msg`/`token_count` lines
 * carry usage in `payload.info` (total_token_usage or flat token counts).
 */
function tallyFile(file: string, byModel: Map<string, ModelTally>): void {
  let content: string;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return;
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  let currentModel: string | null = null;
  for (const line of content.split('\n')) {
    if (!line.includes('"type"')) continue;

    if (line.includes('"turn_context"')) {
      const model = line.match(/"model":"([^"]+)"/)?.[1];
      if (model) {
        currentModel = model;
        const tally = byModel.get(model) ?? { tokens: 0, turns: 0 };
        tally.turns += 1;
        byModel.set(model, tally);
      }
      continue;
    }

    if (line.includes('"event_msg"') && line.includes('"token_count"')) {
      const infoModel = line.match(/"model(?:_name)?":"([^"]+)"/)?.[1];
      const model = infoModel ?? currentModel;
      if (!model) continue;

      // Token usage: prefer the total_token_usage object, fall back to a flat counter.
      const usageMatch = line.match(/"total_token_usage":\{[^}]*\}/);
      let tokens = 0;
      if (usageMatch) {
        const input = Number(usageMatch[0].match(/"input_tokens":(\d+)/)?.[1] ?? 0);
        const output = Number(usageMatch[0].match(/"output_tokens":(\d+)/)?.[1] ?? 0);
        tokens = input + output;
      } else {
        tokens = Number(line.match(/"total_token_count":(\d+)/)?.[1] ?? 0);
      }

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
  const byModel = new Map<string, ModelTally>();
  let scannedFiles = 0;
  try {
    const files = await listSessionFiles(home);
    for (const file of files) {
      tallyFile(file, byModel);
      scannedFiles += 1;
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
  return { topModel, tokensByModel, scannedFiles };
}
