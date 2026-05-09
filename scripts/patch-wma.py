import sys
import os
import shutil

dist_file = '/root/novastream/dist/index.js'
bak_file = dist_file + '.bak'

# Restore from backup
if os.path.exists(bak_file):
    shutil.copy2(bak_file, dist_file)
    print('Restored from backup')
else:
    shutil.copy2(dist_file, bak_file)
    print('Created backup')

with open(dist_file, 'r') as f:
    code = f.read()

# ---- PATCH 1: Fix the stream 404 block to handle WMA ----
# Uses 'spawn' (already imported at top of bundle via ES import)
marker = 'Audio file not found on server'
idx = code.find(marker)
if idx < 0:
    print('ERROR: marker not found')
    sys.exit(1)

block_start = code.rfind('if (!fs.existsSync(track.filepath))', 0, idx)
if block_start < 0:
    print('ERROR: if block start not found')
    sys.exit(1)

block_end = code.find('\n      }', idx) + len('\n      }')
old_block = code[block_start:block_end]
print('PATCH 1 old block length:', len(old_block))

new_block = (
    "if (!fs.existsSync(track.filepath)) {\n"
    "        var wmaExt2 = path.extname(track.filepath).toLowerCase() === '.wma';\n"
    "        if (wmaExt2) {\n"
    "          var mp3AltPath = track.filepath.replace(/\\.wma$/i, '.mp3');\n"
    "          if (fs.existsSync(mp3AltPath)) {\n"
    "            var mp3AltStat = fs.statSync(mp3AltPath);\n"
    "            res.setHeader('Content-Type', 'audio/mpeg');\n"
    "            res.setHeader('Content-Length', mp3AltStat.size);\n"
    "            res.setHeader('Accept-Ranges', 'bytes');\n"
    "            res.setHeader('Access-Control-Allow-Origin', '*');\n"
    "            return fs.createReadStream(mp3AltPath).pipe(res);\n"
    "          }\n"
    "          return res.status(404).json({ error: 'Audio file not available' });\n"
    "        }\n"
    "        return res.status(404).json({ error: 'Audio file not found on server' });\n"
    "      }\n"
    "      if (path.extname(track.filepath).toLowerCase() === '.wma') {\n"
    "        var wmaHeadersSent = false;\n"
    "        var wmaBytesWritten = 0;\n"
    "        var ffProc = spawn('ffmpeg', ['-i', track.filepath, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });\n"
    "        ffProc.stdout.on('data', function(chunk) {\n"
    "          wmaBytesWritten += chunk.length;\n"
    "          if (!wmaHeadersSent) {\n"
    "            wmaHeadersSent = true;\n"
    "            res.setHeader('Content-Type', 'audio/mpeg');\n"
    "            res.setHeader('Transfer-Encoding', 'chunked');\n"
    "            res.setHeader('Accept-Ranges', 'none');\n"
    "            res.setHeader('Access-Control-Allow-Origin', '*');\n"
    "          }\n"
    "          if (wmaBytesWritten <= 4096) { return; }\n"
    "          res.write(chunk);\n"
    "        });\n"
    "        ffProc.stdout.on('end', function() {\n"
    "          if (wmaBytesWritten < 10000) {\n"
    "            if (!res.headersSent) {\n"
    "              try { res.status(404).json({ error: 'Audio not available (DRM or unsupported)' }); } catch(e) {}\n"
    "            } else { try { res.end(); } catch(e) {} }\n"
    "          } else { try { res.end(); } catch(e) {} }\n"
    "        });\n"
    "        ffProc.on('error', function() { try { if (!res.headersSent) { res.status(404).json({ error: 'Audio conversion failed' }); } else { res.end(); } } catch(e) {} });\n"
    "        req.on('close', function() { try { ffProc.kill(); } catch(e) {} });\n"
    "        return;\n"
    "      }"
)

code = code[:block_start] + new_block + code[block_end:]
print('PATCH 1 OK')

# ---- PATCH 2: Fix the outer try/catch to not intercept WMA async errors ----
old_catch = '} catch (error) {\n      console.error("Error streaming track:", error);\n      res.status(500).json({ error: "Failed to stream track" });\n    }'
new_catch = '} catch (error) {\n      console.error("Error streaming track:", error);\n      if (!res.headersSent) { res.status(500).json({ error: "Failed to stream track" }); }\n    }'

if old_catch in code:
    code = code.replace(old_catch, new_catch)
    print('PATCH 2 OK: try/catch fixed')
else:
    print('PATCH 2 SKIP: catch pattern not found (may already be patched)')

# ---- PATCH 3: Fix preview route to return /stream for WMA files ----
# The preview route uses localUrl variable and returns it for on-server tracks.
# We need to intercept WMA files and redirect to /api/tracks/:id/stream instead.
# Exact pattern found by inspection of backup bundle:
old_preview = (
    "if (track.filepath) {\n"
    "        const localUrl = `/music/${path2.basename(track.filepath)}`;\n"
    "        console.log(\"[PREVIEW] Track has filepath, returning local URL:\", localUrl);\n"
    "        return res.json({ url: localUrl });\n"
    "      }"
)
new_preview = (
    "if (track.filepath) {\n"
    "        if (path2.extname(track.filepath).toLowerCase() === '.wma') {\n"
    "          console.log(\"[PREVIEW] WMA track, redirecting to stream endpoint\");\n"
    "          return res.json({ url: `/api/tracks/${id}/stream` });\n"
    "        }\n"
    "        const localUrl = `/music/${path2.basename(track.filepath)}`;\n"
    "        console.log(\"[PREVIEW] Track has filepath, returning local URL:\", localUrl);\n"
    "        return res.json({ url: localUrl });\n"
    "      }"
)

if old_preview in code:
    code = code.replace(old_preview, new_preview, 1)
    print('PATCH 3 OK: preview route fixed for WMA')
else:
    print('PATCH 3 FAILED: preview pattern not found')
    # Debug: find the closest match
    import re
    for m in re.finditer(r'if \(track\.filepath\)', code):
        ctx = code[m.start():m.start()+300]
        print('DEBUG context:', repr(ctx))

with open(dist_file, 'w') as f:
    f.write(code)
print('SUCCESS: patch applied, new size:', len(code))
