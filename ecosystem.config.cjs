module.exports = {
  apps: [
    {
      name: "novastream-admin",
      script: "dist/index.js",
      cwd: "/root/novastream-admin",
      env: {
        NODE_ENV: "production",
        PORT: 3006,
        NODE_OPTIONS: "--max-old-space-size=512"
      }
    }
  ]
};
