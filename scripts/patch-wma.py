import sys
import os

dist_file = '/root/novastream/dist/index.js'
bak_file = dist_file + '.bak'

# Restore from backup
if os.path.exists(bak_file):
    import shutil
    shutil.copy2(bak_file, dist_file)
    print('Restored from backup')
else:
    import shutil
    shutil.copy2(dist_file, bak_file)
    print('Created backup')

with open(dist_file, 'r') as f:
    code = f.read()

marker = 'Audio file not found on server'
idx = code.find(marker)
if idx < 0:
    print('ERROR: marker not found in', dist_file)
    sys.exit(1)

block_start = code.rfind('if (!fs.existsSync(track.filepath))', 0, idx)
if block_start < 0:
    print('ERROR: if block start not found')
    sys.exit(1)

block_end = code.find('\n      }', idx) + len('\n      }')
old_block = code[block_start:block_end]
print('Old block length:', len(old_block))
print('Old block preview:', repr(old_block[:80]))

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
    "        var spawnFn = require('child_process').spawn;\n"
    "        res.setHeader('Content-Type', 'audio/mpeg');\n"
    "        res.setHeader('Transfer-Encoding', 'chunked');\n"
    "        res.setHeader('Accept-Ranges', 'none');\n"
    "        res.setHeader('Access-Control-Allow-Origin', '*');\n"
    "        var ffProc = spawnFn('ffmpeg', ['-i', track.filepath, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });\n"
    "        ffProc.stdout.pipe(res);\n"
    "        ffProc.on('error', function() { try { res.end(); } catch(e) {} });\n"
    "        req.on('close', function() { try { ffProc.kill(); } catch(e) {} });\n"
    "        return;\n"
    "      }"
)

new_code = code[:block_start] + new_block + code[block_end:]
with open(dist_file, 'w') as f:
    f.write(new_code)
print('SUCCESS: patch applied, new size:', len(new_code))
