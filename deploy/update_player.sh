#!/bin/bash
# Deploys the player index.html and adds the /api/stream/now nginx proxy.
# Safe to run multiple times.
set -e

REPO_DIR="/root/novastream-admin"
PLAYER_SRC="$REPO_DIR/player/index.html"

echo "=== NovaStream player deploy ==="

# --- Find nginx web root ---
WEBROOT=""
for conf in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*; do
  [ -f "$conf" ] || continue
  ROOT=$(grep -E '^\s*root\s+' "$conf" | head -1 | awk '{print $2}' | tr -d ';')
  if [ -n "$ROOT" ]; then
    WEBROOT="$ROOT"
    NGINX_CONF="$conf"
    echo "Found web root: $WEBROOT (from $conf)"
    break
  fi
done

if [ -z "$WEBROOT" ]; then
  # Fallback: find existing player HTML
  FOUND=$(find /var/www -name "index.html" 2>/dev/null | xargs grep -l "Stream of Dan" 2>/dev/null | head -1)
  if [ -n "$FOUND" ]; then
    WEBROOT=$(dirname "$FOUND")
    echo "Found existing player at: $FOUND, using root: $WEBROOT"
    # Find which conf references this path
    NGINX_CONF=$(grep -rl "$WEBROOT" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -1)
  else
    WEBROOT="/var/www/html"
    echo "No web root found, defaulting to $WEBROOT"
    NGINX_CONF="/etc/nginx/sites-enabled/default"
  fi
fi

echo "Nginx conf: $NGINX_CONF"
echo "Web root:   $WEBROOT"

# --- Copy player HTML ---
if [ -f "$PLAYER_SRC" ]; then
  mkdir -p "$WEBROOT"
  cp "$PLAYER_SRC" "$WEBROOT/index.html"
  echo "Player HTML copied to $WEBROOT/index.html"
else
  echo "ERROR: $PLAYER_SRC not found"
  exit 1
fi

# --- Add nginx proxy for /api/stream/now ---
if grep -q "api/stream/now" "$NGINX_CONF" 2>/dev/null; then
  echo "Nginx proxy already present, skipping"
else
  echo "Adding /api/stream/now proxy to $NGINX_CONF"

  # Write a proxy snippet and include it, rather than editing the main conf with sed
  SNIPPET="/etc/nginx/snippets/novastream-api-proxy.conf"
  mkdir -p /etc/nginx/snippets
  cat > "$SNIPPET" << 'NGINXSNIPPET'
location /api/stream/now {
    proxy_pass http://127.0.0.1:3001/api/stream/now;
    proxy_set_header Host $host;
    add_header Cache-Control no-store;
}
NGINXSNIPPET

  # Include the snippet inside the first server block that doesn't already include it
  if ! grep -q "novastream-api-proxy" "$NGINX_CONF"; then
    # Insert "include /etc/nginx/snippets/novastream-api-proxy.conf;" before the last "}" in the file
    python3 - "$NGINX_CONF" "$SNIPPET" << 'PYEOF'
import sys
conf_path = sys.argv[1]
snippet_path = sys.argv[2]
with open(conf_path, 'r') as f:
    content = f.read()
include_line = f'\n    include {snippet_path};\n'
# Insert before the last closing brace
last_brace = content.rfind('}')
if last_brace == -1:
    print("ERROR: no closing brace found in nginx config")
    sys.exit(1)
new_content = content[:last_brace] + include_line + content[last_brace:]
with open(conf_path, 'w') as f:
    f.write(new_content)
print("Include line inserted successfully")
PYEOF
  fi

  nginx -t && systemctl reload nginx
  echo "Nginx reloaded"
fi

echo "=== Player deploy complete ==="
