// Disk-backed persistence for session records.
//
// Records are written one-file-per-session under data/sessions/. Live progress
// ticks stay in memory (store.ts) and are NOT flushed on every heartbeat; we
// persist on the meaningful transitions (create, complete, fail, findings,
// cancel) so history survives a restart without hammering the disk once/second.

import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "sessions");

function ensureDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(id: string): string {
  return path.join(DATA_DIR, `${id}.json`);
}

/** Write a record durably (atomic: temp file + rename). */
export function persist(record: SessionRecord): void {
  try {
    ensureDir();
    const tmp = fileFor(record.id) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
    fs.renameSync(tmp, fileFor(record.id));
  } catch (err) {
    console.error(`[persistence] failed to persist ${record.id}:`, err);
  }
}

/** Load every persisted record (used once to warm the in-memory store). */
export function loadAll(): SessionRecord[] {
  try {
    ensureDir();
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    const out: SessionRecord[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
        out.push(JSON.parse(raw) as SessionRecord);
      } catch {
        // Skip a corrupt/partial file rather than failing the whole load.
      }
    }
    return out;
  } catch (err) {
    console.error("[persistence] failed to load:", err);
    return [];
  }
}
