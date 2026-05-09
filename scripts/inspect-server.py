import subprocess

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()

print("=== streamofdan nginx config ===")
print(run("cat /etc/nginx/sites-enabled/streamofdan"))

print("\n=== novastream nginx config ===")
print(run("cat /etc/nginx/sites-enabled/novastream"))

print("\n=== danielmccolly nginx config ===")
print(run("cat /etc/nginx/sites-enabled/danielmccolly"))

print("\n=== /var/www/novastream/ ===")
print(run("ls -la /var/www/novastream/"))

print("\n=== player at /var/www/html/index.html (first 30 lines) ===")
print(run("head -30 /var/www/html/index.html"))

print("\n=== stream URL test ===")
print(run("curl -s -o /dev/null -w '%{http_code}' https://streamofdan.com/stream --max-time 5"))

print("\n=== /api/stream/now test ===")
print(run("curl -s http://localhost:3001/api/stream/now --max-time 5"))
