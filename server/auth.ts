import { Dropbox, DropboxAuth } from "dropbox";
import { db } from "./db";
import "dotenv/config";

// Credentials from environment
const DBX_APP_KEY = process.env.DROPBOX_APP_KEY || "";
const DBX_APP_SECRET = process.env.DROPBOX_APP_SECRET || "";
const REDIRECT_URI = process.env.DROPBOX_REDIRECT_URI || "http://localhost";

export async function getDropboxClient() {
  // 1. Try to get access token from DB
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'dropbox_access_token'").get() as { value: string };
  let accessToken = tokenRow?.value;

  // 2. If no token in DB, check env (fallback)
  if (!accessToken) {
    accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  }

  // 3. Check for refresh token (PRIORITY)
  const refreshRow = db.prepare("SELECT value FROM settings WHERE key = 'dropbox_refresh_token'").get() as { value: string };
  let refreshToken = refreshRow?.value;

  if (!refreshToken) {
    refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  }

  if (refreshToken) {
    console.log("Using Refresh Token to get client...");
    const dbxAuth = new DropboxAuth({
      clientId: DBX_APP_KEY,
      clientSecret: DBX_APP_SECRET,
      refreshToken: refreshToken,
    });
    
    // This client will auto-refresh the token when needed!
    return new Dropbox({ auth: dbxAuth });
  }

  // Fallback to simple access token (might be expired)
  if (accessToken) {
    console.log("Using Access Token (no refresh token available)...");
    return new Dropbox({ accessToken });
  }

  throw new Error("No valid Dropbox credentials found");
}

export function getAuthUrl() {
  const dbxAuth = new DropboxAuth({
    clientId: DBX_APP_KEY,
    clientSecret: DBX_APP_SECRET,
  });
  
  // Standard flow (no PKCE)
  // tokenAccessType: 'offline' is CRITICAL for getting a refresh token
  return dbxAuth.getAuthenticationUrl(REDIRECT_URI, undefined, 'code', 'offline', undefined, undefined, false);
}

export async function exchangeCodeForToken(code: string) {
  const dbxAuth = new DropboxAuth({
    clientId: DBX_APP_KEY,
    clientSecret: DBX_APP_SECRET,
  });

  const response = await dbxAuth.getAccessTokenFromCode(REDIRECT_URI, code);
  const result = response.result as any;

  console.log("Token exchange successful!");
  
  // Save tokens
  if (result.access_token) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dropbox_access_token', ?)").run(result.access_token);
  }
  if (result.refresh_token) {
    console.log("GOT REFRESH TOKEN! Saving it securely.");
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dropbox_refresh_token', ?)").run(result.refresh_token);
  }
  
  return true;
}
