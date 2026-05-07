import { db } from "./db";
import { getDropboxClient } from "./auth";

export async function syncDropbox() {
  console.log("Starting Dropbox sync...");
  
  try {
    const dbx = await getDropboxClient();
    
    let response = await dbx.filesListFolder({ path: "", recursive: true });
    let files = response.result.entries;

    while (response.result.has_more) {
      console.log(`Fetched ${files.length} files so far...`);
      response = await dbx.filesListFolderContinue({ cursor: response.result.cursor });
      files = files.concat(response.result.entries);
    }

    console.log(`Total files found in Dropbox: ${files.length}`);

    const stmt = db.prepare(`
      INSERT INTO tracks (title, artist, source_url, status, created_at)
      VALUES (?, ?, ?, 'indexed', CURRENT_TIMESTAMP)
      ON CONFLICT(source_url) DO UPDATE SET
        status = 'indexed'
    `);

    const insertMany = db.transaction((entries: any[]) => {
      let count = 0;
      for (const entry of entries) {
        if (entry[".tag"] === "file" && isAudioFile(entry.name)) {
          const path = entry.path_lower || entry.path_display;
          const { artist, title } = parseFilename(entry.name);
          
          stmt.run(title, artist, path);
          count++;
        }
      }
      return count;
    });

    const addedCount = insertMany(files);
    console.log(`Successfully indexed ${addedCount} audio files.`);
    
    return { success: true, count: addedCount, total: files.length };

  } catch (error: any) {
    console.error("Dropbox sync failed:", error);
    throw error;
  }
}

function isAudioFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'aiff', 'aif'].includes(ext || '');
}

function parseFilename(filename: string): { artist: string, title: string } {
  const name = filename.substring(0, filename.lastIndexOf('.'));
  const parts = name.split(' - ');
  
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  }
  
  return {
    artist: "Unknown Artist",
    title: name.trim()
  };
}
