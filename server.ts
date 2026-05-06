import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { Octokit } from 'octokit';

import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };

dotenv.config();

let db: admin.firestore.Firestore | null = null;

async function getDb() {
  if (!db) {
    try {
      if (getApps().length === 0) {
        initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      // Use the specific databaseId from config
      db = getFirestore(firebaseConfig.firestoreDatabaseId);
    } catch (err) {
      console.error("Firebase Admin Init Error:", err);
      throw new Error("Backend storage unavailable");
    }
  }
  return db;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Global logger for all requests
  app.use((req, res, next) => {
    console.log(`[Req] ${req.method} ${req.url}`);
    next();
  });

  console.log(`[Server] Booting at ${new Date().toISOString()}`);
  console.log(` - NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(` - DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ? 'SET' : 'MISSING'}`);
  console.log(` - DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'SET' : 'MISSING'}`);
  console.log(` - APP_URL: ${process.env.APP_URL || 'AUTO-DETECT'}`);

  // Discord OAuth Configuration
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  
  // Robust APP_URL detection
  const getAppUrl = (req?: express.Request) => {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    if (req) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host');
      return `${protocol}://${host}`;
    }
    return `http://localhost:${PORT}`;
  };

  // --- Diagnostic Middleware ---
  app.use((req, res, next) => {
    // Log every single request to help identify routing issues on custom domains
    console.log(`[Diagnostic] ${req.method} ${req.originalUrl} - Host: ${req.get('host')} - Origin: ${req.get('origin')}`);
    next();
  });

  // --- API Routes ---

  // Simple test route to verify API availability
  app.get("/api/test-connection", (req, res) => {
    res.json({ 
      ok: true, 
      message: "API is reachable", 
      host: req.get('host'),
      env: process.env.NODE_ENV 
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      detectedUrl: getAppUrl(req)
    });
  });

  app.get("/api/auth/discord/url", (req, res) => {
    const { userId, roleType } = req.query;
    const currentAppUrl = getAppUrl(req);
    
    console.log(`[Discord] URL Request for user ${userId}. App URL: ${currentAppUrl}`);
    
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      return res.status(500).json({ error: "Discord credentials missing." });
    }

    if (!userId) return res.status(400).json({ error: "userId required" });

    const redirectUri = `${currentAppUrl}/auth/discord/callback`;

    console.log(`[Discord] Generated redirectUri: ${redirectUri}`);

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.join",
      state: `${userId}:${roleType || 'one-class'}`
    });

    res.json({ 
      url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
      redirectUri 
    }); 
  });

  app.post("/api/payment/simulate", (req, res) => {
    console.log(`[API] Payment simulation: ${req.body?.userId}`);
    res.json({ success: true });
  });

  app.post("/api/admin/user/sync-roles", async (req, res) => {
    const { userId } = req.body;
    try {
      const firestore = await getDb();
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
      await syncDiscord(userId, userDoc.data()?.plan || 'none');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Sync failed" });
    }
  });

  app.post("/api/keys/activate", async (req, res) => {
    const { key, userId, plan = 'aio' } = req.body;
    if (!key || !userId) return res.status(400).json({ error: "Key and userId required" });

    try {
      const firestore = await getDb();
      const keyRef = firestore.collection('cd_keys').doc(key);
      const keySnap = await keyRef.get();

      // Determine expiry based on plan
      const days = plan === 'trial' ? 3 : 30;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + days);

      const batch = firestore.batch();

      if (keySnap.exists) {
        const keyData = keySnap.data();
        if (keyData?.userId && keyData.userId !== userId) {
          return res.status(400).json({ error: "Key already used by another user" });
        }
        if (keyData?.status === 'inactive') {
          return res.status(400).json({ error: "This key has been deactivated by an admin" });
        }
        
        batch.update(keyRef, {
          userId,
          status: 'active',
          lastUsedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      } else {
        // Create new key entry for the user-provided game license
        batch.set(keyRef, {
          key,
          userId,
          plan,
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
          lastUsedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      // Update user status and expiry
      const userRef = firestore.collection('users').doc(userId);
      batch.set(userRef, {
        plan,
        accountStatus: 'active',
        expiresAt: expirationDate,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      await batch.commit();

      // Sync Discord in background
      syncDiscord(userId, plan).catch(console.error);

      res.json({ success: true, plan, expiresAt: expirationDate });
    } catch (err: any) {
      console.error("[Activation Error]", err);
      res.status(500).json({ error: "Activation failed: " + err.message });
    }
  });

  // Catch-all for any other /api/* routes to avoid HTML responses
  app.all("/api/*", (req, res) => {
    console.warn(`[API 404] No match for: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      error: `Resource not found: ${req.method} ${req.path}`,
      suggested: "Check if the path is correct and your server is running the latest version.",
      debug: {
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
        host: req.get('host')
      },
      timestamp: new Date().toISOString()
    });
  });

  // --- Synchronization Helpers ---
  
  async function syncDiscord(userId: string, plan: string) {
    const firestore = await getDb();
    const userDoc = await firestore.collection('users').doc(userId).get();
    if (!userDoc.exists) return;
    
    const userData = userDoc.data();
    const discordId = userData?.discordId;
    if (!discordId) return;

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!botToken || !guildId) return;

    let roleId = null;
    if (plan === 'aio') roleId = process.env.DISCORD_ROLE_AIO;
    else if (plan === 'single') roleId = process.env.DISCORD_ROLE_ONE_CLASS;
    else if (plan === 'trial') roleId = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';
    
    if (roleId) {
      try {
        await fetch(`https://discord.com/api/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
          method: 'PUT',
          headers: { 
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json'
          },
        });
        console.log(`[Sync] Assigned role ${roleId} to Discord user ${discordId}`);
      } catch (err) {
        console.error(`[Sync] Failed to assign role:`, err);
      }
    }
  }

  async function syncGitHub(userId: string) {
    const ghToken = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const path = process.env.GITHUB_FILE_PATH || 'licensing/users.lua';

    if (!ghToken || !owner || !repo) {
      console.log("[Sync] GitHub credentials missing, skipping file update.");
      return;
    }

    try {
      const firestore = await getDb();
      const usersSnap = await firestore.collection('users').where('accountStatus', '==', 'active').get();
      let luaContent = "-- Generated License File\nlocal licenses = {\n";
      
      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.plan !== 'none') {
          luaContent += `  ["${doc.id}"] = { plan = "${data.plan}", expires = ${data.expiresAt?.seconds || 0} },\n`;
        }
      });
      luaContent += "}\nreturn licenses";

      const octokit = new Octokit({ auth: ghToken });
      
      // Get current file sha
      let sha: string | undefined;
      try {
        const { data: fileData } = await octokit.rest.repos.getContent({ owner, repo, path });
        if (!Array.isArray(fileData)) sha = fileData.sha;
      } catch (e) {}

      await octokit.rest.repos.createOrUpdateFileContents({
        owner, repo, path,
        message: `Sync licenses - User ${userId}`,
        content: Buffer.from(luaContent).toString('base64'),
        sha
      });
      console.log(`[Sync] Updated GitHub license file.`);
    } catch (err) {
      console.error(`[Sync] GitHub error:`, err);
    }
  }

  // API: OAuth Internal Callback Handler
  app.get(["/auth/discord/callback", "/auth/discord/callback/"], async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error("Discord Auth Error from Callback:", { error, error_description });
      return res.status(400).send(`Discord Error: ${error_description || error}`);
    }

    if (!code) {
      return res.status(400).send("No code provided by Discord. Did you cancel the authorization?");
    }

    try {
      const stateStr = state as string;
      if (!stateStr || !stateStr.includes(':')) {
        console.error("Discord Auth Error: Invalid state parameter.", { state });
        return res.status(400).send(`Invalid auth state. This can happen if you stayed too long on the Discord page. Please try again.`);
      }

      const [userId, roleType] = stateStr.split(':');
      const currentAppUrl = getAppUrl(req);
      console.log(`[Discord] Processing callback. User: ${userId}, Role: ${roleType}, App URL: ${currentAppUrl}`);

      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        throw new Error("Discord client configuration missing in environment. Contact Admin.");
      }

      const redirectUri = `${currentAppUrl}/auth/discord/callback`;
      
      console.log(`[Discord] Token Exchange. Redirect URI: ${redirectUri}`);

      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        console.error("[Discord] Token Exchange Failed:", { 
          status: tokenResponse.status, 
          error: errorData 
        });
        throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error || 'Unknown error'}`);
      }

      const tokenData = await tokenResponse.json();
      const access_token = tokenData.access_token;

      // 2. Get User Profile
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      
      if (!userResponse.ok) {
        throw new Error(`Failed to fetch Discord profile (${userResponse.status})`);
      }

      const discordUser = await userResponse.json();
      const discordUserId = discordUser.id;
      console.log(`[Discord] Profile fetched: ${discordUser.username} (${discordUserId})`);

      // 3. Store Discord ID in Firestore (Admin Override)
      if (userId && userId !== 'undefined') {
        try {
          const firestore = await getDb();
          await firestore.collection('users').doc(userId).set({
            discordId: discordUserId,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          console.log(`[Discord] Saved link to Firestore for ${userId}`);
        } catch (err) {
          console.error(`[Discord] Firestore update error:`, err);
        }
      }

      // 4. Assign Role using Bot Token
      const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
      const DISCORD_ROLE_ONE_CLASS = process.env.DISCORD_ROLE_ONE_CLASS;
      const DISCORD_ROLE_AIO = process.env.DISCORD_ROLE_AIO;

      if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        const rolesToAssign = (roleType || '').split(',');
        
        for (const type of rolesToAssign) {
          let roleId = null;
          if (type === 'aio') roleId = DISCORD_ROLE_AIO;
          else if (type === 'one-class') roleId = DISCORD_ROLE_ONE_CLASS;
          else if (type === 'trial') roleId = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';
          
          if (roleId) {
            try {
              await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, {
                method: 'PUT',
                headers: { 
                  Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                  'Content-Type': 'application/json'
                },
              });
              console.log(`Successfully assigned role ${roleId} (${type}) to user ${discordUserId}`);
            } catch (err) {
              console.error(`Failed to assign role ${roleId}:`, err);
            }
          }
        }
      }

      // --- Success Response ---
      res.send(`
        <html>
          <head><title>Success</title></head>
          <body style="background: #10131a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden;">
            <div style="text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 32px; background: #1a1d23; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
              <div style="width: 64px; height: 64px; background: #ec5b13; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; box-shadow: 0 0 20px rgba(236, 91, 19, 0.3);">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 900; margin-bottom: 8px; letter-spacing: -0.02em;">Account Linked</h1>
              <p style="opacity: 0.5; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">Your Discord account has been connected and roles have been updated.</p>
              <p style="font-size: 11px; font-weight: 900; color: #ec5b13; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8;">Window closing automatically...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'DISCORD_AUTH_SUCCESS', discordId: '${discordUserId}' }, '*');
                  setTimeout(() => window.close(), 3000);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Discord Auth Error:", error);
      res.status(500).send(`Discord authentication failed: ${error.message}. Please check your Discord Developer Portal settings (specifically the Redirect URI).`);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Wait: Checking production URL...`);
    console.log(`Callback URL template: ${getAppUrl()}/auth/discord/callback`);
  });
}

startServer();
