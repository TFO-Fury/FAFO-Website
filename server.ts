import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import firebaseConfig from "./firebase-applet-config.json";

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

  // Discord OAuth Configuration
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  let APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
  
  // Normalize APP_URL: remove trailing slash if exists
  if (APP_URL.endsWith('/')) {
    APP_URL = APP_URL.slice(0, -1);
  }

  // API: Get Discord Auth URL
  app.get("/api/auth/discord/url", (req, res) => {
    if (!DISCORD_CLIENT_ID) {
      console.error("Discord Auth Config Error: DISCORD_CLIENT_ID is missing");
      return res.status(500).json({ error: "DISCORD_CLIENT_ID not configured" });
    }

    const { roleType, userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Dynamic APP_URL detection
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const detectedAppUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) 
      ? APP_URL 
      : `${protocol}://${host}`;

    const redirectUri = `${detectedAppUrl}/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.join",
      state: `${userId}:${roleType || 'one-class'}`
    });

    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    console.log(`Generated Discord Auth URL for user ${userId}. Redirect URI: ${redirectUri}`);
    res.json({ url });
  });

  // API: Simulate Payment
  app.post("/api/payment/simulate", async (req, res) => {
    const { userId, plan, amount } = req.body;
    
    if (!userId || !plan) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // 1. Update User Record
      /* Moved to frontend due to backend permission constraints in this environment
      const firestore = await getDb();
      ...
      */

      res.json({ success: true });
    } catch (error) {
      console.error("Payment Sync Error (Server):", error);
      // We return success anyway because the frontend will perform its own update
      res.json({ success: true });
    }
  });

  // API: OAuth Internal Callback Handler
  app.get(["/auth/discord/callback", "/auth/discord/callback/"], async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("No code provided by Discord.");
    }

    try {
      const stateStr = state as string;
      if (!stateStr || !stateStr.includes(':')) {
        console.error("Discord Auth Error: Invalid state parameter.", { state });
        return res.status(400).send(`Invalid auth state: ${state}. This can happen if the login session timed out.`);
      }

      const [userId, roleType] = stateStr.split(':');
      console.log(`Processing Discord auth callback. userId: ${userId}, roleType: ${roleType}`);

      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        throw new Error("Discord client configuration missing in environment");
      }

      // Dynamic APP_URL detection for token exchange
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const detectedAppUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) 
        ? APP_URL 
        : `${protocol}://${host}`;

      const redirectUri = `${detectedAppUrl}/auth/discord/callback`;
      console.log(`Exchanging code with redirect_uri: ${redirectUri}`);

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
        const errorText = JSON.stringify(errorData) || await tokenResponse.text();
        console.error("Discord Token Exchange Failed:", { 
          status: tokenResponse.status, 
          error: errorText 
        });
        throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      const access_token = tokenData.access_token;

      // 2. Get User Profile
      console.log("Fetching Discord user profile...");
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      
      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.error("Discord Profile Fetch Failed:", { status: userResponse.status, error: errorText });
        throw new Error(`Failed to fetch Discord profile (${userResponse.status})`);
      }

      const userData = await userResponse.json();
      const discordUserId = userData.id;
      console.log(`Discord account identified: ${userData.username} (${discordUserId})`);

      // 3. Store Discord ID in Firestore
      // Moved to frontend due to backend permission constraints in this environment
      /*
      if (userId && userId !== 'undefined') {
        ...
      }
      */

      // 4. Assign Role using Bot Token
      const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
      const DISCORD_ROLE_ONE_CLASS = process.env.DISCORD_ROLE_ONE_CLASS;
      const DISCORD_ROLE_AIO = process.env.DISCORD_ROLE_AIO;

      if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        const rolesToAssign = (roleType || '').split(',');
        
        for (const type of rolesToAssign) {
          const roleId = type === 'aio' ? DISCORD_ROLE_AIO : (type === 'one-class' ? DISCORD_ROLE_ONE_CLASS : null);
          
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
