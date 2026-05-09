import subprocess, os

def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()

print("=== nginx sites-enabled ===")
print(run("ls /etc/nginx/sites-enabled/"))

print("\n=== nginx conf ===")
print(run("cat /etc/nginx/sites-enabled/default 2>/dev/null || cat /etc/nginx/sites-enabled/* 2>/dev/null | head -120"))

print("\n=== player HTML location ===")
print(run("find /var/www -name 'index.html' 2>/dev/null"))

print("\n=== /var/www/html/ ===")
print(run("ls -la /var/www/html/ 2>/dev/null"))

print("\n=== streamofdan.com DNS check ===")
print(run("curl -s -o /dev/null -w '%{http_code} %{url_effective}' http://localhost/ --max-time 3"))

print("\n=== nginx test ===")
print(run("nginx -t"))

print("\n=== PM2 list ===")
print(run("pm2 list"))
