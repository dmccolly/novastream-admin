import fs from "fs";
import path from "path";
import { db } from "./db";

const JSON_PATH = path.resolve(process.cwd(), "novastream-tracks.json");

export async function importLocalTracks() {
  console.log(`Importing tracks from ${JSON_PATH}...`);

  if (!fs.existsSync(JSON_PATH)) {
    throw new Error(`File not found: ${JSON_PATH}`);
  }

  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  const tracks = data.tracks;

  console.log(`Found ${tracks.length} tracks in JSON file.`);

  const stmt = db.prepare(`
    INSERT INTO tracks (title, artist, source_url, status, created_at)
    VALUES (?, ?, ?, 'indexed', CURRENT_TIMESTAMP)
    ON CONFLICT(source_url) DO UPDATE SET
      status = 'indexed'
  `);

  const insertMany = db.transaction((entries) => {
    let count = 0;
    for (const entry of entries) {
      // Use file_path as source_url since it's the Dropbox path
      const sourceUrl = entry.file_path || entry.path_lower || entry.path_display;
      
      // Extract title/artist from filename if missing in JSON
      let title = entry.title;
      let artist = entry.artist;

      if (!title || title === "Unknown Title") {
        const filename = path.basename(sourceUrl, path.extname(sourceUrl));
        // Try to parse "Artist - Title" or "Title - Artist"
        if (filename.includes(" - ")) {
          const parts = filename.split(" - ");
          if (parts.length >= 2) {
             // Heuristic: Assume Artist - Title usually
             artist = parts[0].trim();
             title = parts.slice(1).join(" - ").trim();
          } else {
             title = filename;
          }
        } else {
          title = filename;
        }
      }

      if (sourceUrl) {
        stmt.run(title || "Unknown Title", artist || "Unknown Artist", sourceUrl);
        count++;
      }
    }
    return count;
  });

  const addedCount = insertMany(tracks);
  console.log(`Successfully imported ${addedCount} tracks.`);
  
  return { success: true, count: addedCount, total: tracks.length };
}
