#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const distFile = '/root/novastream/dist/index.js';
const bakFile = distFile + '.bak';

if (fs.existsSync(bakFile)) {
  fs.copyFileSync(bakFile, distFile);
  console.log('Restored from backup');
} else {
  fs.copyFileSync(distFile, bakFile);
  console.log('Created backup');
}

let code = fs.readFileSync(distFile, 'utf8');
const original = code;

// Find the exact position of the stream 404 block and replace it
const MARKER = 'Audio file not found on server';
const idx = code.indexOf(MARKER);
if (idx < 0) {
  console.log('ERROR: marker not found');
  process.exit(1);
}

// Find the start of the if block (scan back for "if (!fs.existsSync")
const blockStart = code.lastIndexOf('if (!fs.existsSync(track.filepath))', idx);
if (blockStart < 0) {
  console.log('ERROR: if block start not found');
  process.exit(1);
}

// Find the end of the if block (the closing brace + newline)
const blockEnd = code.indexOf('\n      }', idx) + '\n      }'.length;

const oldBlock = code.slice(blockStart, blockEnd);
console.log('Old block:', JSON.stringify(oldBlock));

const newBlock = `if (!fs.existsSync(track.filepath)) {
        if (path.extname(track.filepath).toLowerCase() === '.wma') {
          const mp3Path = track.filepath.replace(/\\.wma$/i, '.mp3');
          if (fs.existsSync(mp3Path)) {
            const mp3Stat = fs.statSync(mp3Path);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', mp3Stat.size);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return fs.createReadStream(mp3Path).pipe(res);
          }
          return res.status(404).json({ error: "Audio file not available" });
        }
        return res.status(404).json({ error: "Audio file not found on server" });
      }
      if (path.extname(track.filepath).toLowerCase() === '.wma') {
        const { spawn } = require('child_process');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Accept-Ranges', 'none');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const ff = spawn('ffmpeg', ['-i', track.filepath, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
        ff.stdout.pipe(res);
        ff.on('error', function() { try { res.end(); } catch(e) {} });
        req.on('close', function() { try { ff.kill(); } catch(e) {} });
        return;
      }`;

code = code.slice(0, blockStart) + newBlock + code.slice(blockEnd);
console.log('PATCH OK: WMA handling inserted');

fs.writeFileSync(distFile, code);
console.log('SUCCESS: dist/index.js updated');
