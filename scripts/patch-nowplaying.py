import sys
import os
import re

frontend_js = '/root/novastream/dist/public/assets/index-DjI8UMHp.js'
bak_file = frontend_js + '.bak'

# Backup if not already done
if not os.path.exists(bak_file):
    import shutil
    shutil.copy2(frontend_js, bak_file)
    print('Created backup:', bak_file)
else:
    print('Backup already exists:', bak_file)

with open(frontend_js, 'r', errors='replace') as f:
    code = f.read()

print(f'File size: {len(code)} bytes')

# The fix: move setPlayingTrackId/setPlayingTrack to AFTER audio actually starts playing
# by using audio.onplay instead of setting them before audio.play()
old_block = (
    'audioRef.current = audio;\n'
    '      setPlayingTrackId(trackId);\n'
    '      setPlayingTrack(track);\n'
    '      let url;\n'
    '      if (track.filepath) {\n'
    '        url = `/api/tracks/${trackId}/stream`;\n'
    '      } else {\n'
    '        try {\n'
    '          setLoadingPreviewId(trackId);\n'
    '          url = await tracksApi.getPreviewUrl(trackId);\n'
    '        } catch (error) {\n'
    '          toast.error("Failed to get preview URL");\n'
    '          setLoadingPreviewId(null);\n'
    '          audioRef.current = null;\n'
    '          setPlayingTrackId(null);\n'
    '          setPlayingTrack(null);\n'
    '          return;\n'
    '        } finally {\n'
    '          setLoadingPreviewId(null);\n'
    '        }\n'
    '      }\n'
    '      if (url) {\n'
    '        audio.src = url;\n'
    '        audio.load();\n'
    '        audio.play().catch((e) => toast.error("Failed to play audio: " + e.message));\n'
    '      }\n'
    '    }\n'
    '  };'
)

new_block = (
    'audioRef.current = audio;\n'
    '      audio.onplay = () => { setPlayingTrackId(trackId); setPlayingTrack(track); };\n'
    '      let url;\n'
    '      if (track.filepath) {\n'
    '        url = `/api/tracks/${trackId}/stream`;\n'
    '      } else {\n'
    '        try {\n'
    '          setLoadingPreviewId(trackId);\n'
    '          url = await tracksApi.getPreviewUrl(trackId);\n'
    '        } catch (error) {\n'
    '          toast.error("Failed to get preview URL");\n'
    '          setLoadingPreviewId(null);\n'
    '          audioRef.current = null;\n'
    '          setPlayingTrackId(null);\n'
    '          setPlayingTrack(null);\n'
    '          return;\n'
    '        } finally {\n'
    '          setLoadingPreviewId(null);\n'
    '        }\n'
    '      }\n'
    '      if (url) {\n'
    '        audio.src = url;\n'
    '        audio.load();\n'
    '        audio.play().catch((e) => toast.error("Failed to play audio: " + e.message));\n'
    '      }\n'
    '    }\n'
    '  };'
)

if old_block in code:
    code = code.replace(old_block, new_block, 1)
    print('PATCH OK: Now Playing moved to onplay event')
else:
    print('PATCH FAILED: block not found')
    # Debug: show what's around audioRef.current = audio;
    idx = code.find('audioRef.current = audio;')
    if idx >= 0:
        print('DEBUG context:', repr(code[idx:idx+400]))
    sys.exit(1)

with open(frontend_js, 'w') as f:
    f.write(code)
print(f'SUCCESS: patched file written, new size: {len(code)} bytes')
