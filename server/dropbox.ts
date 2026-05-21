import { db } from "./db";
import { getDropboxClient } from "./auth";

type SyncMode = "full" | "incremental";

interface SyncResult {
  success: boolean;
  mode: SyncMode;
  scanned: number;
  tracksAdded: number;
  tracksRemoved: number;
  total: number;
}

function getCursor(): string | undefined {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'dropbox_cursor'")
    .get() as { value?: string } | undefined;
  return row?.value;
}

function setCursor(cursor: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('dropbox_cursor', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(cursor);
}

export async function syncDropbox(mode: SyncMode = "full"): Promise<SyncResult> {
  const dbx = await getDropboxClient();
  const lastCursor = getCursor();
  const effectiveMode: SyncMode =
    mode === "incremental" && lastCursor ? "incremental" : "full";

  console.log(
    `Starting Dropbox sync (requested=${mode}, effective=${effectiveMode})...`
  );

  let entries: any[] = [];
  let response: any;

  if (effectiveMode === "incremental") {
    response = await dbx.filesListFolderContinue({ cursor: lastCursor! });
  } else {
    response = await dbx.filesListFolder({ path: "", recursive: true });
  }
  entries = entries.concat(response.result.entries);

  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({
      cursor: response.result.cursor,
    });
    entries = entries.concat(response.result.entries);
  }

  const finalCursor: string = response.result.cursor;
  console.log(`Fetched ${entries.length} entries from Dropbox.`);

  const insertStmt = db.prepare(`
    INSERT INTO tracks (title, artist, source_url, status, created_at)
    VALUES (?, ?, ?, 'indexed', CURRENT_TIMESTAMP)
    ON CONFLICT(source_url) DO UPDATE SET status = 'indexed'
  `);
  const removeStmt = db.prepare(`DELETE FROM tracks WHERE source_url = ?`);

  let added = 0;
  let removed = 0;

  const tx = db.transaction((items: any[]) => {
    for (const entry of items) {
      const tag = entry[".tag"];
      if (tag === "file" && isAudioFile(entry.name)) {
        const path = entry.path_lower || entry.path_display;
        const { artist, title } = parseFilename(entry.name);
        insertStmt.run(title, artist, path);
        added++;
      } else if (tag === "deleted") {
        const path = entry.path_lower || entry.path_display;
        if (path) {
          const info = removeStmt.run(path);
          if (info.changes > 0) removed++;
        }
      }
    }
  });
  tx(entries);

  if (finalCursor) setCursor(finalCursor);

  console.log(
    `Sync done. mode=${effectiveMode} scanned=${entries.length} added=${added} removed=${removed}`
  );

  return {
    success: true,
    mode: effectiveMode,
    scanned: entries.length,
    tracksAdded: added,
    tracksRemoved: removed,
    total: entries.length,
  };
}

function isAudioFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "aiff", "aif"].includes(
    ext || ""
  );
}

function parseFilename(filename: string): { artist: string; title: string } {
  const name = filename.substring(0, filename.lastIndexOf("."));
  const parts = name.split(" - ");

  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }

  return {
    artist: "Unknown Artist",
    title: name.trim(),
  };
}
