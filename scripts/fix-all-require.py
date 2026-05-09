#!/usr/bin/env python3
"""Replace ALL __require( function calls with require2( in the server bundle."""
import re
import sys

BUNDLE = "/root/novastream-admin/dist/index.js"

with open(BUNDLE, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace __require( calls but NOT the var definition line
# The definition is: var __require = /* @__PURE__ */ ((x) => ...
# We want to replace __require( where it's used as a function call
old_content = content
content = re.sub(r'(?<![a-zA-Z_$])__require\(', 'require2(', content)

replaced = old_content.count('__require(') - content.count('__require(')
print(f"Replaced {replaced} __require( calls with require2(")

remaining = len(re.findall(r'(?<![a-zA-Z_$])__require\(', content))
print(f"Remaining __require( calls: {remaining}")

if remaining > 0:
    for i, line in enumerate(content.split('\n'), 1):
        if '__require(' in line and 'var __require' not in line:
            print(f"  Line {i}: {line[:100]}")

with open(BUNDLE, 'w', encoding='utf-8') as f:
    f.write(content)

print("Bundle written successfully")
