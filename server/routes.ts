import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { execSync } from "child_process";
import { db, initDb } from "./db";
import { importLocalTracks } from "./import_local";
import { syncDropbox } from "./dropbox";
import { spawn } from "child_process";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDropboxClient, getAuthUrl, exchangeCodeForToken } from "./auth";
import { extractDuration } from "./duration";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure storage directory exists
const musicDir = path.resolve(__dirname, "..", "storage", "music");
if (!fs.existsSync(musicDir)) {
  fs.mkdirSync(musicDir, { recursive: true });
}

function ensureTagsColumn() {
  try {
    const cols = db.prepare("PRAGMA table_info(tracks)").all() as any[];
    if (!cols.some((c) => c.name === "tags")) {
      db.prepare("ALTER TABLE tracks ADD COLUMN tags TEXT DEFAULT '[]'").run();
      db.prepare("UPDATE tracks SET tags = '[]' WHERE tags IS NULL").run();
      console.log("[migration] Added tags column to tracks table");
    }
  } catch (e: any) {
    console.error("[migration] ensureTagsColumn failed:", e.message);
  }
}

export function registerRoutes(app: Express): Server {
  // Initialize DB
  initDb();
  ensureTagsColumn();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/ping", (_req, res) => {
    res.send("pong");
  });

  // --- Dropbox Auth Routes ---

  // 1. Get Auth URL
  app.get("/api/auth/dropbox/url", async (_req, res) => {
    try {
      const url = await getAuthUrl(); // Await the promise!
      res.json({ url });
    } catch (error) {
      console.error("Error generating auth URL:", error);
      res.status(500).json({ error: "Failed to generate auth URL" });
    }
  });

  // 2. Exchange Code for Token
  app.post("/api/auth/dropbox/token", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code is required" });

    try {
      await exchangeCodeForToken(code);
      res.json({ success: true, message: "Dropbox connected successfully!" });
    } catch (error) {
      console.error("Token exchange failed:", error);
      res.status(500).json({ error: "Failed to exchange token" });
    }
  });

  // ---- Per-category shuffle queue helpers ----
  function rebuildCategoryQueue(categoryId: number, avoidFirstTrackId?: number): number {
    const tracks = db
      .prepare(
        "SELECT id FROM tracks WHERE (category_id = ? OR subcategory_id = ?) " +
          "AND status = 'ready' AND filepath IS NOT NULL AND filepath NOT LIKE '%.wma'"
      )
      .all(categoryId, categoryId) as { id: number }[];

    if (tracks.length === 0) {
      db.prepare("DELETE FROM category_play_queue WHERE category_id = ?").run(categoryId);
      return 0;
    }

    const ids = tracks.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    if (
      avoidFirstTrackId != null &&
      ids.length > 1 &&
      ids[0] === avoidFirstTrackId
    ) {
      [ids[0], ids[1]] = [ids[1], ids[0]];
    }

    const insert = db.prepare(
      "INSERT INTO category_play_queue (category_id, track_id, position, consumed) VALUES (?, ?, ?, 0)"
    );
    const wipe = db.prepare("DELETE FROM category_play_queue WHERE category_id = ?");
    const tx = db.transaction((catId: number, list: number[]) => {
      wipe.run(catId);
      list.forEach((id, i) => insert.run(catId, id, i));
    });
    tx(categoryId, ids);
    return ids.length;
  }

  function popFromCategoryQueue(categoryId: number): number | null {
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = db
        .prepare(
          "SELECT cpq.id AS queue_id, cpq.track_id AS track_id " +
            "FROM category_play_queue cpq " +
            "JOIN tracks t ON cpq.track_id = t.id " +
            "WHERE cpq.category_id = ? AND cpq.consumed = 0 " +
            "AND t.filepath IS NOT NULL AND t.status = 'ready' AND t.filepath NOT LIKE '%.wma' " +
            "ORDER BY cpq.position ASC LIMIT 1"
        )
        .get(categoryId) as { queue_id: number; track_id: number } | undefined;

      if (next) {
        db.prepare("UPDATE category_play_queue SET consumed = 1 WHERE id = ?").run(next.queue_id);
        return next.track_id;
      }

      if (attempt === 0) {
        const last = db
          .prepare(
            "SELECT track_id FROM category_play_queue WHERE category_id = ? AND consumed = 1 ORDER BY position DESC LIMIT 1"
          )
          .get(categoryId) as { track_id: number } | undefined;
        const built = rebuildCategoryQueue(categoryId, last?.track_id);
        if (built === 0) return null;
      }
    }
    return null;
  }

  // POST /api/categories/:id/shuffle — (re)build shuffled rotation queue for one category
  app.post("/api/categories/:id/shuffle", (req, res) => {
    try {
      const categoryId = parseInt(req.params.id, 10);
      if (!Number.isFinite(categoryId)) {
        return res.status(400).json({ error: "Invalid category id" });
      }
      const count = rebuildCategoryQueue(categoryId);
      if (count === 0) {
        return res.status(400).json({ error: "No eligible tracks in this category" });
      }
      res.json({ success: true, queued: count });
    } catch (error) {
      console.error("Shuffle failed:", error);
      res.status(500).json({ error: "Shuffle failed" });
    }
  });

  // Sync Dropbox - Scan Dropbox for new files (full re-scan)
  app.post("/api/sync", async (_req, res) => {
    try {
      const result = await syncDropbox("full");
      res.json(result);
    } catch (error) {
      console.error("Sync failed:", error);
      res.status(500).json({ error: "Sync failed", details: (error as Error).message });
    }
  });

  // Sync Dropbox with mode: { syncType: "full" | "incremental" }
  // "incremental" uses stored cursor for delta-only scan; falls back to full on first run.
  app.post("/api/tracks/sync", async (req, res) => {
    try {
      const requested = req.body?.syncType === "full" ? "full" : "incremental";
      const result = await syncDropbox(requested);
      res.json(result);
    } catch (error) {
      console.error("Sync failed:", error);
      res.status(500).json({ error: "Sync failed", details: (error as Error).message });
    }
  });

  // List Tracks with Pagination and Search
  app.get("/api/tracks", (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string) || "";
      const category = (req.query.category as string) || "all";
      const offset = (page - 1) * limit;
      const status = (req.query.status as string) || "all";

      let query = "SELECT t.*, c.name as category_name, s.name as subcategory_name FROM tracks t LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN categories s ON t.subcategory_id = s.id WHERE 1=1";
      let countQuery = "SELECT COUNT(*) as total FROM tracks WHERE 1=1";
      const params: any[] = [];

      if (search) {
        const searchCondition = " AND (title LIKE ? OR artist LIKE ? OR album LIKE ? OR source_url LIKE ?)";
        query += searchCondition;
        countQuery += searchCondition;
        const searchParam = `%${search}%`;
        params.push(searchParam, searchParam, searchParam, searchParam);
      }

      if (category !== "all") {
        // Handle legacy string category or new ID
        if (isNaN(Number(category))) {
             const categoryCondition = " AND category = ?";
             query += categoryCondition;
             countQuery += categoryCondition;
             params.push(category);
        } else {
             const categoryCondition = " AND (category_id = ? OR subcategory_id = ?)";
             query += categoryCondition;
             countQuery += categoryCondition;
             params.push(category, category);
        }
      }

      // Status filter: "on_server" = has filepath, "cloud" = no filepath
      if (status === "on_server") {
        const statusCondition = " AND filepath IS NOT NULL";
        query += statusCondition;
        countQuery += statusCondition;
      } else if (status === "cloud") {
        const statusCondition = " AND filepath IS NULL";
        query += statusCondition;
        countQuery += statusCondition;
      }

      const tag = (req.query.tag as string) || "";
      if (tag) {
        const tagCondition = " AND tags LIKE ?";
        query += tagCondition;
        countQuery += tagCondition;
        params.push(`%"${tag}"%`);
      }

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

      const queryParams = [...params, limit, offset];

      const tracks = db.prepare(query).all(...queryParams).map((t: any) => ({
        ...t,
        url: t.filepath ? `/music/${path.basename(t.filepath)}` : null
      }));
      const totalResult = db.prepare(countQuery).get(...params) as { total: number };

      res.json({
        data: tracks,
        pagination: {
          page,
          limit,
          total: totalResult.total,
          totalPages: Math.ceil(totalResult.total / limit)
        }
      });
    } catch (error) {
      console.error("Error fetching tracks:", error);
      res.status(500).json({ error: "Failed to fetch tracks" });
    }
  });

  // Get Single Track by ID
  app.get("/api/tracks/:id", (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare(`
        SELECT t.*, c.name as category_name, s.name as subcategory_name 
        FROM tracks t 
        LEFT JOIN categories c ON t.category_id = c.id 
        LEFT JOIN categories s ON t.subcategory_id = s.id 
        WHERE t.id = ?
      `).get(id);
      
      if (!track) {
        return res.status(404).json({ error: "Track not found" });
      }
      
      res.json(track);
    } catch (error: any) {
      console.error("Error fetching track:", error);
      res.status(500).json({ error: "Failed to fetch track", details: error.message });
    }
  });

  // Get Dropbox Preview Link - for playing cloud-only tracks
  app.get("/api/tracks/:id/preview", async (req, res) => {
    console.log("[PREVIEW] Request received for track:", req.params.id);
    const { id } = req.params;
    try {
      console.log("[PREVIEW] Querying database...");
      const track = db.prepare("SELECT source_url, filepath FROM tracks WHERE id = ?").get(id) as any;
      console.log("[PREVIEW] Database query complete, track:", track ? "found" : "not found");
      
      if (!track) {
        console.log("[PREVIEW] Track not found, returning 404");
        return res.status(404).json({ error: "Track not found" });
      }
      
      // If file is on server, return appropriate URL
      // WMA and other non-browser-native formats must go through the stream endpoint for transcoding
      if (track.filepath) {
        const ext = path.extname(track.filepath).toLowerCase();
        const needsTranscode = ['.wma', '.ogg', '.flac', '.aiff', '.aif'].includes(ext);
        const localUrl = needsTranscode
          ? `/api/tracks/${id}/stream`
          : `/music/${path.basename(track.filepath)}`;
        console.log(`[PREVIEW] Track has filepath (${ext}), returning URL:`, localUrl);
        return res.json({ url: localUrl });
      }
      
      // Otherwise get temporary Dropbox link
      if (!track.source_url) {
        console.log("[PREVIEW] Track has no source_url, returning 400");
        return res.status(400).json({ error: "Track has no source URL" });
      }

      // WMA and other non-browser-native cloud files: route through transcoding stream endpoint
      const cloudExt = path.extname(track.source_url).toLowerCase();
      const cloudNeedsTranscode = ['.wma', '.ogg', '.flac', '.aiff', '.aif'].includes(cloudExt);
      if (cloudNeedsTranscode) {
        console.log(`[PREVIEW] Cloud file is ${cloudExt}, routing through transcode stream`);
        return res.json({ url: `/api/tracks/${id}/stream-cloud` });
      }

      console.log("[PREVIEW] Getting Dropbox client...");
      const dbx = await getDropboxClient();
      console.log("[PREVIEW] Got Dropbox client, getting temporary link for:", track.source_url);
      const response = await dbx.filesGetTemporaryLink({ path: track.source_url });
      console.log("[PREVIEW] Got temporary link, returning response");
      
      res.json({ url: response.result.link });
    } catch (error) {
      console.error("[PREVIEW] Error getting preview link:", error);
      res.status(500).json({ error: "Failed to get preview link" });
    }
  });

  // Stream-cloud: fetch WMA/non-native from Dropbox and transcode to MP3 on the fly
  app.get("/api/tracks/:id/stream-cloud", async (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT source_url FROM tracks WHERE id = ?").get(id) as any;
      if (!track || !track.source_url) {
        return res.status(404).json({ error: "Track not found or has no source URL" });
      }

      const dbx = await getDropboxClient();
      const response = await dbx.filesGetTemporaryLink({ path: track.source_url });
      const dropboxUrl = response.result.link;

      console.log(`[STREAM-CLOUD] Transcoding cloud file for track ${id}: ${track.source_url}`);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(200);

      const ffmpeg = spawn('ffmpeg', [
        '-i', dropboxUrl,
        '-vn',
        '-acodec', 'libmp3lame',
        '-ab', '192k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      ffmpeg.stdout.pipe(res);

      ffmpeg.stderr.on('data', (data: Buffer) => {
        // suppress ffmpeg progress output
      });

      ffmpeg.on('error', (err: Error) => {
        console.error('[STREAM-CLOUD] ffmpeg spawn error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Transcoding failed' });
        }
      });

      req.on('close', () => {
        ffmpeg.kill('SIGKILL');
      });

    } catch (error) {
      console.error("[STREAM-CLOUD] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream cloud track" });
      }
    }
  });

  // Download Track (Existing ID) - UPDATED to use Dropbox API
  app.post("/api/tracks/:id/download", async (req, res) => {
    const { id } = req.params;
    
    try {
      const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as any;
      
      if (!track) {
        return res.status(404).json({ error: "Track not found" });
      }

      if (!track.source_url) {
        return res.status(400).json({ error: "Track has no source URL" });
      }

      console.log(`Starting Dropbox download for track ${id}: ${track.source_url}`);
      
      // Update status
      db.prepare("UPDATE tracks SET status = 'downloading' WHERE id = ?").run(id);
      
      // Start async download
      downloadFromDropbox(Number(id), track.source_url);

      res.json({ id, status: "downloading", message: "Download started" });
    } catch (error) {
      console.error("Error starting download for existing track:", error);
      res.status(500).json({ error: "Failed to start download" });
    }
  });

  // Helper: convert a WMA (or other non-native) file to MP3 using ffmpeg
  // Returns the new MP3 filepath on success, or null on failure
  async function convertToMp3(inputPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const outputPath = inputPath.replace(/\.[^.]+$/, '.mp3');
      console.log(`[CONVERT] Converting ${inputPath} -> ${outputPath}`);

      const ffmpeg = spawn('ffmpeg', [
        '-y',                    // overwrite output if exists
        '-i', inputPath,
        '-vn',
        '-acodec', 'libmp3lame',
        '-ab', '192k',
        '-ar', '44100',
        '-f', 'mp3',
        outputPath
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      ffmpeg.on('close', (code: number) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          // Remove the original WMA file
          try { fs.unlinkSync(inputPath); } catch {}
          console.log(`[CONVERT] Conversion successful: ${outputPath}`);
          resolve(outputPath);
        } else {
          console.error(`[CONVERT] ffmpeg exited with code ${code}:`, stderr.slice(-500));
          resolve(null);
        }
      });

      ffmpeg.on('error', (err: Error) => {
        console.error('[CONVERT] ffmpeg spawn error:', err);
        resolve(null);
      });
    });
  }

  // Helper function to handle Dropbox download
  async function downloadFromDropbox(trackId: number, dropboxPath: string) {
    try {
      const dbx = await getDropboxClient();
      // Preserve the original extension so we know what we downloaded
      const srcExt = path.extname(dropboxPath).toLowerCase() || '.mp3';
      const filename = `${trackId}_${Date.now()}${srcExt}`;
      const filepath = path.join(musicDir, filename);

      console.log(`Downloading ${dropboxPath} to ${filepath}...`);

      const response = await dbx.filesDownload({ path: dropboxPath });
      const fileBinary = (response.result as any).fileBinary;

      if (!fileBinary) {
        throw new Error("No file data received from Dropbox");
      }

      fs.writeFileSync(filepath, fileBinary);
      console.log(`Download ${trackId} completed successfully.`);

      // Convert WMA and other non-browser-native formats to MP3
      const needsConvert = ['.wma', '.ogg', '.flac', '.aiff', '.aif'].includes(srcExt);
      let finalPath = filepath;
      if (needsConvert) {
        console.log(`[Download] ${srcExt.toUpperCase()} detected for track ${trackId}, converting to MP3...`);
        const converted = await convertToMp3(filepath);
        if (converted) {
          finalPath = converted;
          console.log(`[Download] Track ${trackId} converted to MP3: ${finalPath}`);
        } else {
          console.warn(`[Download] Conversion failed for track ${trackId}, keeping original ${srcExt} file`);
        }
      }
      
      // Extract duration using ffprobe (use finalPath which may be the converted MP3)
      const duration = await extractDuration(finalPath);
      
      if (duration) {
        console.log(`[Download] Extracted duration for track ${trackId}: ${duration}s`);
        
        // Get track category to determine default segue
        const track = db.prepare("SELECT category_id FROM tracks WHERE id = ?").get(trackId) as any;
        let defaultCueOut = duration;
        
        if (track && track.category_id) {
          const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id) as any;
          if (category) {
            const segueOffset = category.type === 'music' ? 3.0 : 0.5;
            defaultCueOut = Math.max(0, duration - segueOffset);
            console.log(`[Download] Setting cue_out to ${defaultCueOut}s (duration ${duration}s - segue ${segueOffset}s)`);
          }
        }
        
        db.prepare(
          "UPDATE tracks SET status = 'ready', filepath = ?, duration = ?, cue_out = ? WHERE id = ?"
        ).run(finalPath, duration, defaultCueOut, trackId);
      } else {
        console.warn(`[Download] Could not extract duration for track ${trackId}, setting without duration`);
        db.prepare("UPDATE tracks SET status = 'ready', filepath = ? WHERE id = ?").run(finalPath, trackId);
      }

    } catch (error: any) {
      console.error(`Download ${trackId} failed:`, error);
      db.prepare("UPDATE tracks SET status = 'error' WHERE id = ?").run(trackId);
    }
  }

  // Update Track Metadata
  app.put("/api/tracks/:id", (req, res) => {
    const { id } = req.params;
    const { title, artist, album, category_id, subcategory_id, cue_out } = req.body;
    
    try {
      // Fetch current track to check category change if needed
      const currentTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as any;
      if (!currentTrack) return res.status(404).json({ error: "Track not found" });

      let newCueOut = cue_out;

      // Auto-calculate cue_out if not provided but category changed or duration exists
      if (newCueOut === undefined && currentTrack.duration) {
        // Check if category is music (id 1 or subcategories of 1)
        // This is a simplification. Ideally we check the category type.
        // Let's fetch the category type.
        const catId = category_id || currentTrack.category_id;
        if (catId) {
          const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(catId) as any;
          if (category) {
            const offset = category.type === 'music' ? 3.0 : 0.5;
            newCueOut = Math.max(0, currentTrack.duration - offset);
          }
        }
      }

      db.prepare(`
        UPDATE tracks 
        SET title = ?, artist = ?, album = ?, category_id = ?, subcategory_id = ?, cue_out = COALESCE(?, cue_out)
        WHERE id = ?
      `).run(title, artist, album, category_id, subcategory_id, newCueOut, id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating track:", error);
      res.status(500).json({ error: "Failed to update track", details: error.message });
    }
  });

    // Update Track Cue Points
    app.patch("/api/tracks/:id/cuepoints", (req, res) => {
      const { id } = req.params;
      const { cueIn, cueOut, segueDuration } = req.body;
    
      try {
        const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as any;
        if (!track) return res.status(404).json({ error: "Track not found" });

        db.prepare(`
          UPDATE tracks 
          SET cue_in = ?, cue_out = ?, segue_duration = ?
          WHERE id = ?
        `).run(cueIn, cueOut, segueDuration, id);
      
        const updatedTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
        res.json(updatedTrack);
      } catch (error: any) {
        console.error("Error updating cue points:", error);
        res.status(500).json({ error: "Failed to update cue points", details: error.message });
      }
    });

    // Extract Duration for Track (manual trigger for existing tracks)
    app.post("/api/tracks/:id/extract-duration", async (req, res) => {
      const { id } = req.params;
      
      try {
        const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as any;
        
        if (!track) {
          return res.status(404).json({ error: "Track not found" });
        }
        
        if (!track.filepath || !fs.existsSync(track.filepath)) {
          return res.status(400).json({ error: "Track file not found on server" });
        }
        
        console.log(`[ExtractDuration] Extracting duration for track ${id}: ${track.filepath}`);
        
        const duration = await extractDuration(track.filepath);
        
        if (!duration) {
          return res.status(500).json({ error: "Failed to extract duration" });
        }
        
        console.log(`[ExtractDuration] Extracted duration for track ${id}: ${duration}s`);
        
        // Get track category to determine default cue_out
        let defaultCueOut = duration;
        
        if (track.category_id) {
          const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id) as any;
          if (category) {
            const segueOffset = category.type === 'music' ? 3.0 : 0.5;
            defaultCueOut = Math.max(0, duration - segueOffset);
            console.log(`[ExtractDuration] Setting cue_out to ${defaultCueOut}s (duration ${duration}s - segue ${segueOffset}s)`);
          }
        }
        
        // Only update cue_out if it's currently 0 or null
        const updateCueOut = !track.cue_out || track.cue_out === 0;
        
        if (updateCueOut) {
          db.prepare(
            "UPDATE tracks SET duration = ?, cue_out = ? WHERE id = ?"
          ).run(duration, defaultCueOut, id);
        } else {
          db.prepare(
            "UPDATE tracks SET duration = ? WHERE id = ?"
          ).run(duration, id);
        }
        
        const updatedTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
        res.json(updatedTrack);
      } catch (error: any) {
        console.error("Error extracting duration:", error);
        res.status(500).json({ error: "Failed to extract duration", details: error.message });
      }
    });

    // Batch Extract Duration for All Tracks
    app.post("/api/tracks/extract-duration-batch", async (req, res) => {
      try {
        const tracks = db.prepare(
          "SELECT id, filepath, category_id, duration, cue_out FROM tracks WHERE filepath IS NOT NULL AND filepath != ''"
        ).all() as any[];
        
        console.log(`[BatchExtractDuration] Processing ${tracks.length} tracks`);
        
        let processed = 0;
        let updated = 0;
        let failed = 0;
        
        for (const track of tracks) {
          if (!fs.existsSync(track.filepath)) {
            console.warn(`[BatchExtractDuration] File not found for track ${track.id}: ${track.filepath}`);
            failed++;
            continue;
          }
          
          const duration = await extractDuration(track.filepath);
          
          if (duration) {
            let defaultCueOut = duration;
            
            if (track.category_id) {
              const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id) as any;
              if (category) {
                const segueOffset = category.type === 'music' ? 3.0 : 0.5;
                defaultCueOut = Math.max(0, duration - segueOffset);
              }
            }
            
            // Only update cue_out if it's currently 0 or null
            const updateCueOut = !track.cue_out || track.cue_out === 0;
            
            if (updateCueOut) {
              db.prepare(
                "UPDATE tracks SET duration = ?, cue_out = ? WHERE id = ?"
              ).run(duration, defaultCueOut, track.id);
            } else {
              db.prepare(
                "UPDATE tracks SET duration = ? WHERE id = ?"
              ).run(duration, track.id);
            }
            
            updated++;
            console.log(`[BatchExtractDuration] Updated track ${track.id}: ${duration}s`);
          } else {
            failed++;
            console.warn(`[BatchExtractDuration] Failed to extract duration for track ${track.id}`);
          }
          
          processed++;
          
          // Send progress update every 10 tracks
          if (processed % 10 === 0) {
            console.log(`[BatchExtractDuration] Progress: ${processed}/${tracks.length} (${updated} updated, ${failed} failed)`);
          }
        }
        
        console.log(`[BatchExtractDuration] Complete: ${processed} processed, ${updated} updated, ${failed} failed`);
        
        res.json({
          processed,
          updated,
          failed,
          total: tracks.length
        });
      } catch (error: any) {
        console.error("Error in batch duration extraction:", error);
        res.status(500).json({ error: "Failed to extract durations", details: error.message });
      }
    });

    // Stream Track Audio - for waveform editor and library preview
    app.get("/api/tracks/:id/stream", (req, res) => {
      const { id } = req.params;
      try {
        const track = db.prepare("SELECT filepath FROM tracks WHERE id = ?").get(id) as { filepath: string };
        
        if (!track || !track.filepath) {
          return res.status(404).json({ error: "Track not found or not downloaded" });
        }

        // Resolve the actual file path — the DB may store an old path from a previous
        // installation (e.g. /root/novastream/storage/music/) while the files now live
        // under the current app's storage directory.
        let resolvedPath = track.filepath;
        if (!fs.existsSync(resolvedPath)) {
          const filename = path.basename(track.filepath);
          const localStoragePath = path.join(__dirname, '..', 'storage', 'music', filename);
          if (fs.existsSync(localStoragePath)) {
            resolvedPath = localStoragePath;
          } else {
            return res.status(404).json({ error: "Audio file not found on server" });
          }
        }

        // Set CORS headers for WaveSurfer.js WebAudio backend
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

        const ext = path.extname(resolvedPath).toLowerCase();

        // WMA and other non-browser-native formats: transcode to MP3 via ffmpeg
        if (ext === '.wma' || ext === '.ogg' || ext === '.flac' || ext === '.aiff' || ext === '.aif') {
          console.log(`[STREAM] Transcoding ${ext} file to MP3: ${resolvedPath}`);
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Cache-Control', 'no-cache');
          res.writeHead(200);

          const ffmpeg = spawn('ffmpeg', [
            '-i', resolvedPath,
            '-vn',                  // no video
            '-acodec', 'libmp3lame',
            '-ab', '192k',
            '-ar', '44100',
            '-f', 'mp3',
            'pipe:1'                // output to stdout
          ], { stdio: ['ignore', 'pipe', 'pipe'] });

          ffmpeg.stdout.pipe(res);

          ffmpeg.stderr.on('data', (data: Buffer) => {
            // ffmpeg writes progress to stderr — suppress unless debugging
            // console.log('[ffmpeg]', data.toString());
          });

          ffmpeg.on('error', (err: Error) => {
            console.error('[STREAM] ffmpeg spawn error:', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Transcoding failed' });
            }
          });

          req.on('close', () => {
            ffmpeg.kill('SIGKILL');
          });

          return;
        }

        // Native browser formats (MP3, AAC, WAV, etc.): serve directly with range support
        const stat = fs.statSync(resolvedPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        const mimeType = ext === '.mp3' ? 'audio/mpeg'
          : ext === '.aac' || ext === '.m4a' ? 'audio/aac'
          : ext === '.wav' ? 'audio/wav'
          : 'audio/mpeg';

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(resolvedPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
          };
          res.writeHead(200, head);
          fs.createReadStream(resolvedPath).pipe(res);
        }
      } catch (error: any) {
        console.error("Error streaming track:", error);
        res.status(500).json({ error: "Failed to stream track" });
      }
    });

    // Delete Track - Only removes file from server, keeps track in database
    app.delete("/api/tracks/:id", (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT filepath FROM tracks WHERE id = ?").get(id) as { filepath: string };
      
      // Delete physical file from server if it exists
      if (track && track.filepath && fs.existsSync(track.filepath)) {
        fs.unlinkSync(track.filepath);
        console.log(`Deleted file from server: ${track.filepath}`);
      }
      
      // Update database to clear filepath and status, but keep the track record
      db.prepare("UPDATE tracks SET filepath = NULL, status = NULL WHERE id = ?").run(id);
      console.log(`Track ${id} removed from server, remains in database as cloud-only`);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting track:", error);
      res.status(500).json({ error: "Failed to delete track" });
    }
  });

  // --- Categories ---
  app.get("/api/categories", (_req, res) => {
    try {
      const categories = db.prepare("SELECT * FROM categories ORDER BY type, parent_id, name").all();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  // ========================================================================
  // CATEGORIES — create / rename / delete with reassignment
  // ========================================================================

  // Create category (or subcategory, if parent_id provided)
  app.post("/api/categories", (req, res) => {
    const { name, parent_id, type, color } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    try {
      // If parent_id is given, inherit type from parent unless explicitly overridden
      let resolvedType = type || null;
      if (parent_id && !resolvedType) {
        const parent = db.prepare("SELECT type FROM categories WHERE id = ?").get(parent_id) as any;
        if (!parent) return res.status(400).json({ error: "Parent category not found" });
        resolvedType = parent.type;
      }

      const result = db.prepare(
        "INSERT INTO categories (name, parent_id, type, color) VALUES (?, ?, ?, ?)"
      ).run(name.trim(), parent_id || null, resolvedType, color || null);

      const created = db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid);
      res.json(created);
    } catch (error: any) {
      console.error("Error creating category:", error);
      res.status(500).json({ error: "Failed to create category", details: error.message });
    }
  });

  // Rename / update a category (name, color, type, parent_id)
  app.patch("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    const { name, color, type, parent_id } = req.body || {};
    try {
      const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as any;
      if (!existing) return res.status(404).json({ error: "Category not found" });

      // Prevent making a category its own parent
      if (parent_id !== undefined && parent_id !== null && Number(parent_id) === Number(id)) {
        return res.status(400).json({ error: "Category cannot be its own parent" });
      }

      db.prepare(`
        UPDATE categories
        SET name      = COALESCE(?, name),
            color     = COALESCE(?, color),
            type      = COALESCE(?, type),
            parent_id = ?
        WHERE id = ?
      `).run(
        name ?? null,
        color ?? null,
        type ?? null,
        parent_id === undefined ? existing.parent_id : (parent_id || null),
        id
      );

      // Sync the legacy string `category` column on tracks (best-effort; ignores errors)
      if (name && name !== existing.name) {
        try {
          db.prepare("UPDATE tracks SET category = ? WHERE category = ?").run(name, existing.name);
        } catch {}
      }

      const updated = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating category:", error);
      res.status(500).json({ error: "Failed to update category", details: error.message });
    }
  });

  // Get counts (tracks + child categories) for a category — used by delete modal
  app.get("/api/categories/:id/usage", (req, res) => {
    const { id } = req.params;
    try {
      const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as any;
      if (!category) return res.status(404).json({ error: "Category not found" });

      const trackCount = (db.prepare(
        "SELECT COUNT(*) as n FROM tracks WHERE category_id = ? OR subcategory_id = ?"
      ).get(id, id) as any).n;

      const childCount = (db.prepare(
        "SELECT COUNT(*) as n FROM categories WHERE parent_id = ?"
      ).get(id) as any).n;

      const clockItemCount = (db.prepare(
        "SELECT COUNT(*) as n FROM clock_items WHERE category_id = ?"
      ).get(id) as any).n;

      res.json({ category, trackCount, childCount, clockItemCount });
    } catch (error: any) {
      console.error("Error getting category usage:", error);
      res.status(500).json({ error: "Failed to get category usage", details: error.message });
    }
  });

  // Delete category, reassigning tracks to another category (required if any exist)
  //   DELETE /api/categories/:id?moveTo=<id>
  app.delete("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    const moveTo = req.query.moveTo ? String(req.query.moveTo) : null;

    try {
      const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as any;
      if (!category) return res.status(404).json({ error: "Category not found" });

      const trackCount = (db.prepare(
        "SELECT COUNT(*) as n FROM tracks WHERE category_id = ? OR subcategory_id = ?"
      ).get(id, id) as any).n;

      const childCount = (db.prepare(
        "SELECT COUNT(*) as n FROM categories WHERE parent_id = ?"
      ).get(id) as any).n;

      // Validate moveTo if provided
      if (moveTo) {
        if (Number(moveTo) === Number(id)) {
          return res.status(400).json({ error: "Cannot move tracks to the category being deleted" });
        }
        const target = db.prepare("SELECT id FROM categories WHERE id = ?").get(moveTo);
        if (!target) return res.status(400).json({ error: "Target category not found" });
      }

      // Require moveTo if anything references this category
      if ((trackCount > 0 || childCount > 0) && !moveTo) {
        return res.status(400).json({
          error: "Category is in use; provide ?moveTo=<categoryId> to reassign",
          trackCount,
          childCount
        });
      }

      const tx = db.transaction(() => {
        if (moveTo) {
          db.prepare("UPDATE tracks SET category_id = ? WHERE category_id = ?").run(moveTo, id);
          db.prepare("UPDATE tracks SET subcategory_id = ? WHERE subcategory_id = ?").run(moveTo, id);
          db.prepare("UPDATE tracks SET category = (SELECT name FROM categories WHERE id = ?) WHERE category = ?")
            .run(moveTo, category.name);
          db.prepare("UPDATE clock_items SET category_id = ? WHERE category_id = ?").run(moveTo, id);
          db.prepare("UPDATE categories SET parent_id = ? WHERE parent_id = ?").run(moveTo, id);
          const targetHasRule = db.prepare("SELECT id FROM rules WHERE category_id = ?").get(moveTo);
          if (!targetHasRule) {
            db.prepare("UPDATE rules SET category_id = ? WHERE category_id = ?").run(moveTo, id);
          } else {
            db.prepare("DELETE FROM rules WHERE category_id = ?").run(id);
          }
        }
        db.prepare("DELETE FROM categories WHERE id = ?").run(id);
      });

      tx();
      res.json({ success: true, movedTracks: moveTo ? trackCount : 0 });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: "Failed to delete category", details: error.message });
    }
  });


  // ========================================================================
  // BATCH TRACK OPERATIONS
  //   POST /api/tracks/batch
  // ========================================================================
  app.post("/api/tracks/batch", (req, res) => {
    const { ids, filter, action, value } = req.body || {};
    if (!action) return res.status(400).json({ error: "action is required" });

    try {
      let targetIds: number[] = [];
      if (ids === "all") {
        let q = "SELECT id FROM tracks WHERE 1=1";
        const params: any[] = [];
        const f = filter || {};
        if (f.search) {
          q += " AND (title LIKE ? OR artist LIKE ? OR album LIKE ? OR source_url LIKE ?)";
          const s = `%${f.search}%`;
          params.push(s, s, s, s);
        }
        if (f.category && f.category !== "all") {
          if (isNaN(Number(f.category))) {
            q += " AND category = ?";
            params.push(f.category);
          } else {
            q += " AND (category_id = ? OR subcategory_id = ?)";
            params.push(f.category, f.category);
          }
        }
        if (f.status === "on_server") q += " AND filepath IS NOT NULL";
        else if (f.status === "cloud") q += " AND filepath IS NULL";

        targetIds = (db.prepare(q).all(...params) as any[]).map((r) => r.id);
      } else if (Array.isArray(ids)) {
        targetIds = ids.map((x) => Number(x)).filter((n) => !isNaN(n));
      } else {
        return res.status(400).json({ error: 'ids must be an array or "all"' });
      }

      if (targetIds.length === 0) return res.json({ updated: 0, ids: [] });

      const placeholders = targetIds.map(() => "?").join(",");
      let updated = 0;

      const tx = db.transaction(() => {
        if (action === "setCategory") {
          if (value === undefined || value === null) throw new Error("value (category_id) is required");
          const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(value) as any;
          const catName = cat?.name || null;
          const info = db.prepare(
            `UPDATE tracks SET category_id = ?, category = COALESCE(?, category) WHERE id IN (${placeholders})`
          ).run(value, catName, ...targetIds);
          updated = info.changes;
        } else if (action === "setSubcategory") {
          const info = db.prepare(
            `UPDATE tracks SET subcategory_id = ? WHERE id IN (${placeholders})`
          ).run(value || null, ...targetIds);
          updated = info.changes;
        } else if (action === "addTag" || action === "removeTag") {
          const tag = typeof value === "string" ? value.trim() : "";
          if (!tag) throw new Error("value (tag) is required");
          const rows = db.prepare(
            `SELECT id, tags FROM tracks WHERE id IN (${placeholders})`
          ).all(...targetIds) as any[];
          const upd = db.prepare("UPDATE tracks SET tags = ? WHERE id = ?");
          for (const r of rows) {
            let tags: string[] = [];
            try { tags = JSON.parse(r.tags || "[]"); } catch { tags = []; }
            if (action === "addTag") {
              if (!tags.includes(tag)) tags.push(tag);
            } else {
              tags = tags.filter((t) => t !== tag);
            }
            upd.run(JSON.stringify(tags), r.id);
            updated++;
          }
        } else if (action === "clearTags") {
          const info = db.prepare(
            `UPDATE tracks SET tags = '[]' WHERE id IN (${placeholders})`
          ).run(...targetIds);
          updated = info.changes;
        } else if (action === "delete") {
          const rows = db.prepare(
            `SELECT id, filepath FROM tracks WHERE id IN (${placeholders})`
          ).all(...targetIds) as any[];
          for (const r of rows) {
            if (r.filepath && fs.existsSync(r.filepath)) {
              try { fs.unlinkSync(r.filepath); } catch (e: any) {
                console.warn(`[batch delete] Failed to unlink ${r.filepath}:`, e.message);
              }
            }
          }
          const info = db.prepare(
            `DELETE FROM tracks WHERE id IN (${placeholders})`
          ).run(...targetIds);
          updated = info.changes;
        } else {
          throw new Error(`Unknown action: ${action}`);
        }
      });

      tx();
      res.json({ updated, ids: targetIds, action });
    } catch (error: any) {
      console.error("Error in batch track operation:", error);
      res.status(500).json({ error: "Batch operation failed", details: error.message });
    }
  });


  // ========================================================================
  // TAGS — list all tags currently in use (for typeahead / filter UI)
  // ========================================================================
  app.get("/api/tags", (_req, res) => {
    try {
      const rows = db.prepare(
        "SELECT tags FROM tracks WHERE tags IS NOT NULL AND tags != '[]'"
      ).all() as any[];
      const set = new Set<string>();
      for (const r of rows) {
        try {
          const arr = JSON.parse(r.tags || "[]") as string[];
          for (const t of arr) if (t) set.add(t);
        } catch {}
      }
      res.json(Array.from(set).sort());
    } catch (error: any) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  // --- Clocks ---
  app.get("/api/clocks", (_req, res) => {
    try {
      const clocks = db.prepare("SELECT * FROM clocks").all();
      res.json(clocks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clocks" });
    }
  });

  app.post("/api/clocks", (req, res) => {
    const { name, color, mode } = req.body;
    try {
      const result = db.prepare("INSERT INTO clocks (name, color, mode) VALUES (?, ?, ?)").run(name, color, mode || 'loop');
      res.json({ id: result.lastInsertRowid, name, color, mode: mode || 'loop' });
    } catch (error) {
      res.status(500).json({ error: "Failed to create clock" });
    }
  });

  app.put("/api/clocks/:id", (req, res) => {
    const { id } = req.params;
    const { name, color, mode } = req.body;
    try {
      db.prepare("UPDATE clocks SET name = COALESCE(?, name), color = COALESCE(?, color), mode = COALESCE(?, mode) WHERE id = ?")
        .run(name || null, color || null, mode || null, id);
      const updated = db.prepare("SELECT * FROM clocks WHERE id = ?").get(id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update clock" });
    }
  });

  app.get("/api/clocks/:id", (req, res) => {
    const { id } = req.params;
    try {
      const clock = db.prepare("SELECT * FROM clocks WHERE id = ?").get(id);
      if (!clock) return res.status(404).json({ error: "Clock not found" });
      
      const items = db.prepare(`
        SELECT ci.*,
          c.name as category_name, c.color as category_color,
          t.title as track_title, t.artist as track_artist, t.duration as track_duration
        FROM clock_items ci
        LEFT JOIN categories c ON ci.category_id = c.id
        LEFT JOIN tracks t ON ci.track_id = t.id
        WHERE ci.clock_id = ?
        ORDER BY ci.position
      `).all(id);
      
      res.json({ ...clock, items });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clock" });
    }
  });

  app.post("/api/clocks/:id/items", (req, res) => {
    const { id } = req.params;
    const { items } = req.body; // Array of { slot_type, category_id, track_id, duration_target }
    
    const insert = db.prepare(
      "INSERT INTO clock_items (clock_id, position, slot_type, category_id, track_id, duration_target) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const deleteOld = db.prepare("DELETE FROM clock_items WHERE clock_id = ?");

    const transaction = db.transaction((clockId, newItems) => {
      deleteOld.run(clockId);
      newItems.forEach((item: any, index: number) => {
        const slotType = item.slot_type || 'category';
        const categoryId = slotType === 'category' ? (item.category_id || null) : null;
        const trackId = slotType === 'track' ? (item.track_id || null) : null;
        insert.run(clockId, index, slotType, categoryId, trackId, item.duration_target || null);
      });
    });

    try {
      transaction(id, items);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating clock items:", error);
      res.status(500).json({ error: "Failed to update clock items" });
    }
  });

  app.delete("/api/clocks/:id", (req, res) => {
      const { id } = req.params;
      try {
          db.prepare("DELETE FROM clocks WHERE id = ?").run(id);
          res.json({ success: true });
      } catch (error) {
          res.status(500).json({ error: "Failed to delete clock" });
      }
  });

  // --- Schedule Grid ---
  app.get("/api/schedule/grid", (_req, res) => {
    try {
      const grid = db.prepare(`
        SELECT sg.*, c.name as clock_name, c.color as clock_color 
        FROM schedule_grid sg 
        JOIN clocks c ON sg.clock_id = c.id
      `).all();
      res.json(grid);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch schedule grid" });
    }
  });

  app.post("/api/schedule/grid", (req, res) => {
    const { assignments } = req.body; // Array of { day, hour, clock_id }
    
    const insert = db.prepare("INSERT OR REPLACE INTO schedule_grid (day_of_week, hour, clock_id) VALUES (?, ?, ?)");
    
    const transaction = db.transaction((items) => {
      items.forEach((item: any) => {
        insert.run(item.day, item.hour, item.clock_id);
      });
    });

    try {
      transaction(assignments);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update schedule grid" });
    }
  });

  // --- Rules ---
  app.get("/api/rules", (_req, res) => {
    try {
      const rules = db.prepare("SELECT * FROM rules").all();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.post("/api/rules", (req, res) => {
    const { category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode } = req.body;
    try {
      const existing = db.prepare("SELECT id FROM rules WHERE category_id = ?").get(category_id);
      if (existing) {
        db.prepare("UPDATE rules SET min_separation = ?, tempo_range_min = ?, tempo_range_max = ?, selection_mode = ? WHERE category_id = ?")
          .run(min_separation, tempo_range_min, tempo_range_max, selection_mode, category_id);
      } else {
        db.prepare("INSERT INTO rules (category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode) VALUES (?, ?, ?, ?, ?)")
          .run(category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save rule" });
    }
  });

  // --- Preview Generation ---
  app.post("/api/schedule/preview", (req, res) => {
    const { clock_id } = req.body;
    
    try {
      // 1. Get Clock Items — LEFT JOIN so pinned track slots (no category_id) are included
      const items = db.prepare(`
        SELECT ci.*,
               c.name as category_name,
               t.title as pinned_title,
               t.artist as pinned_artist,
               t.duration as pinned_duration,
               t.status as pinned_status
        FROM clock_items ci
        LEFT JOIN categories c ON ci.category_id = c.id
        LEFT JOIN tracks t ON ci.track_id = t.id
        WHERE ci.clock_id = ?
        ORDER BY ci.position
      `).all(clock_id) as any[];

      if (items.length === 0) {
        return res.json({ log: [] });
      }

      // 2. Generate Log
      const log: any[] = [];
      let currentTime = 0;

      for (const item of items) {
        const slotType = item.slot_type || 'category';

        if (slotType === 'track') {
          // Pinned track slot — use the exact track
          if (item.pinned_title) {
            log.push({
              position: item.position,
              time_offset: currentTime,
              slot_type: 'track',
              track: {
                title: item.pinned_title,
                artist: item.pinned_artist || 'Unknown Artist',
                duration: item.pinned_duration,
                category: '📌 Pinned'
              }
            });
            currentTime += (item.pinned_duration || 180);
          } else {
            log.push({
              position: item.position,
              time_offset: currentTime,
              slot_type: 'track',
              track: null,
              message: 'Pinned track not found (may have been deleted)'
            });
          }
        } else {
          // Category slot — pick a random ready track from that category
          const track = db.prepare(`
            SELECT * FROM tracks
            WHERE (category_id = ? OR subcategory_id = ?)
            AND status = 'ready'
            ORDER BY RANDOM()
            LIMIT 1
          `).get(item.category_id, item.category_id) as any;

          if (track) {
            log.push({
              position: item.position,
              time_offset: currentTime,
              slot_type: 'category',
              track: {
                title: track.title,
                artist: track.artist,
                duration: track.duration,
                category: item.category_name || 'Unknown Category'
              }
            });
            currentTime += (track.duration || 180);
          } else {
            log.push({
              position: item.position,
              time_offset: currentTime,
              slot_type: 'category',
              track: null,
              message: `No ready track found for category: ${item.category_name || '(unknown)'}`
            });
            currentTime += 180;
          }
        }
      }

      res.json({ log });
    } catch (error) {
      console.error("Preview generation failed:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });



  // --- Stream Next Track API for Liquidsoap with Separation Rules ---
  
  app.get("/api/stream/next-track", (req, res) => {
    try {
      // --- Determine which clock to use ---
      // 1. Check if there's a currently-running sequential clock that hasn't finished
      let state = db.prepare("SELECT * FROM playback_state WHERE id = 1").get() as any;

      // 2. Look up the scheduled clock for the current day/hour
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sunday
      const hour = now.getHours();
      const scheduledEntry = db.prepare(
        "SELECT sg.clock_id FROM schedule_grid sg WHERE sg.day_of_week = ? AND sg.hour = ?"
      ).get(dayOfWeek, hour) as any;

      // 3. Resolve the active clock
      // If a sequential clock is running and hasn't finished, keep using it
      let activeClockId: number | null = null;
      if (state && state.current_clock_id) {
        const runningClock = db.prepare("SELECT * FROM clocks WHERE id = ?").get(state.current_clock_id) as any;
        if (runningClock && runningClock.mode === 'sequential') {
          // Check if it has finished (position past end)
          const totalItems = (db.prepare("SELECT COUNT(*) as cnt FROM clock_items WHERE clock_id = ?").get(state.current_clock_id) as any).cnt;
          if (state.current_position < totalItems) {
            // Still playing — keep this clock
            activeClockId = state.current_clock_id;
          }
          // else: sequential clock finished, fall through to scheduled clock
        }
      }

      // Use scheduled clock if no sequential override
      if (!activeClockId) {
        if (scheduledEntry) {
          activeClockId = scheduledEntry.clock_id;
        } else {
          // Fallback: first clock in DB
          const fallback = db.prepare("SELECT id FROM clocks ORDER BY id LIMIT 1").get() as any;
          if (!fallback) return res.json({ track: null, error: "No clock configured" });
          activeClockId = fallback.id;
        }
      }

      const clock = db.prepare("SELECT * FROM clocks WHERE id = ?").get(activeClockId) as any;
      if (!clock) return res.json({ track: null, error: "No clock configured" });

      // Get clock items
      const clockItems = db.prepare(`
        SELECT ci.*, c.name as category_name,
          t.title as track_title, t.artist as track_artist,
          t.filepath as track_filepath, t.duration as track_duration,
          t.cue_in as track_cue_in, t.cue_out as track_cue_out
        FROM clock_items ci
        LEFT JOIN categories c ON ci.category_id = c.id
        LEFT JOIN tracks t ON ci.track_id = t.id
        WHERE ci.clock_id = ?
        ORDER BY ci.position
      `).all(clock.id) as any[];

      if (clockItems.length === 0) return res.json({ track: null, error: "No items in clock" });

      // Get or initialize playback state
      if (!state) {
        db.prepare("INSERT INTO playback_state (id, current_clock_id, current_position) VALUES (1, ?, 0)")
          .run(clock.id);
        state = { id: 1, current_clock_id: clock.id, current_position: 0 };
      }

      // Reset position when switching to a different clock
      if (state.current_clock_id !== clock.id) {
        db.prepare("UPDATE playback_state SET current_clock_id = ?, current_position = 0, last_updated = datetime('now') WHERE id = 1")
          .run(clock.id);
        state.current_position = 0;
        state.current_clock_id = clock.id;
      }

      // Determine current position
      // Sequential clocks: play straight through (no modulo wrap)
      // Loop clocks: wrap around with modulo
      let currentPosition: number;
      let nextPosition: number;
      if (clock.mode === 'sequential') {
        currentPosition = state.current_position; // already bounds-checked above
        nextPosition = state.current_position + 1; // will exceed length when done — that's intentional
      } else {
        currentPosition = state.current_position % clockItems.length;
        nextPosition = (state.current_position + 1) % clockItems.length;
      }

      const currentItem = clockItems[currentPosition];
      if (!currentItem) return res.json({ track: null, error: "Clock position out of bounds" });

      // Advance position in DB
      db.prepare("UPDATE playback_state SET current_position = ?, last_updated = datetime('now') WHERE id = 1")
        .run(nextPosition);
      
      // --- TRACK SLOT: play the specific pinned track directly ---
      if (currentItem.slot_type === 'track' && currentItem.track_id) {
        const pinnedTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(currentItem.track_id) as any;
        if (!pinnedTrack) return res.json({ track: null, error: "Pinned track not found" });
        
        // Log to play history
        db.prepare(`
          INSERT INTO play_history (track_id, title, artist, category_id, played_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(pinnedTrack.id, pinnedTrack.title, pinnedTrack.artist, pinnedTrack.category_id);
        
        let calculatedCueOut = pinnedTrack.cue_out;
        if (!calculatedCueOut && pinnedTrack.duration && pinnedTrack.duration > 3) {
          calculatedCueOut = pinnedTrack.duration - 0.5;
        }
        return res.json({ track: { ...pinnedTrack, cue_out: calculatedCueOut }, clock_position: currentPosition, category: 'Pinned Track' });
      }

      // --- CATEGORY SLOT: pick a track from the category ---
      let track: any = null;

      // First: if a shuffled queue exists for this category, walk it (no repeats until cycle done)
      const queueExists = db
        .prepare("SELECT COUNT(*) as cnt FROM category_play_queue WHERE category_id = ?")
        .get(currentItem.category_id) as { cnt: number };
      if (queueExists.cnt > 0) {
        const queuedTrackId = popFromCategoryQueue(currentItem.category_id);
        if (queuedTrackId) {
          track = db
            .prepare("SELECT * FROM tracks WHERE id = ?")
            .get(queuedTrackId) as any;
        }
      }

      // Fall back to legacy random-with-separation if no queue or queue picks failed
      // Get separation rules for this category (default 40 minutes)
      const rule = db.prepare("SELECT * FROM rules WHERE category_id = ?").get(currentItem.category_id) as any;
      const minSeparationMinutes = rule?.min_separation || 40;

      // Single query to get all recently played data (replaces 3 separate queries)
      const recentPlays = db.prepare(`
        SELECT track_id, title, artist FROM play_history
        WHERE played_at > datetime('now', '-${minSeparationMinutes} minutes')
        AND title IS NOT NULL
      `).all() as any[];

      const recentTrackIds = [...new Set(recentPlays.map((r: any) => r.track_id).filter(Boolean))] as number[];
      const recentTitleList = [...new Set(recentPlays.map((r: any) => r.title).filter(Boolean))] as string[];
      const recentArtistList = [...new Set(
        recentPlays.map((r: any) => r.artist).filter((a: any) => a && a !== '' && a !== 'Unknown Artist')
      )] as string[];
      
      // Build query to find eligible tracks
      let trackQuery = `
        SELECT * FROM tracks 
        WHERE (category_id = ? OR subcategory_id = ?) 
        AND filepath IS NOT NULL
        AND status = 'ready'
        AND filepath NOT LIKE '%.wma'
      `;
      const params: any[] = [currentItem.category_id, currentItem.category_id];
      
      // Exclude recently played tracks by ID
      if (recentTrackIds.length > 0) {
        trackQuery += ` AND id NOT IN (${recentTrackIds.join(',')})`;
      }
      
      // Exclude recently played tracks by title (handles duplicates with different IDs)
      if (recentTitleList.length > 0) {
        const titlePlaceholders = recentTitleList.map(() => '?').join(',');
        trackQuery += ` AND (title IS NULL OR title NOT IN (${titlePlaceholders}))`;
        params.push(...recentTitleList);
      }
      
      // Exclude recently played artists
      if (recentArtistList.length > 0) {
        const placeholders = recentArtistList.map(() => '?').join(',');
        trackQuery += ` AND (artist IS NULL OR artist = '' OR artist = 'Unknown Artist' OR artist NOT IN (${placeholders}))`;
        params.push(...recentArtistList);
      }
      
      trackQuery += " ORDER BY RANDOM() LIMIT 1";
      
      if (!track) {
        track = db.prepare(trackQuery).get(...params) as any;
      }
      
      // Fallback 1: try without artist restriction but still respect title separation
      if (!track) {
        let fallbackQuery = `
          SELECT * FROM tracks 
          WHERE (category_id = ? OR subcategory_id = ?) 
          AND filepath IS NOT NULL
          AND status = 'ready'
          AND filepath NOT LIKE '%.wma'
        `;
        const fallbackParams: any[] = [currentItem.category_id, currentItem.category_id];
        if (recentTrackIds.length > 0) {
          fallbackQuery += ` AND id NOT IN (${recentTrackIds.join(',')})`;
        }
        // Still exclude recently played titles
        if (recentTitleList.length > 0) {
          const titlePlaceholders = recentTitleList.map(() => '?').join(',');
          fallbackQuery += ` AND (title IS NULL OR title NOT IN (${titlePlaceholders}))`;
          fallbackParams.push(...recentTitleList);
        }
        fallbackQuery += " ORDER BY RANDOM() LIMIT 1";
        track = db.prepare(fallbackQuery).get(...fallbackParams) as any;
      }
      
      // Fallback 2: Pick the LEAST RECENTLY PLAYED track from this category
      // This ensures maximum separation even when all tracks have been played
      if (!track) {
        track = db.prepare(`
          SELECT t.* FROM tracks t
          LEFT JOIN (
            SELECT track_id, MAX(played_at) as last_played 
            FROM play_history 
            GROUP BY track_id
          ) ph ON t.id = ph.track_id
          WHERE (t.category_id = ? OR t.subcategory_id = ?)
          AND t.filepath IS NOT NULL
          AND t.status = 'ready'
          AND t.filepath NOT LIKE '%.wma'
          ORDER BY ph.last_played ASC NULLS FIRST
          LIMIT 1
        `).get(currentItem.category_id, currentItem.category_id) as any;
      }
      
      if (!track) return res.json({ track: null, error: "No tracks available for category: " + currentItem.category_name });
      
      // Log to play history
      db.prepare(`
        INSERT INTO play_history (track_id, title, artist, category_id, played_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(track.id, track.title, track.artist, track.category_id);
      
      // Calculate cue_out: use existing value, or calculate based on category type
      // Music gets 3 second segue (start next track 3 seconds before end)
      // Everything else gets 0.5 second segue
      let calculatedCueOut = track.cue_out;
      if (!calculatedCueOut && track.duration && track.duration > 3) {
        // Get category type to determine segue offset
        const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id) as any;
        const segueOffset = (category?.type === 'music') ? 3.0 : 0.5;
        calculatedCueOut = track.duration - segueOffset;
      }
      res.json({ track: { ...track, cue_out: calculatedCueOut }, clock_position: currentPosition, category: currentItem.category_name });
    } catch (error) {
      console.error("Next track API failed:", error);
      res.status(500).json({ track: null, error: "Failed to get next track" });
    }
  });

  // --- Play History API ---
  app.get("/api/stream/history", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const history = db.prepare(`
        SELECT ph.*, t.album, t.filepath, c.name as category_name
        FROM play_history ph
        LEFT JOIN tracks t ON ph.track_id = t.id
        LEFT JOIN categories c ON ph.category_id = c.id
        ORDER BY ph.played_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
      const total = (db.prepare("SELECT COUNT(*) as count FROM play_history").get() as any).count;
      res.json({ history, total, limit, offset });
    } catch (error) {
      console.error("Play history API failed:", error);
      res.status(500).json({ error: "Failed to get play history" });
    }
  });

  // --- Play History CSV Export ---
  app.get("/api/stream/history/export", (req, res) => {
    try {
      const history = db.prepare(`
        SELECT ph.played_at, ph.title, ph.artist, c.name as category
        FROM play_history ph
        LEFT JOIN categories c ON ph.category_id = c.id
        ORDER BY ph.played_at DESC
      `).all() as any[];
      
      let csv = "Played At,Title,Artist,Category\n";
      for (const row of history) {
        const playedAt = row.played_at || '';
        const title = (row.title || '').replace(/"/g, '""');
        const artist = (row.artist || '').replace(/"/g, '""');
        const category = (row.category || '').replace(/"/g, '""');
        csv += `"${playedAt}","${title}","${artist}","${category}"\n`;
      }
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="play_history.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Play history export failed:", error);
      res.status(500).json({ error: "Failed to export play history" });
    }
  });

  // One-time deploy key setup - adds GitHub Actions SSH public key to authorized_keys
  app.post("/api/setup-deploy-key", (req, res) => {
    const { secret, pubkey } = req.body || {};
    if (secret !== "novastream-setup-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!pubkey || typeof pubkey !== "string" || !pubkey.startsWith("ssh-")) {
      return res.status(400).json({ error: "Invalid pubkey" });
    }
    try {
      execSync("mkdir -p /root/.ssh && chmod 700 /root/.ssh");
      const authKeys = "/root/.ssh/authorized_keys";
      const existing = fs.existsSync(authKeys) ? fs.readFileSync(authKeys, "utf8") : "";
      if (!existing.includes(pubkey.trim())) {
        fs.appendFileSync(authKeys, pubkey.trim() + "\n");
        execSync(`chmod 600 ${authKeys}`);
        res.json({ ok: true, message: "Key added successfully" });
      } else {
        res.json({ ok: true, message: "Key already present" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Public Now Playing endpoint (for player strip) ---
  // POST /api/stream/now-playing — Liquidsoap on_metadata callback fires this when
  // a track actually becomes audible (not when it was queued/fetched). Updates the
  // current_playing table so the admin UI reflects what listeners are hearing.
  app.post("/api/stream/now-playing", (req, res) => {
    try {
      const { filepath } = (req.body || {}) as { filepath?: string };
      if (!filepath || typeof filepath !== "string") {
        return res.status(400).json({ error: "filepath required" });
      }
      const track = db
        .prepare("SELECT id, title, artist FROM tracks WHERE filepath = ?")
        .get(filepath) as { id: number; title: string; artist: string } | undefined;
      if (!track) {
        // Still record the filepath so we don't get stuck on stale data
        db.prepare(`
          INSERT INTO current_playing (id, track_id, title, artist, filepath, started_at)
          VALUES (1, NULL, NULL, NULL, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            track_id = NULL, title = NULL, artist = NULL,
            filepath = excluded.filepath, started_at = excluded.started_at
        `).run(filepath);
        return res.status(404).json({ error: "track not found", filepath });
      }
      db.prepare(`
        INSERT INTO current_playing (id, track_id, title, artist, filepath, started_at)
        VALUES (1, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          track_id = excluded.track_id,
          title = excluded.title,
          artist = excluded.artist,
          filepath = excluded.filepath,
          started_at = excluded.started_at
      `).run(track.id, track.title, track.artist, filepath);
      res.json({ success: true, track_id: track.id });
    } catch (err) {
      console.error("[/api/stream/now-playing]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/stream/now — what's actually on-air now (plus what's queued, plus recent).
  // Prefers current_playing (driven by Liquidsoap on_metadata, accurate to audio output).
  // Falls back to play_history[1] (second-most-recent) when current_playing is stale,
  // since play_history is logged at fetch time and runs ~1 track ahead of audible playback.
  app.get("/api/stream/now", (req, res) => {
    try {
      const cp = db
        .prepare(
          "SELECT title, artist, started_at, " +
            "(julianday('now') - julianday(started_at)) * 24 * 60 AS age_min " +
            "FROM current_playing WHERE id = 1"
        )
        .get() as
        | { title: string | null; artist: string | null; started_at: string; age_min: number }
        | undefined;

      const ph = db
        .prepare(
          "SELECT title, artist, played_at FROM play_history ORDER BY played_at DESC LIMIT 5"
        )
        .all() as { title: string; artist: string; played_at: string }[];

      const cpFresh =
        cp && cp.title && cp.age_min != null && cp.age_min >= 0 && cp.age_min < 60;

      let current: { title: string; artist: string } | null = null;
      let next: { title: string; artist: string } | null = null;

      if (cpFresh && cp) {
        current = { title: cp.title!, artist: cp.artist || "" };
        // next = most-recent play_history entry that differs from current
        // (play_history is logged at fetch time, so the latest is the queued-ahead track)
        for (const row of ph) {
          if (row.title !== current.title || row.artist !== current.artist) {
            next = { title: row.title, artist: row.artist };
            break;
          }
        }
      } else if (ph.length >= 2) {
        // No fresh on_metadata signal yet — use 1-track-behind heuristic
        current = { title: ph[1].title, artist: ph[1].artist };
        next = { title: ph[0].title, artist: ph[0].artist };
      } else if (ph.length >= 1) {
        current = { title: ph[0].title, artist: ph[0].artist };
      }

      const recent: { title: string; artist: string }[] = [];
      for (const row of ph) {
        if (recent.length >= 3) break;
        if (current && row.title === current.title && row.artist === current.artist) continue;
        if (next && row.title === next.title && row.artist === next.artist) continue;
        recent.push({ title: row.title, artist: row.artist });
      }

      res.set("Cache-Control", "no-store");
      res.json({ current, next, recent });
    } catch (err) {
      console.error("[/api/stream/now]", err);
      res.status(500).json({ error: "unavailable" });
    }
  });

  // Migrate existing WMA files on server to MP3 (one-time background job)
  app.post("/api/admin/convert-wma", async (req, res) => {
    const { secret } = req.body || {};
    if (secret !== "novastream-setup-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Find all on-server tracks with WMA filepath
    const wmaTracksList = db.prepare(
      "SELECT id, filepath FROM tracks WHERE filepath IS NOT NULL AND filepath LIKE '%.wma'"
    ).all() as { id: number; filepath: string }[];

    res.json({ message: `Starting background conversion of ${wmaTracksList.length} WMA files`, count: wmaTracksList.length });

    // Run conversions sequentially in background to avoid CPU saturation
    (async () => {
      let converted = 0, failed = 0, skipped = 0;
      for (const t of wmaTracksList) {
        if (!fs.existsSync(t.filepath)) {
          console.log(`[MIGRATE] File not found, skipping track ${t.id}: ${t.filepath}`);
          skipped++;
          continue;
        }
        console.log(`[MIGRATE] Converting track ${t.id}: ${t.filepath}`);
        const mp3Path = await convertToMp3(t.filepath);
        if (mp3Path) {
          // Update DB filepath and duration
          const dur = await extractDuration(mp3Path);
          if (dur) {
            db.prepare("UPDATE tracks SET filepath = ?, duration = ? WHERE id = ?").run(mp3Path, dur, t.id);
          } else {
            db.prepare("UPDATE tracks SET filepath = ? WHERE id = ?").run(mp3Path, t.id);
          }
          console.log(`[MIGRATE] Track ${t.id} converted OK -> ${mp3Path}`);
          converted++;
        } else {
          console.warn(`[MIGRATE] Conversion failed for track ${t.id}`);
          failed++;
        }
        // Small pause between conversions to keep CPU load manageable
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`[MIGRATE] Done: ${converted} converted, ${failed} failed, ${skipped} skipped`);
    })();
  });

  const httpServer = createServer(app);
  return httpServer;
}
