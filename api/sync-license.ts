import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJsonBody } from './_lib/body.js';
import { triggerLicenseSync } from './_lib/github.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { userId } = body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  console.log(`[LicenseSync] Frontend request received for userId=${userId}`);

  const result = await triggerLicenseSync(userId, 'frontend-mutation');

  return res.status(200).json({
    success: result.success,
    githubSync: result
  });
}
