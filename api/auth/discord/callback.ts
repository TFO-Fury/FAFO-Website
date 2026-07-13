import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppUrl } from '../../_lib/app-url.js';
import { getDb, FieldValue } from '../../_lib/firebase-admin.js';

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const code = getHeaderValue(req.query.code);
  const state = getHeaderValue(req.query.state);
  const error = getHeaderValue(req.query.error);
  const error_description = getHeaderValue(req.query.error_description);

  if (error) {
    console.error('Discord Auth Error from Callback:', { error, error_description });
    return res.status(400).send(`Discord Error: ${error_description || error}`);
  }

  if (!code) {
    return res.status(400).send('No code provided by Discord. Did you cancel the authorization?');
  }

  try {
    const stateStr = state as string;
    if (!stateStr || !stateStr.includes(':')) {
      console.error('Discord Auth Error: Invalid state parameter.', { state });
      return res.status(400).send('Invalid auth state. This can happen if you stayed too long on the Discord page. Please try again.');
    }

    const [userId, roleType] = stateStr.split(':');
    const currentAppUrl = getAppUrl(req);
    console.log(`[Discord] Processing callback. User: ${userId}, Role: ${roleType}, App URL: ${currentAppUrl}`);

    const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      throw new Error('Discord client configuration missing in environment. Contact Admin.');
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
      console.error('[Discord] Token Exchange Failed:', {
        status: tokenResponse.status,
        error: errorData,
      });
      throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error || 'Unknown error'}`);
    }

    const tokenData = await tokenResponse.json();
    const access_token = tokenData.access_token;

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userResponse.ok) {
      throw new Error(`Failed to fetch Discord profile (${userResponse.status})`);
    }

    const discordUser = await userResponse.json();
    const discordUserId = discordUser.id;
    console.log(`[Discord] Profile fetched: ${discordUser.username} (${discordUserId})`);

    if (userId && userId !== 'undefined') {
      try {
        const firestore = await getDb();
        await firestore.collection('users').doc(userId).set({
          discordId: discordUserId,
          discordUsername: discordUser.username,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log(`[Discord] Saved link to Firestore for ${userId}`);
      } catch (err) {
        console.error(`[Discord] Firestore update error:`, err);
      }
    }

    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
    const DISCORD_ROLE_ONE_CLASS = process.env.DISCORD_ROLE_ONE_CLASS;
    const DISCORD_ROLE_AIO = process.env.DISCORD_ROLE_AIO;

    if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      const rolesToAssign = (roleType || '').split(',');

      for (const type of rolesToAssign) {
        let roleId: string | null = null;
        if (type === 'aio') roleId = DISCORD_ROLE_AIO || null;
        else if (type === 'one-class') roleId = DISCORD_ROLE_ONE_CLASS || null;
        else if (type === 'trial') roleId = process.env.DISCORD_ROLE_TRIAL || '1501005403641876480';

        if (roleId) {
          try {
            await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, {
              method: 'PUT',
              headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
              },
            });
            console.log(`Successfully assigned role ${roleId} (${type}) to user ${discordUserId}`);
          } catch (err) {
            console.error(`Failed to assign role ${roleId}:`, err);
          }
        }
      }
    }

    const html = `
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
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (error: any) {
    console.error('Discord Auth Error:', error);
    return res.status(500).send(`Discord authentication failed: ${error.message}. Please check your Discord Developer Portal settings (specifically the Redirect URI).`);
  }
}
