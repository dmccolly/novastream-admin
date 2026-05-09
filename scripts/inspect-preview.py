import re
import sys

with open('/root/novastream/dist/index.js.bak', 'r') as f:
    code = f.read()

print("=== localUrl context (500 chars each side) ===")
for m in re.finditer(r'const localUrl', code):
    start = max(0, m.start() - 500)
    end = min(len(code), m.end() + 500)
    print("CONTEXT:", repr(code[start:end]))
    print()

print("=== res.json localUrl context ===")
for m in re.finditer(r'res\.json\(\{ url: localUrl \}', code):
    start = max(0, m.start() - 300)
    end = min(len(code), m.end() + 100)
    print("CONTEXT:", repr(code[start:end]))
    print()
