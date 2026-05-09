import re
import sys

with open('/root/novastream/dist/index.js.bak', 'r') as f:
    code = f.read()

# Find all /music/ occurrences with context
print("=== Searching for /music/ patterns ===")
for i, m in enumerate(re.finditer(r'.{0,300}/music/.{0,300}', code)):
    print(f"MATCH {i}:", repr(m.group()))
    print()

# Also search for 'preview' route
print("=== Searching for preview route ===")
for i, m in enumerate(re.finditer(r'.{0,200}preview.{0,200}', code)):
    if 'url' in m.group() or 'music' in m.group() or 'json' in m.group():
        print(f"PREVIEW MATCH {i}:", repr(m.group()))
        print()

# Also search for res.json
print("=== Searching for res.json url patterns ===")
for i, m in enumerate(re.finditer(r'res\.json\(\{[^}]{0,200}url[^}]{0,200}\}', code)):
    print(f"JSON URL MATCH {i}:", repr(m.group()))
    print()
