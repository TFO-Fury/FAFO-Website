import type { VercelRequest, VercelResponse } from '@vercel/node';
import { triggerLicenseSync } from '../_lib/github.js';

const USER_IDS = [
  'uiTZBlksBzb8F9UQdJMS5i2TCOp1', // jamescox19900@gmail.com
  'L8Ghek8JPSe9SGmeF5o7486FISN2', // isekaianime.89@gmail.com
  '5mfgNmouLHgq1baDs2tTlAzsgQz1', // arnaud.blain1@gmail.com
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const results = [];
  for (const userId of USER_IDS) {
    const result = await triggerLicenseSync(userId, 'manual-reconcile');
    results.push({ userId, result });
  }
  return res.status(200).json({ results });
}
