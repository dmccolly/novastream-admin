import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
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

export function registerRoutes(app: Express): Server {
  // Initialize DB
  initDb();

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

  // Sync Dropbox - Scan Dropbox for new files
  app.post("/api/sync", async (_req, res) => {
    try {
      const result = await syncDropbox();
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
      
      // If file is on server, return local URL
      if (track.filepath) {
        const localUrl = `/music/${path.basename(track.filepath)}`;
        console.log("[PREVIEW] Track has filepath, returning local URL:", localUrl);
        return res.json({ url: localUrl });
      }
      
      // Otherwise get temporary Dropbox link
      if (!track.source_url) {
        console.log("[PREVIEW] Track has no source_url, returning 400");
        return res.status(400).json({ error: "Track has no source URL" });
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

  // Helper function to handle Dropbox download
  async function downloadFromDropbox(trackId: number, dropboxPath: string) {
    try {
      const dbx = await getDropboxClient();
      const filename = `${trackId}_${Date.now()}.mp3`; // Force MP3 extension for consistency
      const filepath = path.join(musicDir, filename);

      console.log(`Downloading ${dropboxPath} to ${filepath}...`);

      const response = await dbx.filesDownload({ path: dropboxPath });
      const fileBinary = (response.result as any).fileBinary;

      if (!fileBinary) {
        throw new Error("No file data received from Dropbox");
      }

      fs.writeFileSync(filepath, fileBinary);
      console.log(`Download ${trackId} completed successfully.`);
      
      // Extract duration using ffprobe
      const duration = await extractDuration(filepath);
      
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
        ).run(filepath, duration, defaultCueOut, trackId);
      } else {
        console.warn(`[Download] Could not extract duration for track ${trackId}, setting without duration`);
        db.prepare("UPDATE tracks SET status = 'ready', filepath = ? WHERE id = ?").run(filepath, trackId);
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

    // ── Batch Update Cue Points ─────────────────────────────────────────────
    // PATCH /api/tracks/batch/cuepoints
    // Body: { trackIds?: string[], cueIn?: number, cueOut?: number, segueDuration?: number }
    // If trackIds is omitted or empty, updates ALL tracks on the server.
    // Only the fields supplied in the body are updated; omitted fields are
    // left unchanged (COALESCE pattern).
    app.patch("/api/tracks/batch/cuepoints", (req, res) => {
      const { trackIds, cueIn, cueOut, segueDuration } = req.body as {
        trackIds?: string[];
        cueIn?: number;
        cueOut?: number;
        segueDuration?: number;
      };

      if (cueIn === undefined && cueOut === undefined && segueDuration === undefined) {
        return res.status(400).json({ error: "At least one of cueIn, cueOut, segueDuration must be provided" });
      }

      try {
        let ids: string[];

        if (Array.isArray(trackIds) && trackIds.length > 0) {
          ids = trackIds.map(String);
        } else {
          // All tracks
          const rows = db.prepare("SELECT id FROM tracks").all() as { id: string }[];
          ids = rows.map((r) => String(r.id));
        }

        // Build dynamic SET clause so we only touch supplied columns
        const setClauses: string[] = [];
        const params: (number | string)[] = [];
        if (cueIn !== undefined)        { setClauses.push("cue_in = ?");        params.push(cueIn); }
        if (cueOut !== undefined)       { setClauses.push("cue_out = ?");       params.push(cueOut); }
        if (segueDuration !== undefined){ setClauses.push("segue_duration = ?"); params.push(segueDuration); }

        const stmt = db.prepare(
          `UPDATE tracks SET ${setClauses.join(", ")} WHERE id = ?`
        );

        const updateMany = db.transaction((idList: string[]) => {
          let updated = 0;
          for (const id of idList) {
            stmt.run(...params, id);
            updated++;
          }
          return updated;
        });

        const updated = updateMany(ids);
        res.json({ updated, total: ids.length });
      } catch (error: any) {
        console.error("Error in batch cue points update:", error);
        res.status(500).json({ error: "Failed to batch update cue points", details: error.message });
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

    // Stream Track Audio - for waveform editor
    app.get("/api/tracks/:id/stream", (req, res) => {
      const { id } = req.params;
      try {
        const track = db.prepare("SELECT filepath FROM tracks WHERE id = ?").get(id) as { filepath: string };
        
        if (!track || !track.filepath) {
          return res.status(404).json({ error: "Track not found or not downloaded" });
        }

        if (!fs.existsSync(track.filepath)) {
          return res.status(404).json({ error: "Audio file not found on server" });
        }

        const stat = fs.statSync(track.filepath);
        const fileSize = stat.size;
        const range = req.headers.range;

        // Set CORS headers for WaveSurfer.js WebAudio backend
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(track.filepath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'audio/mpeg',
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Content-Length': fileSize,
            'Content-Type': 'audio/mpeg',
          };
          res.writeHead(200, head);
          fs.createReadStream(track.filepath).pipe(res);
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
    const { name, color } = req.body;
    try {
      const result = db.prepare("INSERT INTO clocks (name, color) VALUES (?, ?)").run(name, color);
      res.json({ id: result.lastInsertRowid, name, color });
    } catch (error) {
      res.status(500).json({ error: "Failed to create clock" });
    }
  });

  app.get("/api/clocks/:id", (req, res) => {
    const { id } = req.params;
    try {
      const clock = db.prepare("SELECT * FROM clocks WHERE id = ?").get(id);
      if (!clock) return res.status(404).json({ error: "Clock not found" });
      
      const items = db.prepare(`
        SELECT ci.*, c.name as category_name, c.color as category_color 
        FROM clock_items ci 
        JOIN categories c ON ci.category_id = c.id 
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
    const { items } = req.body; // Array of { category_id, duration_target }
    
    const insert = db.prepare("INSERT INTO clock_items (clock_id, position, category_id, duration_target) VALUES (?, ?, ?, ?)");
    const deleteOld = db.prepare("DELETE FROM clock_items WHERE clock_id = ?");

    const transaction = db.transaction((clockId, newItems) => {
      deleteOld.run(clockId);
      newItems.forEach((item: any, index: number) => {
        insert.run(clockId, index, item.category_id, item.duration_target || null);
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
      // 1. Get Clock Items
      const items = db.prepare(`
        SELECT ci.*, c.name as category_name 
        FROM clock_items ci 
        JOIN categories c ON ci.category_id = c.id 
        WHERE ci.clock_id = ? 
        ORDER BY ci.position
      `).all(clock_id) as any[];

      if (items.length === 0) {
        return res.json({ log: [] });
      }

      // 2. Generate Log
      const log: any[] = [];
      let currentTime = 0; // Relative seconds from start of hour

      for (const item of items) {
        // Find a track for this category
        // Simple logic: Random track from category (or subcategory)
        // TODO: Implement full rules engine (separation, etc.)
        
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
            track: {
              title: track.title,
              artist: track.artist,
              duration: track.duration,
              category: item.category_name
            }
          });
          currentTime += (track.duration || 180); // Default 3 mins if unknown
        } else {
          log.push({
            position: item.position,
            time_offset: currentTime,
            track: null,
            message: `No track found for category: ${item.category_name}`
          });
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
      // Get the first clock (TODO: support schedule grid and master clock mode)
      const clock = db.prepare("SELECT id FROM clocks ORDER BY id LIMIT 1").get() as any;
      if (!clock) return res.json({ track: null, error: "No clock configured" });
      
      // Get clock items
      const clockItems = db.prepare(`
        SELECT ci.*, c.name as category_name 
        FROM clock_items ci 
        JOIN categories c ON ci.category_id = c.id 
        WHERE ci.clock_id = ? 
        ORDER BY ci.position
      `).all(clock.id) as any[];
      
      if (clockItems.length === 0) return res.json({ track: null, error: "No items in clock" });
      
      // Get or initialize playback state from database
      let state = db.prepare("SELECT * FROM playback_state WHERE id = 1").get() as any;
      if (!state) {
        // Initialize state if it doesn't exist
        db.prepare("INSERT INTO playback_state (id, current_clock_id, current_position) VALUES (1, ?, 0)")
          .run(clock.id);
        state = { id: 1, current_clock_id: clock.id, current_position: 0 };
      }
      
      // Reset position if clock changed
      if (state.current_clock_id !== clock.id) {
        db.prepare("UPDATE playback_state SET current_clock_id = ?, current_position = 0, last_updated = datetime('now') WHERE id = 1")
          .run(clock.id);
        state.current_position = 0;
        state.current_clock_id = clock.id;
      }
      
      // Get the current clock item based on position (cycle through sequentially)
      const currentPosition = state.current_position % clockItems.length;
      const currentItem = clockItems[currentPosition];
      
      // Calculate next position and update database
      const nextPosition = (state.current_position + 1) % clockItems.length;
      db.prepare("UPDATE playback_state SET current_position = ?, last_updated = datetime('now') WHERE id = 1")
        .run(nextPosition);
      
      // Get separation rules for this category (default 120 minutes = 2 hours)
      const rule = db.prepare("SELECT * FROM rules WHERE category_id = ?").get(currentItem.category_id) as any;
      const minSeparationMinutes = rule?.min_separation || 120;
      
      // Get recently played artists (within separation window)
      const recentArtists = db.prepare(`
        SELECT DISTINCT artist FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
        AND artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist'
      `).all(minSeparationMinutes) as any[];
      const recentArtistList = recentArtists.map((r: any) => r.artist);
      
      // Get recently played track IDs (within separation window)
      const recentTracks = db.prepare(`
        SELECT DISTINCT track_id FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
      `).all(minSeparationMinutes) as any[];
      const recentTrackIds = recentTracks.map((r: any) => r.track_id);
      
      // Get recently played titles (within separation window) - handles duplicate tracks with different IDs
      const recentTitles = db.prepare(`
        SELECT DISTINCT title FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
        AND title IS NOT NULL AND title != ''
      `).all(minSeparationMinutes) as any[];
      const recentTitleList = recentTitles.map((r: any) => r.title);
      
      // Build query to find eligible tracks
      let trackQuery = `
        SELECT * FROM tracks 
        WHERE (category_id = ? OR subcategory_id = ?) 
        AND filepath IS NOT NULL
        AND status = 'ready'
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
      
      let track = db.prepare(trackQuery).get(...params) as any;
      
      // Fallback 1: try without artist restriction but still respect title separation
      if (!track) {
        let fallbackQuery = `
          SELECT * FROM tracks 
          WHERE (category_id = ? OR subcategory_id = ?) 
          AND filepath IS NOT NULL
          AND status = 'ready'
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

  const httpServer = createServer(app);
  return httpServer;
}
