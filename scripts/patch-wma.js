#!/usr/bin/env node
// Patch /root/novastream/dist/index.js to fix WMA stream 404:
// When DB filepath is .wma but file was already converted to .mp3 on disk,
// serve the .mp3 directly instead of returning 404.

const fs = require('fs');
const path = require('path');
const distFile = '/root/novastream/dist/index.js';

// Always restore from clean backup first
if (fs.existsSync(distFile + '.bak')) {
  fs.copyFileSync(distFile + '.bak', distFile);
  console.log('Restored from backup');
} else {
  fs.copyFileSync(distFile, distFile + '.bak');
  console.log('Created backup');
}

let code = fs.readFileSync(distFile, 'utf8');
const original = code;

// The current stream route has:
//   if (!fs.existsSync(track.filepath)) {
//     return res.status(404).json({ error: "Audio file not found on server" });
//   }
//   if (path.extname(track.filepath).toLowerCase() === '.wma') { ... transcode ... }
//
// The problem: when DB has .wma path but file was converted to .mp3,
// existsSync fails and we hit 404 before reaching the .wma transcode block.
// Fix: add MP3 fallback check inside the !existsSync block.

const oldPattern = 'if (!fs.existsSync(track.filepath)) {\n        return res.status(404).json({ error: "Audio file not found on server" });\n      }';
const newPattern = 'if (!fs.existsSync(track.filepath)) {\n        if (path.extname(track.filepath).toLowerCase() === \'.wma\') {\n          const mp3Alt = track.filepath.replace(/\\.wma$/i, \'.mp3\');\n          if (fs.existsSync(mp3Alt)) {\n            const s3 = fs.statSync(mp3Alt);\n            res.setHeader(\'Content-Type\', \'audio/mpeg\');\n            res.setHeader(\'Content-Length\', s3.size);\n            res.setHeader(\'Accept-Ranges\', \'bytes\');\n            res.setHeader(\'Access-Control-Allow-Origin\', \'*\');\n            fs.createReadStream(mp3Alt).pipe(res);\n            return;\n          }\n        }\n        return res.status(404).json({ error: "Audio file not found on server" });\n      }';

if (code.includes(oldPattern)) {
  code = code.replace(oldPattern, newPattern);
  console.log('PATCH OK: added MP3 fallback for WMA-path-but-MP3-on-disk');
} else {
  // Try to find what's actually there
  const idx = code.indexOf('Audio file not found on server');
  if (idx >= 0) {
    console.log('Pattern not found. Actual code around error:');
    console.log(JSON.stringify(code.slice(idx - 200, idx + 100)));
  } else {
    console.log('ERROR: "Audio file not found on server" not found in dist/index.js');
  }
  process.exit(1);
}

if (code !== original) {
  fs.writeFileSync(distFile, code);
  console.log('SUCCESS: dist/index.js updated');
} else {
  console.log('INFO: No changes made');
}
