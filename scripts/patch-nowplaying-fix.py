#!/usr/bin/env python3
"""
Patch the novastream-admin server bundle:
1. Fix __require("child_process") -> require2("child_process") on line 1373
2. Add POST /api/stream/now-playing endpoint before setup-deploy-key route
"""
import sys

BUNDLE = "/root/novastream-admin/dist/index.js"

with open(BUNDLE, 'r', encoding='utf-8') as f:
    content = f.read()

# --- FIX 1: Replace __require("child_process") with require2("child_process") ---
OLD_REQUIRE = '__require("child_process")'
NEW_REQUIRE = 'require2("child_process")'

if OLD_REQUIRE not in content:
    print(f"ERROR: Could not find '{OLD_REQUIRE}' in bundle")
    sys.exit(1)

count = content.count(OLD_REQUIRE)
content = content.replace(OLD_REQUIRE, NEW_REQUIRE)
print(f"FIX 1: Replaced {count} occurrence(s) of __require(\"child_process\") with require2(\"child_process\")")

# --- FIX 2: Add POST /api/stream/now-playing endpoint ---
# Insert it right before the setup-deploy-key route
ANCHOR = '  app2.post("/api/setup-deploy-key",'

if ANCHOR not in content:
    print(f"ERROR: Could not find anchor '{ANCHOR}' in bundle")
    sys.exit(1)

NOW_PLAYING_ROUTE = '''  app2.post("/api/stream/now-playing", (req, res) => {
    try {
      const { filepath, track_id, title, artist } = req.body || {};
      let trackData = null;
      if (track_id) {
        trackData = db.prepare("SELECT * FROM tracks WHERE id = ?").get(track_id);
      } else if (filepath) {
        trackData = db.prepare("SELECT * FROM tracks WHERE filepath = ?").get(filepath);
      }
      if (trackData) {
        db.prepare("INSERT INTO play_history (track_id, title, artist, category_id, played_at) VALUES (?, ?, ?, ?, ?)").run(
          trackData.id,
          trackData.title || title || "Unknown",
          trackData.artist || artist || "Unknown Artist",
          trackData.category_id || null,
          new Date().toISOString()
        );
        res.json({ ok: true, track: { title: trackData.title, artist: trackData.artist } });
      } else if (title) {
        db.prepare("INSERT INTO play_history (track_id, title, artist, category_id, played_at) VALUES (?, ?, ?, ?, ?)").run(
          null, title, artist || "Unknown Artist", null, new Date().toISOString()
        );
        res.json({ ok: true, track: { title, artist } });
      } else {
        res.status(400).json({ error: "No track identifier provided" });
      }
    } catch (e) {
      console.error("Now-playing update failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
  '''

content = content.replace(ANCHOR, NOW_PLAYING_ROUTE + ANCHOR)
print("FIX 2: Added POST /api/stream/now-playing endpoint")

# --- Verify the now-playing route is present ---
if '/api/stream/now-playing' not in content:
    print("ERROR: now-playing route not found after patch")
    sys.exit(1)

# --- Write back ---
with open(BUNDLE, 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: Bundle patched and written")

# --- Quick verification ---
import subprocess
result = subprocess.run(['node', '--input-type=module', '--eval', 'import("/root/novastream-admin/dist/index.js").catch(e => { if(e.message.includes("EADDRINUSE") || e.message.includes("already")) process.exit(0); console.error(e.message); process.exit(1); })'], 
                      capture_output=True, text=True, timeout=10)
print(f"Syntax check exit code: {result.returncode}")
if result.stderr:
    print(f"Stderr: {result.stderr[:500]}")
