import re

frontend_js = '/root/novastream/dist/public/assets/index-DjI8UMHp.js'
with open(frontend_js, 'r', errors='replace') as f:
    code = f.read()

# Find the exact block around setPlayingTrackId(trackId) and setPlayingTrack(track)
# that comes before the url determination
marker = 'audioRef.current = audio;'
idx = code.find(marker)
if idx >= 0:
    # Get 800 chars of context after the marker
    ctx = code[idx:idx+800]
    print("=== EXACT BLOCK (800 chars from audioRef.current = audio;) ===")
    print(repr(ctx))
    print()

# Also find the exact audio.play() call with surrounding context
for m in re.finditer(r'audio\.play\(\)\.catch', code):
    ctx = code[max(0,m.start()-400):m.end()+200]
    print("=== audio.play().catch context ===")
    print(repr(ctx))
    print()
    break
