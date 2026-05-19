import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path
const dbPath = path.resolve(__dirname, "..", "radio.db");

export const db = new Database(dbPath);

// Initialize database schema
export function initDb() {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -32000');
  db.pragma('foreign_keys = ON');

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
      slot_type TEXT DEFAULT 'category',
      category_id INTEGER, -- Nullable: NULL for track slots
      track_id INTEGER,    -- Set for pinned track slots
      duration_target INTEGER,
      FOREIGN KEY (clock_id) REFERENCES clocks(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
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

  // Migration: Add cue_out column if it doesn't exist
  const columns = db.pragma("table_info(tracks)");
  
  if (!columns.some((col: any) => col.name === "cue_out")) {
    console.log("Migrating: Adding cue_out column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN cue_out REAL");
  }

  if (!columns.some((col: any) => col.name === "category_id")) {
    console.log("Migrating: Adding category_id column to tracks table...");
    db.exec("ALTER TABLE tracks ADD COLUMN category_id INTEGER REFERENCES categories(id)");
  }

    if (!columns.some((col: any) => col.name === "subcategory_id")) {
      console.log("Migrating: Adding subcategory_id column to tracks table...");
      db.exec("ALTER TABLE tracks ADD COLUMN subcategory_id INTEGER REFERENCES categories(id)");
    }

    if (!columns.some((col: any) => col.name === "cue_in")) {
      console.log("Migrating: Adding cue_in column to tracks table...");
      db.exec("ALTER TABLE tracks ADD COLUMN cue_in REAL DEFAULT 0");
    }

    if (!columns.some((col: any) => col.name === "segue_duration")) {
      console.log("Migrating: Adding segue_duration column to tracks table...");
      db.exec("ALTER TABLE tracks ADD COLUMN segue_duration REAL DEFAULT 3.0");
    }

  // Seed default categories if empty
  const count = db.prepare("SELECT COUNT(*) as count FROM categories").get();
  if (count.count === 0) {
    console.log("Seeding default categories...");
    const insertCat = db.prepare("INSERT INTO categories (name, parent_id, type, color) VALUES (?, ?, ?, ?)");
    
    // Music
    const music = insertCat.run("Music", null, "music", "#3b82f6"); // Blue
    const musicId = music.lastInsertRowid;
    insertCat.run("Country", musicId, "music", "#60a5fa");
    insertCat.run("Rock", musicId, "music", "#ef4444");
    insertCat.run("AC", musicId, "music", "#f59e0b");
    insertCat.run("Pop", musicId, "music", "#ec4899");
    insertCat.run("Alt", musicId, "music", "#8b5cf6");

    // Commercial
    insertCat.run("Commercial", null, "commercial", "#10b981"); // Green

    // Promo
    const promo = insertCat.run("Promo", null, "promo", "#f97316"); // Orange
    const promoId = promo.lastInsertRowid;
    insertCat.run("Country", promoId, "promo", "#fb923c");
    insertCat.run("Rock", promoId, "promo", "#fb923c");
    insertCat.run("AC", promoId, "promo", "#fb923c");
    insertCat.run("Pop", promoId, "promo", "#fb923c");
    insertCat.run("Alt", promoId, "promo", "#fb923c");

    // Liner
    const liner = insertCat.run("Liner", null, "liner", "#a855f7"); // Purple
    const linerId = liner.lastInsertRowid;
    insertCat.run("Short", linerId, "liner", "#c084fc");
    insertCat.run("Medium", linerId, "liner", "#c084fc");
    insertCat.run("Music", linerId, "liner", "#c084fc");
    insertCat.run("Attitude", linerId, "liner", "#c084fc");
    insertCat.run("Specialty", linerId, "liner", "#c084fc");

    // Content
    const content = insertCat.run("Content", null, "content", "#06b6d4"); // Cyan
    const contentId = content.lastInsertRowid;
    insertCat.run("News", contentId, "content", "#22d3ee");
    insertCat.run("Segments", contentId, "content", "#22d3ee");

    // ID
    insertCat.run("ID", null, "id", "#64748b"); // Slate
  }

  // Seed default rules for categories that have none
  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO rules (category_id, min_separation, selection_mode)
    SELECT c.id, ?, ? FROM categories c
    WHERE c.name = ? AND c.type = ?
      AND NOT EXISTS (SELECT 1 FROM rules r WHERE r.category_id = c.id)
  `);
  // type => [min_separation_minutes, selection_mode]
  const ruleDefaults: [string, string, number, string][] = [
    ["Music",      "music",      40,  "random"],
    ["Commercial", "commercial", 20,  "oldest"],
    ["Promo",      "promo",      60,  "random"],
    ["Liner",      "liner",      30,  "random"],
    ["Content",    "content",    90,  "random"],
    ["ID",         "id",         15,  "random"],
  ];
  for (const [name, type, sep, mode] of ruleDefaults) {
    insertRule.run(sep, mode, name, type);
  }

  // Migration: Ensure clock_items has nullable category_id and track_id/slot_type columns
  // SQLite doesn't support ALTER COLUMN, so we recreate the table if category_id is NOT NULL
  const clockItemCols = db.pragma("table_info(clock_items)");
  const catCol = clockItemCols.find((col: any) => col.name === "category_id") as any;
  const needsRebuild = catCol && catCol.notnull === 1;
  
  if (needsRebuild) {
    console.log("[migration] Rebuilding clock_items table to allow nullable category_id...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS clock_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clock_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        slot_type TEXT DEFAULT 'category',
        category_id INTEGER,
        track_id INTEGER,
        duration_target INTEGER,
        FOREIGN KEY (clock_id) REFERENCES clocks(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
      );
      INSERT INTO clock_items_new (id, clock_id, position, slot_type, category_id, track_id, duration_target)
        SELECT id, clock_id, position,
          COALESCE(slot_type, 'category'),
          category_id,
          NULL,
          duration_target
        FROM clock_items;
      DROP TABLE clock_items;
      ALTER TABLE clock_items_new RENAME TO clock_items;
    `);
    console.log("[migration] clock_items rebuilt successfully");
  } else {
    if (!clockItemCols.some((col: any) => col.name === "slot_type")) {
      console.log("[migration] Adding slot_type column to clock_items...");
      db.exec("ALTER TABLE clock_items ADD COLUMN slot_type TEXT DEFAULT 'category'");
    }
    if (!clockItemCols.some((col: any) => col.name === "track_id")) {
      console.log("[migration] Adding track_id column to clock_items...");
      db.exec("ALTER TABLE clock_items ADD COLUMN track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL");
    }
  }

  // Migration: Add mode column to clocks (loop = default, sequential = run-to-completion)
  const clockCols = db.pragma("table_info(clocks)");
  if (!clockCols.some((col: any) => col.name === "mode")) {
    console.log("[migration] Adding mode column to clocks...");
    db.exec("ALTER TABLE clocks ADD COLUMN mode TEXT DEFAULT 'loop'");
  }

  // Migration: Add tags column to tracks
  const trackCols2 = db.pragma("table_info(tracks)");
  if (!trackCols2.some((col: any) => col.name === "tags")) {
    console.log("[migration] Added tags column to tracks table");
    db.exec("ALTER TABLE tracks ADD COLUMN tags TEXT DEFAULT ''");
  }

  // Performance indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_status_cat
      ON tracks(status, category_id, filepath);
    CREATE INDEX IF NOT EXISTS idx_tracks_status_subcat
      ON tracks(status, subcategory_id, filepath);
    CREATE INDEX IF NOT EXISTS idx_play_history_cat_time
      ON play_history(category_id, played_at DESC);
  `);

  console.log("Database initialized at", dbPath);
}

// Add play_history table if it doesn't exist
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
