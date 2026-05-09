import re

frontend_js = '/root/novastream/dist/public/assets/index-DjI8UMHp.js'
with open(frontend_js, 'r', errors='replace') as f:
    code = f.read()

print(f"File size: {len(code)} bytes")

# Find setPlayingTrack patterns with context
print("\n=== setPlayingTrack patterns ===")
for i, m in enumerate(re.finditer(r'setPlayingTrack', code)):
    ctx = code[max(0,m.start()-200):m.end()+200]
    print(f"MATCH {i}: {repr(ctx)}")
    print()

# Find audio.play() patterns
print("\n=== audio.play patterns ===")
for i, m in enumerate(re.finditer(r'audio\.play\b', code)):
    ctx = code[max(0,m.start()-300):m.end()+300]
    print(f"MATCH {i}: {repr(ctx)}")
    print()

# Find onplay patterns
print("\n=== onplay patterns ===")
for i, m in enumerate(re.finditer(r'onplay\b|\.onplay\s*=', code)):
    ctx = code[max(0,m.start()-200):m.end()+200]
    print(f"MATCH {i}: {repr(ctx)}")
    print()
