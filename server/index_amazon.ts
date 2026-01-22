import { Dropbox } from "dropbox";
import { db } from "./db";
import "dotenv/config";

// Token from environment
const ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || "";

async function indexAmazon() {
  console.log("Starting index of /AmazonDownloads/Amazon Music...");
  const dbx = new Dropbox({ accessToken: ACCESS_TOKEN });

  try {
    // List specifically the Amazon folder
    let response = await dbx.filesListFolder({ 
      path: "/AmazonDownloads/Amazon Music", 
      recursive: true 
    });
    
    let files = response.result.entries;

    while (response.result.has_more) {
      console.log(`Fetched ${files.length} files so far...`);
      response = await dbx.filesListFolderContinue({ cursor: response.result.cursor });
      files = files.concat(response.result.entries);
    }

    console.log(`Total files found in Amazon folder: ${files.length}`);

    const stmt = db.prepare(`
      INSERT INTO tracks (title, artist, source_url, status, created_at)
      VALUES (?, ?, ?, 'indexed', CURRENT_TIMESTAMP)
      ON CONFLICT(source_url) DO UPDATE SET
        status = 'indexed',
        created_at = CURRENT_TIMESTAMP
    `);

    const insertMany = db.transaction((entries) => {
      let count = 0;
      for (const entry of entries) {
        if (entry[".tag"] === "file" && isAudioFile(entry.name)) {
          const path = entry.path_lower || entry.path_display;
          const { artist, title } = parseFilename(entry.name);
          
          try {
            stmt.run(title, artist, path);
            count++;
          } catch (e) {
            console.error(`Failed to insert ${path}:`, e);
          }
        }
      }
      return count;
    });

    const addedCount = insertMany(files);
    console.log(`Successfully indexed ${addedCount} audio files from Amazon folder.`);

  } catch (error: any) {
    console.error("Indexing failed:", error);
    if (error.error && error.error.path) {
        console.error("Path error details:", error.error.path);
    }
  }
}

function isAudioFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'].includes(ext || '');
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

indexAmazon();
