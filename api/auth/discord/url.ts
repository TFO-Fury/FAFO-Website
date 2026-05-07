import type { VercelRequest, VercelResponse } from '@vercel/node';

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getAppUrl(req: VercelRequest) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');

  const protocol = getHeaderValue(req.headers['x-forwarded-proto']) || 'https';
  const host = getHeaderValue(req.headers['x-forwarded-host']) || req.headers.host;

  return `${protocol}://${host}`;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = getHeaderValue(req.query.userId);
    const roleType = getHeaderValue(req.query.roleType);
    const currentAppUrl = getAppUrl(req);
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

    console.log(`[Discord] URL Request. User: ${userId} | Role: ${roleType} | App: ${currentAppUrl}`);

    if (!discordClientId || !discordClientSecret) {
      return res.status(500).json({ error: 'Discord credentials missing on server.' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const redirectUri = `${currentAppUrl}/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: discordClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.join',
      state: `${userId}:${roleType || 'one-class'}`,
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