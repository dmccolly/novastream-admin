#!/usr/bin/env node
// Patch /root/novastream/dist/index.js to handle WMA files:
// 1. Preview route: redirect WMA to /stream endpoint
// 2. Stream route: serve pre-converted MP3 if exists, else transcode WMA via ffmpeg

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

// PATCH 1: Preview route - return /stream URL for WMA files
const previewOld = 'if (track.filepath) {\n        const localUrl = `/music/${path2.basename(track.filepath)}`;\n        console.log("[PREVIEW] Track has filepath, returning local URL:", localUrl);\n        return res.json({ url: localUrl });\n      }';
const previewNew = 'if (track.filepath) {\n        if (path.extname(track.filepath).toLowerCase() === \'.wma\') {\n          return res.json({ url: `/api/tracks/${id}/stream` });\n        }\n        const localUrl = `/music/${path2.basename(track.filepath)}`;\n        console.log("[PREVIEW] Track has filepath, returning local URL:", localUrl);\n        return res.json({ url: localUrl });\n      }';

if (code.includes(previewOld)) {
  code = code.replace(previewOld, previewNew);
  console.log('PATCH 1 OK: preview WMA redirect');
} else {
  console.log('PATCH 1 SKIP: pattern not found');
}

// PATCH 2: Stream route - resolve WMA path (may have been converted to MP3 already)
// and transcode remaining WMA files on the fly
const streamOld = 'if (!fs.existsSync(track.filepath)) {\n        return res.status(404).json({ error: "Audio file not found on server" });\n      }\n      const stat = fs.statSync(track.filepath);';

const streamNew = [
  'if (!fs.existsSync(track.filepath)) {',
  '        // WMA file may have already been converted to MP3 on disk',
  '        if (path.extname(track.filepath).toLowerCase() === \'.wma\') {',
  '          const mp3Path = track.filepath.replace(/\\.wma$/i, \'.mp3\');',
  '          if (fs.existsSync(mp3Path)) {',
  '            const stat2 = fs.statSync(mp3Path);',
  '            res.setHeader(\'Content-Type\', \'audio/mpeg\');',
  '            res.setHeader(\'Content-Length\', stat2.size);',
  '            res.setHeader(\'Accept-Ranges\', \'bytes\');',
  '            res.setHeader(\'Access-Control-Allow-Origin\', \'*\');',
  '            fs.createReadStream(mp3Path).pipe(res);',
  '            return;',
  '          }',
  '        }',
  '        return res.status(404).json({ error: "Audio file not found on server" });',
  '      }',
  '      // WMA file exists on disk - transcode it on the fly via ffmpeg',
  '      if (path.extname(track.filepath).toLowerCase() === \'.wma\') {',
  '        var spawn2 = require(\'child_process\').spawn;',
  '        res.setHeader(\'Content-Type\', \'audio/mpeg\');',
  '        res.setHeader(\'Transfer-Encoding\', \'chunked\');',
  '        res.setHeader(\'Access-Control-Allow-Origin\', \'*\');',
  '        var ff = spawn2(\'ffmpeg\', [\'-i\', track.filepath, \'-vn\', \'-ar\', \'44100\', \'-ac\', \'2\', \'-b:a\', \'192k\', \'-f\', \'mp3\', \'pipe:1\'], { stdio: [\'ignore\', \'pipe\', \'pipe\'] });',
  '        var started = false;',
  '        ff.stdout.on(\'data\', function(chunk) { started = true; res.write(chunk); });',
  '        ff.on(\'close\', function() { if (!started && !res.headersSent) { res.status(451).json({ error: "Track has rights restrictions" }); } else { res.end(); } });',
  '        ff.on(\'error\', function(e) { if (!res.headersSent) res.status(500).end(); });',
  '        req.on(\'close\', function() { ff.kill(); });',
  '        return;',
  '      }',
  '      const stat = fs.statSync(track.filepath);'
].join('\n');

if (code.includes(streamOld)) {
  code = code.replace(streamOld, streamNew);
  console.log('PATCH 2 OK: stream WMA path resolution + transcoding');
} else {
  console.log('PATCH 2 SKIP: pattern not found');
}

if (code !== original) {
  fs.writeFileSync(distFile, code);
  console.log('SUCCESS: Patched dist/index.js written');
} else {
  console.log('INFO: No changes made');
}
