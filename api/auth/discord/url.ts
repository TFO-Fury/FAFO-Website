import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppUrl } from '../../_lib/app-url.js';
import { verifyIdToken } from '../../_lib/auth.js';

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // This used to trust userId as a plain, unauthenticated query param.
    // Anyone could request a link URL for ANY victim's userId, complete it
    // with their own Discord account, and the callback would write their
    // discordId onto the victim's account - then grant the victim's paid
    // role to the attacker's Discord account. userId must now come from a
    // verified ID token, never the query string.
    let decoded;
    try {
      decoded = await verifyIdToken(req);
    } catch (err: any) {
      return res.status(401).json({ error: err.message || 'Unauthorized' });
    }
    const userId = decoded.uid;

    const roleType = getHeaderValue(req.query.roleType);
    const currentAppUrl = getAppUrl(req);
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

    console.log(`[Discord] URL Request. User: ${userId} | Role: ${roleType} | App: ${currentAppUrl}`);

    if (!discordClientId || !discordClientSecret) {
      return res.status(500).json({ error: 'Discord credentials missing on server.' });
    }

    const redirectUri = `${currentAppUrl}/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: discordClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.join',
      // roleType is only used for logging in the callback now - the actual
      // Discord role granted is always computed server-side from real
      // Firestore entitlements, never from this client-supplied value.
      state: `${userId}:${roleType || 'none'}`,
    });

    const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    console.log(`[Discord] Success - Generated URL: ${url.substring(0, 50)}...`);

    return res.status(200).json({ url, redirectUri });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Discord] Critical Error generating URL:', err);
    return res.status(500).json({ error: `Internal server error generating Discord URL: ${message}` });
  }
}