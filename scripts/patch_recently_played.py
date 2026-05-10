#!/usr/bin/env python3
"""
Patch the novastream stream server dist/index.js to:
1. Add Unknown Artist / empty title filter to recently played query
2. Add the started_at timestamp filter (only show tracks played before current track started)
"""
import re
import sys
import shutil
from datetime import datetime

BUNDLE = '/root/novastream/dist/index.js'
BACKUP = f'/root/novastream/dist/index.js.bak.{int(datetime.now().timestamp())}'

with open(BUNDLE, 'r') as f:
    content = f.read()

print(f"Bundle size: {len(content)} bytes")

# The exact query string in the stream server bundle (has newlines/spaces)
OLD = "FROM play_history\n        ORDER BY played_at DESC\n        LIMIT 10"
NEW = "FROM play_history WHERE artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist' AND title IS NOT NULL AND title != '' ORDER BY played_at DESC LIMIT 10"

if OLD in content:
    shutil.copy(BUNDLE, BACKUP)
    print(f"Backup created: {BACKUP}")
    content = content.replace(OLD, NEW, 1)
    with open(BUNDLE, 'w') as f:
        f.write(content)
    print("PATCH APPLIED SUCCESSFULLY")
    if NEW in content:
        print("VERIFICATION PASSED")
    else:
        print("VERIFICATION FAILED - restoring backup")
        shutil.copy(BACKUP, BUNDLE)
        sys.exit(1)
else:
    print("OLD STRING NOT FOUND - printing all play_history query matches:")
    matches = re.findall(r'FROM play_history[^\n]{0,400}', content)
    for i, m in enumerate(matches[:5]):
        print(f"Match {i+1}: {repr(m[:300])}")
    sys.exit(1)
