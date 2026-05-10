#!/usr/bin/env python3
"""
Patch the novastream stream server dist/index.js to add Unknown Artist filter
to the recently played query in the /api/stream/now endpoint.
"""
import re
import sys
import shutil
from datetime import datetime

BUNDLE = '/root/novastream/dist/index.js'
BACKUP = f'/root/novastream/dist/index.js.bak.{int(datetime.now().timestamp())}'

with open(BUNDLE, 'r') as f:
    content = f.read()

# The exact query string we need to patch (from the compiled bundle)
OLD = "FROM play_history WHERE played_at <= COALESCE(?, datetime('now')) ORDER BY played_at DESC LIMIT 10"
NEW = "FROM play_history WHERE played_at <= COALESCE(?, datetime('now')) AND artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist' AND title IS NOT NULL AND title != '' ORDER BY played_at DESC LIMIT 10"

if OLD in content:
    shutil.copy(BUNDLE, BACKUP)
    print(f"Backup created: {BACKUP}")
    content = content.replace(OLD, NEW, 1)
    with open(BUNDLE, 'w') as f:
        f.write(content)
    print("PATCH APPLIED SUCCESSFULLY")
    # Verify
    if NEW in content:
        print("VERIFICATION PASSED")
    else:
        print("VERIFICATION FAILED")
        sys.exit(1)
else:
    print("OLD STRING NOT FOUND - searching for the query pattern...")
    matches = re.findall(r'FROM play_history[^;]{0,300}LIMIT \d+', content)
    for i, m in enumerate(matches[:5]):
        print(f"Match {i+1}: {repr(m[:200])}")
    sys.exit(1)
