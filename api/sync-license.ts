import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from './_lib/body.js';
import { triggerLicenseSync } from './_lib/github.js';
import { requireAdmin } from './_lib/auth.js';

// Simple in-memory rate limiter (per-function-instance, best-effort for serverless)
const requestLog = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const requests = requestLog.get(ip) || [];
  const recent = requests.filter(t => t > windowStart);
  requestLog.set(ip, [...recent, now]);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // Rate limit check
  if (isRateLimited(ip)) {
    console.warn(`[LicenseSync] Rate limit exceeded: ${ip}`);
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Auth: require admin or owner role (handles 401 missing token, 403 non-admin)
  const caller = await requireAdmin(req, res);
  if (!caller) {
    console.warn(`[LicenseSync] Unauthorized sync attempt from ip=${ip}`);
    return;
  }

  const body = await readJsonBody(req);
  const { userId } = body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  console.log(`[LicenseSync] Authorized sync request from caller=${caller.uid} (role=${caller.role}) for userId=${userId}, ip=${ip}`);

  const result = await triggerLicenseSync(userId, 'frontend-mutation');

  return res.status(200).json({
    success: result.success,
    githubSync: result
  });
}
