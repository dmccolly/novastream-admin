import os
import re

dist_dir = '/root/novastream/dist'
print("=== All files in dist directory ===")
for root, dirs, files in os.walk(dist_dir):
    for f in files:
        path = os.path.join(root, f)
        size = os.path.getsize(path)
        print(f"  {path} ({size} bytes)")

print("\n=== Searching for audio player patterns ===")
for root, dirs, files in os.walk(dist_dir):
    for f in files:
        if f.endswith('.js'):
            path = os.path.join(root, f)
            try:
                with open(path, 'r', errors='replace') as fp:
                    content = fp.read()
                patterns = ['playingTrack', 'nowPlaying', 'onplay', 'setPlayingTrack', 'currentTrack']
                found = [p for p in patterns if p in content]
                if found:
                    print(f"\n  Found {found} in {path} ({len(content)} bytes)")
                    for pat in found[:2]:
                        for m in re.finditer(re.escape(pat), content):
                            ctx = content[max(0,m.start()-150):m.end()+150]
                            print(f"    [{pat}] CONTEXT: {repr(ctx)}")
                            print()
                            break
            except Exception as e:
                print(f"  Error reading {path}: {e}")
