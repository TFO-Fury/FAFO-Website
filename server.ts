import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import { existsSync, readFileSync } from "fs";
import dotenv from "dotenv";
import { cert, initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { Octokit } from 'octokit';
import { triggerLicenseSync, removeKeyFromGithub } from './api/_lib/github.js';

// Load config using readFileSync for better reliability in production
const firebaseConfig = JSON.parse(
  readFileSync(new URL("./firebase-applet-config.json", import.meta.url), "utf-8")
);

dotenv.config();

let db: Firestore | null = null;
const serviceAccountPath = new URL("./firebase-service-account.json", import.meta.url);
const firebaseProjectId = firebaseConfig.projectId;
const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId;

function readServiceAccount() {
  if (!existsSync(serviceAccountPath)) {
    throw new Error(
      'Missing firebase-service-account.json in the project root. Download the Firebase Admin SDK private key JSON and place it next to server.ts.'
    );
  }

  return JSON.parse(readFileSync(serviceAccountPath, "utf-8"));
}

async function getDb() {
  if (!db) {
    try {
      const apps = getApps();
      if (apps.length === 0) {
        console.log(`[Firebase] Initializing Admin SDK with Project ID: ${firebaseProjectId}`);
        
        initializeApp({
          credential: cert(readServiceAccount()),
          projectId: firebaseProjectId,
        });
      }
      
      const firebaseApp = getApp();
      
      // Select the correct database instance.
      if (firestoreDatabaseId && firestoreDatabaseId !== '(default)' && firestoreDatabaseId !== firebaseProjectId) {
        console.log(`[Firebase] Connecting to Named Database Instance: "${firestoreDatabaseId}" in Project: "${firebaseProjectId}"`);
        db = getFirestore(firebaseApp, firestoreDatabaseId);
      } else {
        console.log(`[Firebase] Connecting to Default Database Instance in Project: "${firebaseProjectId}"`);
        db = getFirestore(firebaseApp);
      }

      // Verify connection immediately
      try {
        console.log(`[Firebase] Running ping check on collection "_health"...`);
        const pingSnap = await db.collection('_health').doc('ping').get();
        console.log(`[Firebase] Connection check successful. Snapshot exists: ${pingSnap.exists}`);
      } catch (err: any) {
        console.error(`[Firebase] Initial connection check failed: ${err.message} (Code: ${err.code})`);
        if (err.message.includes('NOT_FOUND')) {
          console.error("[Firebase] TIP: If the database is not found, check if the databaseId in config matches the instance name in Firebase console.");
        }
      }

    } catch (err) {
      console.error("[Firebase] Admin Initialization Failure:", err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Firestore unavailable: ${msg}`);
    }
  }
  return db;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Global logger for all requests - Extremely Verbose for Custom Domain Debugging
  app.use((req, res, next) => {
    const isApi = req.path.startsWith('/api');
    if (isApi || process.env.NODE_ENV !== 'production') {
      console.log(`[Req] ${req.method} ${req.originalUrl} | Host: ${req.get('host')} | Protocol: ${req.protocol}`);
    }
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

  // --- API Router ---
  const apiRouter = express.Router();
  const SERVER_ID = nanoid();

  // Prevent caching of API responses
  apiRouter.use((req, res, next) => {
    console.log(`[API HIT] ${req.method} ${req.originalUrl}`);
    res.setHeader("X-FAFO-Backend", "Express-Online");
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Simple test route to verify API availability
  apiRouter.get("/test-connection", (req, res) => {
    res.json({ 
      ok: true, 
      message: "API is reachable", 
      serverId: SERVER_ID
    });
  });

  apiRouter.get("/health", (req, res) => {
    res.json({ 
      status: "healthy", 
      serverId: SERVER_ID,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      detectedUrl: getAppUrl(req)
    });
  });

  apiRouter.get("/server-id", (req, res) => {
    res.json({
      online: true,
      serverId: SERVER_ID,
      timestamp: new Date().toISOString(),
    });
  });

  apiRouter.get("/firebase-health", async (req, res) => {
    try {
      const firestore = await getDb();
      // Try a simple list operation to verify permissions
      const collections = await firestore.listCollections();
      res.json({ 
        ok: true, 
        collections: collections.map(c => c.id),
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId
      });
    } catch (err: any) {
      console.error("[Firebase Health Check Failed]", err);
      res.status(500).json({ 
        ok: false, 
        error: err.message,
        code: err.code,
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId
      });
    }
  });

  apiRouter.get("/auth/discord/url", (req, res) => {
    try {
      const { userId, roleType } = req.query;
      const currentAppUrl = getAppUrl(req);
      
      console.log(`[Discord] URL Request. User: ${userId} | Role: ${roleType} | App: ${currentAppUrl}`);
      
      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.status(500).json({ error: "Discord credentials missing on server." });
      }

      if (!userId) return res.status(400).json({ error: "userId required" });

      const redirectUri = `${currentAppUrl}/auth/discord/callback`;

      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify guilds.join",
        state: `${userId}:${roleType || 'one-class'}`
      });

      const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
      console.log(`[Discord] Success - Generated URL: ${url.substring(0, 50)}...`);
      
      res.json({ url, redirectUri }); 
    } catch (err: any) {
      console.error("[Discord] Critical Error generating URL:", err);
      res.status(500).json({ error: "Internal server error generating Discord URL: " + err.message });
    }
  });

  apiRouter.post("/payment/simulate", (req, res) => {
    console.log(`[API] Payment simulation: ${req.body?.userId}`);
    res.json({ success: true });
  });

  apiRouter.post("/admin/user/sync-roles", async (req, res) => {
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

  apiRouter.post("/keys/activate", async (req, res) => {
    const { key, userId, plan: reqPlan, className: reqClassName } = req.body;
    console.log(`[API] Activate Key Request: ${key} for user ${userId} (reqPlan: ${reqPlan || '(none)'}, className: ${reqClassName || '(none)'})`);

    if (!key || !userId) {
      console.warn("[API] Missing key or userId in activation request");
      return res.status(400).json({ error: "Key and userId required" });
    }

    try {
      const firestore = await getDb();
      const keyRef = firestore.collection('cd_keys').doc(key);
      const keySnap = await keyRef.get();

      // Read existing user metadata FIRST to preserve entitlements
      const userDoc = await firestore.collection('users').doc(userId).get();
      const existingUserData = userDoc.exists ? userDoc.data() : null;

      // Normalize old schema into new entitlements
      const { normalizeEntitlements, calculateStackedExpiration, timestampToDate } = await import('./api/_lib/entitlements.js');
      const normalized = normalizeEntitlements(existingUserData);
      console.log(`[API] Normalized entitlements before activation: plan=${normalized.plan}, classes=[${Object.keys(normalized.classEntitlements).join(', ')}], aio=${normalized.aioExpires ? 'yes' : 'no'}`);

      // Determine plan: explicit request > existing normalized plan > default 'none'
      const plan = reqPlan || normalized.plan;
      console.log(`[API] Plan resolution: existing=${normalized.plan}, req=${reqPlan || '(none)'}, resolved=${plan}`);

      const days = plan === 'trial' ? 3 : 30;

      // Stacked expiration: MAX(current, now) + duration
      const prevAioExp = timestampToDate(existingUserData?.aioExpires);
      const aioExpirationDate = calculateStackedExpiration(existingUserData?.aioExpires, days);
      const aioExpirationTimestamp = Timestamp.fromDate(aioExpirationDate);

      const prevReqClassExp = timestampToDate(normalized.classEntitlements[reqClassName]?.expires);
      const reqClassExpirationDate = calculateStackedExpiration(normalized.classEntitlements[reqClassName]?.expires, days);
      const reqClassExpirationTimestamp = Timestamp.fromDate(reqClassExpirationDate);

      const existingSingleClass = Object.keys(normalized.classEntitlements).length === 1
        ? Object.keys(normalized.classEntitlements)[0]
        : null;
      const prevSingleClassExp = timestampToDate(existingSingleClass ? normalized.classEntitlements[existingSingleClass]?.expires : null);
      const singleClassExpirationDate = calculateStackedExpiration(
        existingSingleClass ? normalized.classEntitlements[existingSingleClass]?.expires : null,
        days
      );
      const singleClassExpirationTimestamp = Timestamp.fromDate(singleClassExpirationDate);

      console.log(`[API] Processing key ${key}. Exists: ${keySnap.exists}. duration=${days}d, prevAio=${prevAioExp?.toISOString() || 'none'}, prevReqClass=${prevReqClassExp?.toISOString() || 'none'}, prevSingleClass=${prevSingleClassExp?.toISOString() || 'none'}, now=${new Date().toISOString()}, newAio=${aioExpirationDate.toISOString()}, newReqClass=${reqClassExpirationDate.toISOString()}, newSingleClass=${singleClassExpirationDate.toISOString()}`);

      const batch = firestore.batch();

      if (keySnap.exists) {
        const keyData = keySnap.data();
        console.log(`[API] Existing key data:`, keyData);

        if (keyData?.userId && keyData.userId !== userId) {
          console.warn(`[API] Key ${key} owned by ${keyData.userId}, but user ${userId} tried to activate it`);
          return res.status(400).json({ error: "Key already used by another user" });
        }
        if (keyData?.status === 'inactive') {
          console.warn(`[API] Deactivated key ${key} attempted by user ${userId}`);
          return res.status(400).json({ error: "This key has been deactivated by an admin" });
        }

        batch.update(keyRef, {
          userId,
          status: 'active',
          lastUsedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...(reqClassName ? { className: reqClassName } : {})
        });
      } else {
        console.log(`[API] Creating new key record for ${key}`);
        batch.set(keyRef, {
          key,
          userId,
          plan,
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
          lastUsedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: (plan === 'single' && reqClassName ? reqClassExpirationTimestamp : plan === 'single' && existingSingleClass ? singleClassExpirationTimestamp : aioExpirationTimestamp),
          ...(reqClassName ? { className: reqClassName } : {})
        });
      }

      const userRef = firestore.collection('users').doc(userId);

      if (plan === 'aio' || plan === 'trial') {
        batch.set(userRef, {
          plan,
          accountStatus: 'active',
          isAio: true,
          aioExpires: aioExpirationTimestamp,
          updatedAt: FieldValue.serverTimestamp(),
          // AIO fully replaces single-class entitlements
          classEntitlements: FieldValue.delete(),
          ...(normalized.migrated || existingUserData?.selectedClass ? { selectedClass: FieldValue.delete() } : {})
        }, { merge: true });
        console.log(`[API] AIO/Trial activation: stacked aioExpires=${aioExpirationDate.toISOString()}, cleared classEntitlements`);
      } else if (plan === 'single' && reqClassName) {
        const classEntitlements = {
          ...normalized.classEntitlements,
          [reqClassName]: {
            expires: reqClassExpirationTimestamp,
            updatedAt: FieldValue.serverTimestamp()
          }
        };
        batch.set(userRef, {
          plan: 'single',
          accountStatus: 'active',
          isAio: false,
          classEntitlements,
          updatedAt: FieldValue.serverTimestamp(),
          ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
        }, { merge: true });
        console.log(`[API] Single-class activation: stacked class=${reqClassName}, expires=${reqClassExpirationDate.toISOString()}, totalClasses=${Object.keys(classEntitlements).length}`);
      } else if (plan === 'single' && existingSingleClass) {
        const classEntitlements = {
          ...normalized.classEntitlements,
          [existingSingleClass]: {
            expires: singleClassExpirationTimestamp,
            updatedAt: FieldValue.serverTimestamp()
          }
        };
        batch.set(userRef, {
          plan: 'single',
          accountStatus: 'active',
          isAio: false,
          classEntitlements,
          updatedAt: FieldValue.serverTimestamp(),
          ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
        }, { merge: true });
        console.log(`[API] Single-class renewal: stacked class=${existingSingleClass}, expires=${singleClassExpirationDate.toISOString()}`);
      } else {
        batch.set(userRef, {
          plan,
          accountStatus: 'active',
          isAio: plan === 'aio',
          expiresAt: aioExpirationTimestamp,
          updatedAt: FieldValue.serverTimestamp(),
          ...(normalized.migrated ? { selectedClass: FieldValue.delete() } : {})
        }, { merge: true });
        console.log(`[API] Generic activation: plan=${plan}, stacked expiresAt=${aioExpirationDate.toISOString()}`);
      }

      await batch.commit();
      console.log(`[API] Activation committed. userId=${userId}, plan=${plan}, className=${reqClassName || '(none)'}`);

      // Verify key is readable before GitHub sync
      console.log(`[API] Verifying key ${key} is readable in Firestore...`);
      const keyVerify = await firestore.collection('cd_keys').doc(key).get();
      console.log(`[API] Post-commit key read: exists=${keyVerify.exists}, id=${keyVerify.id}, data=${JSON.stringify(keyVerify.data())}`);

      syncDiscord(userId, plan).catch(err => console.error("[Discord Sync Error]", err));

      let githubResult;
      let githubSyncFailed = false;
      try {
        githubResult = await triggerLicenseSync(userId, 'legacy-activation', key);
      } catch (syncErr: any) {
        console.error(`[LicenseSync] CRITICAL: triggerLicenseSync threw unexpectedly. This should never happen. Error:`, syncErr);
        githubResult = { success: false, error: syncErr.message || 'Unexpected GitHub sync crash' };
        githubSyncFailed = true;
      }

      res.json({
        success: true,
        activationSuccess: true,
        githubSyncFailed,
        githubSync: githubResult || { success: false, error: 'No result' },
        plan,
        expiresAt: (plan === 'single' && reqClassName ? reqClassExpirationDate : plan === 'single' && existingSingleClass ? singleClassExpirationDate : aioExpirationDate).toISOString(),
        className: reqClassName || null
      });
    } catch (err: any) {
      console.error("[Activation Error]", err);
      res.status(500).json({ error: "Server error during activation: " + err.message });
    }
  });

  apiRouter.post("/keys/deactivate", async (req, res) => {
    const { keyId } = req.body;
    try {
      const firestore = await getDb();
      const keyDoc = await firestore.collection('cd_keys').doc(keyId).get();
      const previousUserId = keyDoc.exists ? keyDoc.data()?.userId : null;

      await firestore.collection('cd_keys').doc(keyId).update({
        status: 'inactive',
        updatedAt: FieldValue.serverTimestamp()
      });

      removeKeyFromGithub(keyId).then(result => {
        console.log(`[GitHubSync] Deactivation trigger result:`, result);
      }).catch(err => console.error('[GitHubSync] Deactivation trigger error:', err));

      // Re-sync remaining entitlements for the user whose key was deactivated
      if (previousUserId) {
        triggerLicenseSync(previousUserId, 'legacy-deactivation').then(result => {
          console.log(`[LicenseSync] Post-deactivation sync result:`, result);
        }).catch(err => console.error('[LicenseSync] Post-deactivation sync error:', err));
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("[Deactivation Error]", err);
      res.status(500).json({ error: "Server error during deactivation: " + err.message });
    }
  });

  // Mount API Router
  app.use("/api", apiRouter);

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

  // Top level ping
  app.get("/ping", (req, res) => res.send("pong"));

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
