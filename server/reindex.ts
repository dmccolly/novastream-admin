import fs from 'fs';
import path from 'path';
import { db } from './db';
import { randomUUID } from 'crypto';

const STORAGE_DIRS = [
  '/root/novastream-admin/storage/music',
  '/root/novastream-backend/storage/music',
  '/root/novastream/dist/public/downloads' // Possible location
];

async function reindex() {
  console.log('Starting re-indexing process...');
  let count = 0;

  for (const dir of STORAGE_DIRS) {
    if (!fs.existsSync(dir)) {
      console.log(`Directory not found: ${dir}`);
      continue;
    }

    console.log(`Scanning directory: ${dir}`);
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (!file.endsWith('.mp3')) continue;

      const fullPath = path.join(dir, file);
      
      // Check if already exists
      const existing = db.prepare('SELECT id FROM tracks WHERE filepath = ?').get(fullPath);
      if (existing) {
        console.log(`Skipping existing: ${file}`);
        continue;
      }

      // Parse filename for metadata if possible
      // Format often: "Title_UUID.mp3" or "Artist - Title_UUID.mp3"
      let title = file.replace('.mp3', '');
      let artist = 'Unknown Artist';
      
      // Try to extract artist/title from filename if it follows "Artist - Title" pattern
      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        artist = parts[0];
        title = parts.slice(1).join(' - ');
      }

      // Clean up UUID suffix if present (e.g., _657c96ac...)
      const uuidMatch = title.match(/_([a-f0-9-]{36})$/);
      if (uuidMatch) {
        title = title.replace(uuidMatch[0], '');
      }

      const id = randomUUID();
      const now = Date.now();

      try {
        db.prepare(`
          INSERT INTO tracks (id, title, artist, filepath, status, created_at, is_active, is_downloaded)
          VALUES (?, ?, ?, ?, 'indexed', ?, 1, 1)
        `).run(id, title, artist, fullPath, now);
        
        console.log(`Indexed: ${artist} - ${title}`);
        count++;
      } catch (err) {
        console.error(`Failed to index ${file}:`, err);
      }
    }
  }

  console.log(`Re-indexing complete. Added ${count} tracks.`);
}

reindex().catch(console.error);
