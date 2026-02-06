import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logging middleware DISABLED for debugging
/*
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});
*/

(async () => {
  // Register API routes
  registerRoutes(app);

  // Serve static frontend files
  // Try multiple possible locations for robustness
  const possibleDistPaths = [
    path.join(__dirname, "public"),             // If running from dist/index.js (ESM build)
    path.join(__dirname, "..", "public"),       // If running from dist/server/index.js
    path.join(__dirname, "..", "dist", "public"), // If running from server/index.ts (dev)
    "/root/novastream-admin/dist/public" // Hardcoded fallback for VPS
  ];

  let distPath = "";
  for (const p of possibleDistPaths) {
    console.log(`Checking for frontend at: ${p}`);
    if (fs.existsSync(path.join(p, "index.html"))) {
      distPath = p;
      console.log(`Found frontend at: ${distPath}`);
      break;
    }
  }

  if (distPath) {
    // Serve music files
    const musicDir = path.join(__dirname, "..", "storage", "music");
    console.log(`Serving music from: ${musicDir}`);
    app.use("/music", express.static(musicDir));

    // Add cache-busting headers for JS and CSS files
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get("*", (_req, res) => {
      if (!_req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  } else {
    console.error("Frontend build not found in any expected location.");
    app.get("/", (_req, res) => {
      res.send(`NovaStream API Server is running. Frontend NOT found. Checked: ${possibleDistPaths.join(", ")}`);
    });
  }

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  const PORT = 3006;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
