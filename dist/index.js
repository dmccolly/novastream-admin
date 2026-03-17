var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// server/index.ts
import express2 from "express";

// server/routes.ts
import express from "express";
import { createServer } from "http";

// server/db.ts
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
var require2 = createRequire(import.meta.url);
var Database = require2("better-sqlite3");
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var dbPath = path.resolve(__dirname, "..", "radio.db");
var db = new Database(dbPath);
function initDb() {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration INTEGER,
      filepath TEXT,
      status TEXT DEFAULT 'pending', -- pending, downloading, ready, error
      source_url TEXT UNIQUE,
      category TEXT, -- Legacy string category
      category_id INTEGER, -- New FK
      subcategory_id INTEGER, -- New FK
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (subcategory_id) REFERENCES categories(id)
    );
    
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_source_url ON tracks(source_url);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Categories Table (Hierarchical)
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      type TEXT NOT NULL, -- 'music', 'commercial', 'promo', 'liner', 'content', 'id'
      color TEXT,
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- Clocks (Templates)
    CREATE TABLE IF NOT EXISTS clocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT
    );

    -- Clock Items (The Wheel)
    CREATE TABLE IF NOT EXISTS clock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clock_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      category_id INTEGER NOT NULL, -- What to play (can be a subcategory)
      duration_target INTEGER, -- Optional target duration in seconds
      FOREIGN KEY (clock_id) REFERENCES clocks(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- Schedule Grid (Weekly)
    CREATE TABLE IF NOT EXISTS schedule_grid (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
      hour INTEGER NOT NULL, -- 0-23
      clock_id INTEGER NOT NULL,
      FOREIGN KEY (clock_id) REFERENCES clocks(id) ON DELETE CASCADE,
      UNIQUE(day_of_week, hour)
    );

    -- Rules (Separation, Tempo, etc.)
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      min_separation INTEGER DEFAULT 0, -- Minutes
      tempo_range_min INTEGER,
      tempo_range_max INTEGER,
      selection_mode TEXT DEFAULT 'random', -- 'random', 'oldest', 'newest'
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );
  `);
  const columns = db.pragma("table_info(tracks)");
  if (!columns.some((col) => col.name === "cue_out")) {
    console.log("Migrating: Adding cue_out column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN cue_out REAL");
  }
  if (!columns.some((col) => col.name === "category_id")) {
    console.log("Migrating: Adding category_id column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN category_id INTEGER REFERENCES categories(id)");
  }
  if (!columns.some((col) => col.name === "subcategory_id")) {
    console.log("Migrating: Adding subcategory_id column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN subcategory_id INTEGER REFERENCES categories(id)");
  }
  if (!columns.some((col) => col.name === "cue_in")) {
    console.log("Migrating: Adding cue_in column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN cue_in REAL DEFAULT 0");
  }
  if (!columns.some((col) => col.name === "segue_duration")) {
    console.log("Migrating: Adding segue_duration column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN segue_duration REAL DEFAULT 3.0");
  }
  const count = db.prepare("SELECT COUNT(*) as count FROM categories").get();
  if (count.count === 0) {
    console.log("Seeding default categories...");
    const insertCat = db.prepare("INSERT INTO categories (name, parent_id, type, color) VALUES (?, ?, ?, ?)");
    const music = insertCat.run("Music", null, "music", "#3b82f6");
    const musicId = music.lastInsertRowid;
    insertCat.run("Country", musicId, "music", "#60a5fa");
    insertCat.run("Rock", musicId, "music", "#ef4444");
    insertCat.run("AC", musicId, "music", "#f59e0b");
    insertCat.run("Pop", musicId, "music", "#ec4899");
    insertCat.run("Alt", musicId, "music", "#8b5cf6");
    insertCat.run("Commercial", null, "commercial", "#10b981");
    const promo = insertCat.run("Promo", null, "promo", "#f97316");
    const promoId = promo.lastInsertRowid;
    insertCat.run("Country", promoId, "promo", "#fb923c");
    insertCat.run("Rock", promoId, "promo", "#fb923c");
    insertCat.run("AC", promoId, "promo", "#fb923c");
    insertCat.run("Pop", promoId, "promo", "#fb923c");
    insertCat.run("Alt", promoId, "promo", "#fb923c");
    const liner = insertCat.run("Liner", null, "liner", "#a855f7");
    const linerId = liner.lastInsertRowid;
    insertCat.run("Short", linerId, "liner", "#c084fc");
    insertCat.run("Medium", linerId, "liner", "#c084fc");
    insertCat.run("Music", linerId, "liner", "#c084fc");
    insertCat.run("Attitude", linerId, "liner", "#c084fc");
    insertCat.run("Specialty", linerId, "liner", "#c084fc");
    const content = insertCat.run("Content", null, "content", "#06b6d4");
    const contentId = content.lastInsertRowid;
    insertCat.run("News", contentId, "content", "#22d3ee");
    insertCat.run("Segments", contentId, "content", "#22d3ee");
    insertCat.run("ID", null, "id", "#64748b");
  }
  console.log("Database initialized at", dbPath);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    title TEXT,
    artist TEXT,
    category_id INTEGER,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
  CREATE INDEX IF NOT EXISTS idx_play_history_artist ON play_history(artist);
  CREATE INDEX IF NOT EXISTS idx_play_history_track_id ON play_history(track_id);

  -- Playback State (Persistent Clock Position)
  CREATE TABLE IF NOT EXISTS playback_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_clock_id INTEGER,
    current_position INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (current_clock_id) REFERENCES clocks(id) ON DELETE SET NULL
  );
`);

// server/auth.ts
import { Dropbox, DropboxAuth } from "dropbox";
import "dotenv/config";
var DBX_APP_KEY = process.env.DROPBOX_APP_KEY || "";
var DBX_APP_SECRET = process.env.DROPBOX_APP_SECRET || "";
var REDIRECT_URI = process.env.DROPBOX_REDIRECT_URI || "http://localhost";
async function getDropboxClient() {
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'dropbox_access_token'").get();
  let accessToken = tokenRow?.value;
  if (!accessToken) {
    accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  }
  const refreshRow = db.prepare("SELECT value FROM settings WHERE key = 'dropbox_refresh_token'").get();
  let refreshToken = refreshRow?.value;
  if (!refreshToken) {
    refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  }
  if (refreshToken) {
    console.log("Using Refresh Token to get client...");
    const dbxAuth = new DropboxAuth({
      clientId: DBX_APP_KEY,
      clientSecret: DBX_APP_SECRET,
      refreshToken
    });
    return new Dropbox({ auth: dbxAuth });
  }
  if (accessToken) {
    console.log("Using Access Token (no refresh token available)...");
    return new Dropbox({ accessToken });
  }
  throw new Error("No valid Dropbox credentials found");
}
function getAuthUrl() {
  const dbxAuth = new DropboxAuth({
    clientId: DBX_APP_KEY,
    clientSecret: DBX_APP_SECRET
  });
  return dbxAuth.getAuthenticationUrl(REDIRECT_URI, void 0, "code", "offline", void 0, void 0, false);
}
async function exchangeCodeForToken(code) {
  const dbxAuth = new DropboxAuth({
    clientId: DBX_APP_KEY,
    clientSecret: DBX_APP_SECRET
  });
  const response = await dbxAuth.getAccessTokenFromCode(REDIRECT_URI, code);
  const result = response.result;
  console.log("Token exchange successful!");
  if (result.access_token) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dropbox_access_token', ?)").run(result.access_token);
  }
  if (result.refresh_token) {
    console.log("GOT REFRESH TOKEN! Saving it securely.");
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dropbox_refresh_token', ?)").run(result.refresh_token);
  }
  return true;
}

// server/dropbox.ts
async function syncDropbox() {
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
    const insertMany = db.transaction((entries) => {
      let count = 0;
      for (const entry of entries) {
        if (entry[".tag"] === "file" && isAudioFile(entry.name)) {
          const path4 = entry.path_lower || entry.path_display;
          const { artist, title } = parseFilename(entry.name);
          stmt.run(title, artist, path4);
          count++;
        }
      }
      return count;
    });
    const addedCount = insertMany(files);
    console.log(`Successfully indexed ${addedCount} audio files.`);
    return { success: true, count: addedCount, total: files.length };
  } catch (error) {
    console.error("Dropbox sync failed:", error);
    throw error;
  }
}
function isAudioFile(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["mp3", "wav", "m4a", "flac", "aac", "ogg"].includes(ext || "");
}
function parseFilename(filename) {
  const name = filename.substring(0, filename.lastIndexOf("."));
  const parts = name.split(" - ");
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim()
    };
  }
  return {
    artist: "Unknown Artist",
    title: name.trim()
  };
}

// server/routes.ts
import cors from "cors";
import path2 from "path";
import fs from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";

// server/duration.ts
import { spawn } from "child_process";
async function extractDuration(filepath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filepath
    ]);
    let output = "";
    let errorOutput = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });
    ffprobe.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    ffprobe.on("close", (code) => {
      if (code !== 0) {
        console.error(`[Duration] ffprobe failed for ${filepath}:`, errorOutput);
        resolve(null);
        return;
      }
      const duration = parseFloat(output.trim());
      if (isNaN(duration) || duration <= 0) {
        console.error(`[Duration] Invalid duration for ${filepath}:`, output);
        resolve(null);
        return;
      }
      console.log(`[Duration] Extracted duration for ${filepath}: ${duration}s`);
      resolve(duration);
    });
    ffprobe.on("error", (error) => {
      console.error(`[Duration] Failed to spawn ffprobe for ${filepath}:`, error);
      resolve(null);
    });
  });
}

// server/routes.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path2.dirname(__filename2);
var musicDir = path2.resolve(__dirname2, "..", "storage", "music");
if (!fs.existsSync(musicDir)) {
  fs.mkdirSync(musicDir, { recursive: true });
}
function registerRoutes(app2) {
  initDb();
  app2.use(cors());
  app2.use(express.json());
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app2.get("/api/ping", (_req, res) => {
    res.send("pong");
  });
  app2.get("/api/auth/dropbox/url", async (_req, res) => {
    try {
      const url = await getAuthUrl();
      res.json({ url });
    } catch (error) {
      console.error("Error generating auth URL:", error);
      res.status(500).json({ error: "Failed to generate auth URL" });
    }
  });
  app2.post("/api/auth/dropbox/token", async (req, res) => {
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
  app2.post("/api/sync", async (_req, res) => {
    try {
      const result = await syncDropbox();
      res.json(result);
    } catch (error) {
      console.error("Sync failed:", error);
      res.status(500).json({ error: "Sync failed", details: error.message });
    }
  });
  app2.get("/api/tracks", (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const search = req.query.search || "";
      const category = req.query.category || "all";
      const offset = (page - 1) * limit;
      const status = req.query.status || "all";
      let query = "SELECT t.*, c.name as category_name, s.name as subcategory_name FROM tracks t LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN categories s ON t.subcategory_id = s.id WHERE 1=1";
      let countQuery = "SELECT COUNT(*) as total FROM tracks WHERE 1=1";
      const params = [];
      if (search) {
        const searchCondition = " AND (title LIKE ? OR artist LIKE ? OR album LIKE ? OR source_url LIKE ?)";
        query += searchCondition;
        countQuery += searchCondition;
        const searchParam = `%${search}%`;
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (category !== "all") {
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
      const tracks = db.prepare(query).all(...queryParams).map((t) => ({
        ...t,
        url: t.filepath ? `/music/${path2.basename(t.filepath)}` : null
      }));
      const totalResult = db.prepare(countQuery).get(...params);
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
  app2.get("/api/tracks/:id", (req, res) => {
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
    } catch (error) {
      console.error("Error fetching track:", error);
      res.status(500).json({ error: "Failed to fetch track", details: error.message });
    }
  });
  app2.get("/api/tracks/:id/preview", async (req, res) => {
    console.log("[PREVIEW] Request received for track:", req.params.id);
    const { id } = req.params;
    try {
      console.log("[PREVIEW] Querying database...");
      const track = db.prepare("SELECT source_url, filepath FROM tracks WHERE id = ?").get(id);
      console.log("[PREVIEW] Database query complete, track:", track ? "found" : "not found");
      if (!track) {
        console.log("[PREVIEW] Track not found, returning 404");
        return res.status(404).json({ error: "Track not found" });
      }
      if (track.filepath) {
        const localUrl = `/music/${path2.basename(track.filepath)}`;
        console.log("[PREVIEW] Track has filepath, returning local URL:", localUrl);
        return res.json({ url: localUrl });
      }
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
  app2.post("/api/tracks/:id/download", async (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
      if (!track) {
        return res.status(404).json({ error: "Track not found" });
      }
      if (!track.source_url) {
        return res.status(400).json({ error: "Track has no source URL" });
      }
      console.log(`Starting Dropbox download for track ${id}: ${track.source_url}`);
      db.prepare("UPDATE tracks SET status = 'downloading' WHERE id = ?").run(id);
      downloadFromDropbox(Number(id), track.source_url);
      res.json({ id, status: "downloading", message: "Download started" });
    } catch (error) {
      console.error("Error starting download for existing track:", error);
      res.status(500).json({ error: "Failed to start download" });
    }
  });
  async function downloadFromDropbox(trackId, dropboxPath) {
    try {
      const dbx = await getDropboxClient();
      const filename = `${trackId}_${Date.now()}.mp3`;
      const filepath = path2.join(musicDir, filename);
      console.log(`Downloading ${dropboxPath} to ${filepath}...`);
      const response = await dbx.filesDownload({ path: dropboxPath });
      const fileBinary = response.result.fileBinary;
      if (!fileBinary) {
        throw new Error("No file data received from Dropbox");
      }
      fs.writeFileSync(filepath, fileBinary);
      console.log(`Download ${trackId} completed successfully.`);
      const duration = await extractDuration(filepath);
      if (duration) {
        console.log(`[Download] Extracted duration for track ${trackId}: ${duration}s`);
        const track = db.prepare("SELECT category_id FROM tracks WHERE id = ?").get(trackId);
        let defaultCueOut = duration;
        if (track && track.category_id) {
          const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id);
          if (category) {
            const segueOffset = category.type === "music" ? 3 : 0.5;
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
    } catch (error) {
      console.error(`Download ${trackId} failed:`, error);
      db.prepare("UPDATE tracks SET status = 'error' WHERE id = ?").run(trackId);
    }
  }
  app2.put("/api/tracks/:id", (req, res) => {
    const { id } = req.params;
    const { title, artist, album, category_id, subcategory_id, cue_out } = req.body;
    try {
      const currentTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
      if (!currentTrack) return res.status(404).json({ error: "Track not found" });
      let newCueOut = cue_out;
      if (newCueOut === void 0 && currentTrack.duration) {
        const catId = category_id || currentTrack.category_id;
        if (catId) {
          const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(catId);
          if (category) {
            const offset = category.type === "music" ? 3 : 0.5;
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
  app2.patch("/api/tracks/:id/cuepoints", (req, res) => {
    const { id } = req.params;
    const { cueIn, cueOut, segueDuration } = req.body;
    try {
      const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
      if (!track) return res.status(404).json({ error: "Track not found" });
      db.prepare(`
          UPDATE tracks 
          SET cue_in = ?, cue_out = ?, segue_duration = ?
          WHERE id = ?
        `).run(cueIn, cueOut, segueDuration, id);
      const updatedTrack = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
      res.json(updatedTrack);
    } catch (error) {
      console.error("Error updating cue points:", error);
      res.status(500).json({ error: "Failed to update cue points", details: error.message });
    }
  });
  app2.post("/api/tracks/:id/extract-duration", async (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(id);
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
      let defaultCueOut = duration;
      if (track.category_id) {
        const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id);
        if (category) {
          const segueOffset = category.type === "music" ? 3 : 0.5;
          defaultCueOut = Math.max(0, duration - segueOffset);
          console.log(`[ExtractDuration] Setting cue_out to ${defaultCueOut}s (duration ${duration}s - segue ${segueOffset}s)`);
        }
      }
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
    } catch (error) {
      console.error("Error extracting duration:", error);
      res.status(500).json({ error: "Failed to extract duration", details: error.message });
    }
  });
  app2.post("/api/tracks/extract-duration-batch", async (req, res) => {
    try {
      const tracks = db.prepare(
        "SELECT id, filepath, category_id, duration, cue_out FROM tracks WHERE filepath IS NOT NULL AND filepath != ''"
      ).all();
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
            const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id);
            if (category) {
              const segueOffset = category.type === "music" ? 3 : 0.5;
              defaultCueOut = Math.max(0, duration - segueOffset);
            }
          }
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
    } catch (error) {
      console.error("Error in batch duration extraction:", error);
      res.status(500).json({ error: "Failed to extract durations", details: error.message });
    }
  });
  app2.get("/api/tracks/:id/stream", (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT filepath FROM tracks WHERE id = ?").get(id);
      if (!track || !track.filepath) {
        return res.status(404).json({ error: "Track not found or not downloaded" });
      }
      if (!fs.existsSync(track.filepath)) {
        return res.status(404).json({ error: "Audio file not found on server" });
      }
      const stat = fs.statSync(track.filepath);
      const fileSize = stat.size;
      const range = req.headers.range;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range");
      res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(track.filepath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "audio/mpeg"
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          "Content-Length": fileSize,
          "Content-Type": "audio/mpeg"
        };
        res.writeHead(200, head);
        fs.createReadStream(track.filepath).pipe(res);
      }
    } catch (error) {
      console.error("Error streaming track:", error);
      res.status(500).json({ error: "Failed to stream track" });
    }
  });
  app2.delete("/api/tracks/:id", (req, res) => {
    const { id } = req.params;
    try {
      const track = db.prepare("SELECT filepath FROM tracks WHERE id = ?").get(id);
      if (track && track.filepath && fs.existsSync(track.filepath)) {
        fs.unlinkSync(track.filepath);
        console.log(`Deleted file from server: ${track.filepath}`);
      }
      db.prepare("UPDATE tracks SET filepath = NULL, status = NULL WHERE id = ?").run(id);
      console.log(`Track ${id} removed from server, remains in database as cloud-only`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting track:", error);
      res.status(500).json({ error: "Failed to delete track" });
    }
  });
  app2.get("/api/categories", (_req, res) => {
    try {
      const categories = db.prepare("SELECT * FROM categories ORDER BY type, parent_id, name").all();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });
  app2.get("/api/clocks", (_req, res) => {
    try {
      const clocks = db.prepare("SELECT * FROM clocks").all();
      res.json(clocks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clocks" });
    }
  });
  app2.post("/api/clocks", (req, res) => {
    const { name, color } = req.body;
    try {
      const result = db.prepare("INSERT INTO clocks (name, color) VALUES (?, ?)").run(name, color);
      res.json({ id: result.lastInsertRowid, name, color });
    } catch (error) {
      res.status(500).json({ error: "Failed to create clock" });
    }
  });
  app2.get("/api/clocks/:id", (req, res) => {
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
  app2.post("/api/clocks/:id/items", (req, res) => {
    const { id } = req.params;
    const { items } = req.body;
    const insert = db.prepare("INSERT INTO clock_items (clock_id, position, category_id, duration_target) VALUES (?, ?, ?, ?)");
    const deleteOld = db.prepare("DELETE FROM clock_items WHERE clock_id = ?");
    const transaction = db.transaction((clockId, newItems) => {
      deleteOld.run(clockId);
      newItems.forEach((item, index) => {
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
  app2.delete("/api/clocks/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM clocks WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete clock" });
    }
  });
  app2.get("/api/schedule/grid", (_req, res) => {
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
  app2.post("/api/schedule/grid", (req, res) => {
    const { assignments } = req.body;
    const insert = db.prepare("INSERT OR REPLACE INTO schedule_grid (day_of_week, hour, clock_id) VALUES (?, ?, ?)");
    const transaction = db.transaction((items) => {
      items.forEach((item) => {
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
  app2.get("/api/rules", (_req, res) => {
    try {
      const rules = db.prepare("SELECT * FROM rules").all();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });
  app2.post("/api/rules", (req, res) => {
    const { category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode } = req.body;
    try {
      const existing = db.prepare("SELECT id FROM rules WHERE category_id = ?").get(category_id);
      if (existing) {
        db.prepare("UPDATE rules SET min_separation = ?, tempo_range_min = ?, tempo_range_max = ?, selection_mode = ? WHERE category_id = ?").run(min_separation, tempo_range_min, tempo_range_max, selection_mode, category_id);
      } else {
        db.prepare("INSERT INTO rules (category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode) VALUES (?, ?, ?, ?, ?)").run(category_id, min_separation, tempo_range_min, tempo_range_max, selection_mode);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save rule" });
    }
  });
  app2.post("/api/schedule/preview", (req, res) => {
    const { clock_id } = req.body;
    try {
      const items = db.prepare(`
        SELECT ci.*, c.name as category_name 
        FROM clock_items ci 
        JOIN categories c ON ci.category_id = c.id 
        WHERE ci.clock_id = ? 
        ORDER BY ci.position
      `).all(clock_id);
      if (items.length === 0) {
        return res.json({ log: [] });
      }
      const log = [];
      let currentTime = 0;
      for (const item of items) {
        const track = db.prepare(`
          SELECT * FROM tracks 
          WHERE (category_id = ? OR subcategory_id = ?) 
          AND status = 'ready'
          ORDER BY RANDOM() 
          LIMIT 1
        `).get(item.category_id, item.category_id);
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
          currentTime += track.duration || 180;
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
  app2.get("/api/stream/next-track", (req, res) => {
    try {
      const clock = db.prepare("SELECT id FROM clocks ORDER BY id LIMIT 1").get();
      if (!clock) return res.json({ track: null, error: "No clock configured" });
      const clockItems = db.prepare(`
        SELECT ci.*, c.name as category_name 
        FROM clock_items ci 
        JOIN categories c ON ci.category_id = c.id 
        WHERE ci.clock_id = ? 
        ORDER BY ci.position
      `).all(clock.id);
      if (clockItems.length === 0) return res.json({ track: null, error: "No items in clock" });
      let state = db.prepare("SELECT * FROM playback_state WHERE id = 1").get();
      if (!state) {
        db.prepare("INSERT INTO playback_state (id, current_clock_id, current_position) VALUES (1, ?, 0)").run(clock.id);
        state = { id: 1, current_clock_id: clock.id, current_position: 0 };
      }
      if (state.current_clock_id !== clock.id) {
        db.prepare("UPDATE playback_state SET current_clock_id = ?, current_position = 0, last_updated = datetime('now') WHERE id = 1").run(clock.id);
        state.current_position = 0;
        state.current_clock_id = clock.id;
      }
      const currentPosition = state.current_position % clockItems.length;
      const currentItem = clockItems[currentPosition];
      const nextPosition = (state.current_position + 1) % clockItems.length;
      db.prepare("UPDATE playback_state SET current_position = ?, last_updated = datetime('now') WHERE id = 1").run(nextPosition);
      const rule = db.prepare("SELECT * FROM rules WHERE category_id = ?").get(currentItem.category_id);
      const minSeparationMinutes = rule?.min_separation || 120;
      const recentArtists = db.prepare(`
        SELECT DISTINCT artist FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
        AND artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist'
      `).all(minSeparationMinutes);
      const recentArtistList = recentArtists.map((r) => r.artist);
      const recentTracks = db.prepare(`
        SELECT DISTINCT track_id FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
      `).all(minSeparationMinutes);
      const recentTrackIds = recentTracks.map((r) => r.track_id);
      const recentTitles = db.prepare(`
        SELECT DISTINCT title FROM play_history 
        WHERE played_at > datetime('now', '-' || ? || ' minutes')
        AND title IS NOT NULL AND title != ''
      `).all(minSeparationMinutes);
      const recentTitleList = recentTitles.map((r) => r.title);
      let trackQuery = `
        SELECT * FROM tracks 
        WHERE (category_id = ? OR subcategory_id = ?) 
        AND filepath IS NOT NULL
        AND status = 'ready'
      `;
      const params = [currentItem.category_id, currentItem.category_id];
      if (recentTrackIds.length > 0) {
        trackQuery += ` AND id NOT IN (${recentTrackIds.join(",")})`;
      }
      if (recentTitleList.length > 0) {
        const titlePlaceholders = recentTitleList.map(() => "?").join(",");
        trackQuery += ` AND (title IS NULL OR title NOT IN (${titlePlaceholders}))`;
        params.push(...recentTitleList);
      }
      if (recentArtistList.length > 0) {
        const placeholders = recentArtistList.map(() => "?").join(",");
        trackQuery += ` AND (artist IS NULL OR artist = '' OR artist = 'Unknown Artist' OR artist NOT IN (${placeholders}))`;
        params.push(...recentArtistList);
      }
      trackQuery += " ORDER BY RANDOM() LIMIT 1";
      let track = db.prepare(trackQuery).get(...params);
      if (!track) {
        let fallbackQuery = `
          SELECT * FROM tracks 
          WHERE (category_id = ? OR subcategory_id = ?) 
          AND filepath IS NOT NULL
          AND status = 'ready'
        `;
        const fallbackParams = [currentItem.category_id, currentItem.category_id];
        if (recentTrackIds.length > 0) {
          fallbackQuery += ` AND id NOT IN (${recentTrackIds.join(",")})`;
        }
        if (recentTitleList.length > 0) {
          const titlePlaceholders = recentTitleList.map(() => "?").join(",");
          fallbackQuery += ` AND (title IS NULL OR title NOT IN (${titlePlaceholders}))`;
          fallbackParams.push(...recentTitleList);
        }
        fallbackQuery += " ORDER BY RANDOM() LIMIT 1";
        track = db.prepare(fallbackQuery).get(...fallbackParams);
      }
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
        `).get(currentItem.category_id, currentItem.category_id);
      }
      if (!track) return res.json({ track: null, error: "No tracks available for category: " + currentItem.category_name });
      db.prepare(`
        INSERT INTO play_history (track_id, title, artist, category_id, played_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(track.id, track.title, track.artist, track.category_id);
      let calculatedCueOut = track.cue_out;
      if (!calculatedCueOut && track.duration && track.duration > 3) {
        const category = db.prepare("SELECT type FROM categories WHERE id = ?").get(track.category_id);
        const segueOffset = category?.type === "music" ? 3 : 0.5;
        calculatedCueOut = track.duration - segueOffset;
      }
      res.json({ track: { ...track, cue_out: calculatedCueOut }, clock_position: currentPosition, category: currentItem.category_name });
    } catch (error) {
      console.error("Next track API failed:", error);
      res.status(500).json({ track: null, error: "Failed to get next track" });
    }
  });
  app2.get("/api/stream/history", (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const history = db.prepare(`
        SELECT ph.*, t.album, t.filepath, c.name as category_name
        FROM play_history ph
        LEFT JOIN tracks t ON ph.track_id = t.id
        LEFT JOIN categories c ON ph.category_id = c.id
        ORDER BY ph.played_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
      const total = db.prepare("SELECT COUNT(*) as count FROM play_history").get().count;
      res.json({ history, total, limit, offset });
    } catch (error) {
      console.error("Play history API failed:", error);
      res.status(500).json({ error: "Failed to get play history" });
    }
  });
  app2.get("/api/stream/history/export", (req, res) => {
    try {
      const history = db.prepare(`
        SELECT ph.played_at, ph.title, ph.artist, c.name as category
        FROM play_history ph
        LEFT JOIN categories c ON ph.category_id = c.id
        ORDER BY ph.played_at DESC
      `).all();
      let csv = "Played At,Title,Artist,Category\n";
      for (const row of history) {
        const playedAt = row.played_at || "";
        const title = (row.title || "").replace(/"/g, '""');
        const artist = (row.artist || "").replace(/"/g, '""');
        const category = (row.category || "").replace(/"/g, '""');
        csv += `"${playedAt}","${title}","${artist}","${category}"
`;
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="play_history.csv"');
      res.send(csv);
    } catch (error) {
      console.error("Play history export failed:", error);
      res.status(500).json({ error: "Failed to export play history" });
    }
  });
  app2.post("/api/setup-deploy-key", (req, res) => {
    const { secret, pubkey } = req.body || {};
    if (secret !== "novastream-setup-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!pubkey || typeof pubkey !== "string" || !pubkey.startsWith("ssh-")) {
      return res.status(400).json({ error: "Invalid pubkey" });
    }
    try {
      const { execSync } = __require("child_process");
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
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import path3 from "path";
import fs2 from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
import { dirname } from "path";
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = dirname(__filename3);
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
(async () => {
  registerRoutes(app);
  const possibleDistPaths = [
    path3.join(__dirname3, "public"),
    // If running from dist/index.js (ESM build)
    path3.join(__dirname3, "..", "public"),
    // If running from dist/server/index.js
    path3.join(__dirname3, "..", "dist", "public"),
    // If running from server/index.ts (dev)
    "/root/novastream-admin/dist/public"
    // Hardcoded fallback for VPS
  ];
  let distPath = "";
  for (const p of possibleDistPaths) {
    console.log(`Checking for frontend at: ${p}`);
    if (fs2.existsSync(path3.join(p, "index.html"))) {
      distPath = p;
      console.log(`Found frontend at: ${distPath}`);
      break;
    }
  }
  if (distPath) {
    const musicDir2 = path3.join(__dirname3, "..", "storage", "music");
    console.log(`Serving music from: ${musicDir2}`);
    app.use("/music", express2.static(musicDir2));
    app.use(express2.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      }
    }));
    app.get("*", (_req, res) => {
      if (!_req.path.startsWith("/api")) {
        res.sendFile(path3.join(distPath, "index.html"));
      }
    });
  } else {
    console.error("Frontend build not found in any expected location.");
    app.get("/", (_req, res) => {
      res.send(`NovaStream API Server is running. Frontend NOT found. Checked: ${possibleDistPaths.join(", ")}`);
    });
  }
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
