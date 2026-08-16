import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppUrl } from '../../_lib/app-url.js';
import { getDb, FieldValue } from '../../_lib/firebase-admin.js';
import { normalizeEntitlements } from '../../_lib/entitlements.js';
import { syncDiscord } from '../../_lib/discord.js';

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

    if (!userId || userId === 'undefined') {
      throw new Error('Missing user session - please close this window and try linking again from the site.');
    }

    // The Firestore write is the entire point of this callback - if it fails,
    // the customer must NOT see "Account Linked" (previously this was caught
    // and only logged server-side while the success page/postMessage still
    // fired unconditionally, so a customer could see a full success
    // confirmation while nothing was actually saved).
    const firestore = await getDb();
    const userRef = firestore.collection('users').doc(userId);
    await userRef.set({
      discordId: discordUserId,
      discordUsername: discordUser.username,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[Discord] Saved link to Firestore for ${userId}`);

    // Grant whatever Discord role matches the user's ACTUAL entitlements
    // in Firestore. The client-supplied roleType (from the OAuth state
    // param, requested at /api/auth/discord/url) is just a URL query
    // string - anyone could set it to any value ('aio', etc.) with no
    // purchase at all, so it must never be trusted for role decisions.
    const userSnap = await userRef.get();
    const normalized = normalizeEntitlements(userSnap.data());
    const syncResult = await syncDiscord(userId, normalized.plan);
    console.log(`[Discord] Role sync after link for ${userId}: requestedRoleType=${roleType}, actualPlan=${normalized.plan}`, syncResult);

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
