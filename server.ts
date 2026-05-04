import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Discord OAuth Configuration
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

  // API: Get Discord Auth URL
  app.get("/api/auth/discord/url", (req, res) => {
    if (!DISCORD_CLIENT_ID) {
      return res.status(500).json({ error: "DISCORD_CLIENT_ID not configured" });
    }

    const { roleType } = req.query;

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: `${APP_URL}/auth/discord/callback`,
      response_type: "code",
      scope: "identify guilds.join",
      state: String(roleType || 'one-class')
    });

    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    res.json({ url });
  });

  // API: OAuth Internal Callback Handler
  app.get(["/auth/discord/callback", "/auth/discord/callback/"], async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("No code provided.");
    }

    try {
      // 1. Exchange code for access token
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID!,
          client_secret: DISCORD_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: `${APP_URL}/auth/discord/callback`,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
      }

      const { access_token } = await tokenResponse.json();

      // 2. Get User ID
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const userData = await userResponse.json();
      const userId = userData.id;

      // 3. Assign Role using Bot Token
      const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
      const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
      const DISCORD_ROLE_ONE_CLASS = process.env.DISCORD_ROLE_ONE_CLASS;
      const DISCORD_ROLE_AIO = process.env.DISCORD_ROLE_AIO;

      if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        const rolesToAssign = (state as string || '').split(',');
        
        for (const type of rolesToAssign) {
          const roleId = type === 'aio' ? DISCORD_ROLE_AIO : (type === 'one-class' ? DISCORD_ROLE_ONE_CLASS : null);
          
          if (roleId) {
            try {
              await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, {
                method: 'PUT',
                headers: { 
                  Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                  'Content-Type': 'application/json'
                },
              });
              console.log(`Successfully assigned role ${roleId} (${type}) to user ${userId}`);
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
              <h1 style="color: #ec5b13; margin-bottom: 10px;">Role Assigned!</h1>
              <p style="opacity: 0.6; line-height: 1.5;">Your Discord role has been updated. You can now close this window.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'DISCORD_AUTH_SUCCESS' }, '*');
                  setTimeout(() => window.close(), 3000);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Discord Auth Error:", error);
      res.status(500).send("Discord authentication failed. Check server logs.");
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
