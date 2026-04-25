#!/bin/bash
# Deploys the player index.html and adds the /api/stream/now nginx proxy.
# Safe to run multiple times.

REPO_DIR="/root/novastream-admin"
PLAYER_SRC="$REPO_DIR/player/index.html"

echo "=== NovaStream player deploy ==="

# --- Find nginx web root and config ---
WEBROOT=""
NGINX_CONF=""

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

# Fallback: search for existing player HTML by content
if [ -z "$WEBROOT" ]; then
  FOUND=$(find /var/www -name "index.html" 2>/dev/null | while read f; do
    grep -q "Stream of Dan" "$f" 2>/dev/null && echo "$f" && break
  done)
  if [ -n "$FOUND" ]; then
    WEBROOT=$(dirname "$FOUND")
    echo "Found existing player at: $FOUND"
  fi
fi

# Last resort fallback
if [ -z "$WEBROOT" ]; then
  WEBROOT="/var/www/html"
  echo "No web root found, defaulting to $WEBROOT"
fi

if [ -z "$NGINX_CONF" ]; then
  NGINX_CONF=$(grep -rl "$WEBROOT" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -1 || true)
  [ -z "$NGINX_CONF" ] && NGINX_CONF="/etc/nginx/sites-enabled/default"
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
ALREADY=$(grep -c "api/stream/now" "$NGINX_CONF" 2>/dev/null || echo "0")
if [ "$ALREADY" -gt "0" ]; then
  echo "Nginx proxy already present, skipping"
else
  echo "Adding /api/stream/now proxy to $NGINX_CONF"

  SNIPPET="/etc/nginx/snippets/novastream-api-proxy.conf"
  mkdir -p /etc/nginx/snippets

  # Write snippet — single quotes around heredoc prevent shell from expanding $host
  cat > "$SNIPPET" << 'EOF'
location /api/stream/now {
    proxy_pass http://127.0.0.1:3001/api/stream/now;
    proxy_set_header Host $host;
    add_header Cache-Control no-store;
}
EOF

  # Add include line before last } in the nginx conf using Python
  python3 << PYEOF
conf_path = "$NGINX_CONF"
snippet_path = "$SNIPPET"
with open(conf_path, 'r') as f:
    content = f.read()
include_line = '\n    include ' + snippet_path + ';\n'
last_brace = content.rfind('}')
if last_brace == -1:
    raise Exception("No closing brace found in " + conf_path)
new_content = content[:last_brace] + include_line + content[last_brace:]
with open(conf_path, 'w') as f:
    f.write(new_content)
print("Include line inserted into " + conf_path)
PYEOF

  if nginx -t; then
    systemctl reload nginx
    echo "Nginx reloaded successfully"
  else
    echo "ERROR: nginx config test failed — reverting"
    git -C "$REPO_DIR" checkout HEAD -- /dev/null 2>/dev/null || true
    # Remove the include line we just added
    python3 << PYEOF2
conf_path = "$NGINX_CONF"
snippet_path = "$SNIPPET"
with open(conf_path, 'r') as f:
    content = f.read()
include_line = '\n    include ' + snippet_path + ';\n'
with open(conf_path, 'w') as f:
    f.write(content.replace(include_line, ''))
print("Reverted nginx conf")
PYEOF2
    exit 1
  fi
fi

echo "=== Player deploy complete ==="
