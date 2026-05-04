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

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: `${APP_URL}/auth/discord/callback`,
      response_type: "code",
      scope: "identify guilds.join", // Basic scopes for identity and adding them to server
    });

    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    res.json({ url });
  });

  // API: OAuth Internal Callback Handler
  app.get(["/auth/discord/callback", "/auth/discord/callback/"], async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.send("No code provided.");
    }

    // In a real app, you would exchange the code here:
    // const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { ... });
    // const tokens = await tokenResponse.json();
    // Then use a Discord Bot token to assign the role via:
    // PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}

    console.log("Simulating Discord Role Assignment for code:", code);

    // Send success message to parent window and close popup
    res.send(`
      <html>
        <body style="background: #10131a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 24px; background: #1d2026;">
            <h1 style="color: #ec5b13; margin-bottom: 10px;">Account Linked!</h1>
            <p style="opacity: 0.6;">Your Discord roles are being synchronized...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'DISCORD_AUTH_SUCCESS' }, '*');
                setTimeout(() => window.close(), 2000);
              } else {
                window.location.href = '/';
              }
            </script>
          </div>
        </body>
      </html>
    `);
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
