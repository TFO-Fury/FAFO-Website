import express from "express";
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

  app.use(express.json());

  console.log("[Server] Starting with environment:");
  console.log(` - NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(` - DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ? 'SET' : 'MISSING'}`);
  console.log(` - DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? 'SET' : 'MISSING'}`);
  console.log(` - APP_URL: ${process.env.APP_URL || 'AUTO-DETECT'}`);

  // Discord OAuth Configuration
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  let APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
  
  // Normalize APP_URL: remove trailing slash if exists
  if (APP_URL.endsWith('/')) {
    APP_URL = APP_URL.slice(0, -1);
  }

  // --- Diagnostic & Health ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // API: Get Discord Auth URL (Moved up for priority and logging)
  app.get("/api/auth/discord/url", (req, res) => {
    console.log("[Discord] URL Request received");
    
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      const error = "Discord OAuth credentials (ID/SECRET) are not configured in the server environment secrets.";
      console.error("[Discord] Logic Error:", error);
      return res.status(500).json({ error });
    }

    const { roleType, userId } = req.query;
    if (!userId) {
      console.error("[Discord] Request Error: userId missing from query");
      return res.status(400).json({ error: "userId is required" });
    }

    // Dynamic APP_URL detection
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    
    // Safety: ensure we don't have double protocols
    const cleanHost = host?.replace(/^https?:\/\//, '');
    
    // Prefer the current host unless APP_URL is explicitly set to a non-localhost production URL
    const detectedAppUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost') && !process.env.APP_URL.includes('.run.app')) 
      ? APP_URL 
      : `${protocol}://${cleanHost}`;

    const redirectUri = `${detectedAppUrl}/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.join",
      state: `${userId}:${roleType || 'one-class'}`
    });

    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    console.log(`[Discord] GENERATED AUTH URL`);
    console.log(` - Host: ${host}`);
    console.log(` - Redirect URI: ${redirectUri} (CRITICAL: THIS MUST BE IN DISCORD DASHBOARD)`);
    console.log(` - State: ${userId}:${roleType}`);
    
    res.json({ url, redirectUri }); // Return redirectUri so UI can show it if error
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

  // --- Administrative Support ---

  // Admin: Sync user roles
  app.post("/api/admin/user/sync-roles", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    
    try {
      const firestore = await getDb();
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
      
      const userData = userDoc.data();
      const plan = userData?.plan || 'none';
      
      await syncDiscord(userId, plan);
      res.json({ success: true });
    } catch (err) {
      console.error("Sync Roles Error:", err);
      res.status(500).json({ error: "Failed to sync roles" });
    }
  });

  // API: Simulate Payment
  app.post("/api/payment/simulate", async (req, res) => {
    const { userId, plan, amount } = req.body;
    
    if (!userId || !plan) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      res.json({ success: true });
    } catch (error) {
      console.error("Payment Sync Error (Server):", error);
      res.json({ success: true });
    }
  });

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
      console.log(`[Discord] Processing callback. User: ${userId}, Role: ${roleType}`);

      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        throw new Error("Discord client configuration missing in environment. Contact Admin.");
      }

      // Exact same detection logic as the URL generator
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const detectedAppUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost') && !process.env.APP_URL.includes('.run.app')) 
        ? APP_URL 
        : `${protocol}://${host}`;

      const redirectUri = `${detectedAppUrl}/auth/discord/callback`;
      console.log(`[Discord] Token Exchange. Host: ${host}, Redirect URI: ${redirectUri}`);

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
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
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

      // Send success message to parent window and close popup
      res.send(`
        <html>
          <body style="background: #10131a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 24px; background: #1d2026; max-width: 400px;">
              <h1 style="color: #ec5b13; margin-bottom: 10px;">Account Linked!</h1>
              <p style="opacity: 0.6; line-height: 1.5;">Your Discord account is connected and roles have been updated.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ 
                    type: 'DISCORD_AUTH_SUCCESS', 
                    discordId: '${discordUserId}' 
                  }, '*');
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
    console.log(`Callback URL: ${APP_URL}/auth/discord/callback`);
  });
}

startServer();
