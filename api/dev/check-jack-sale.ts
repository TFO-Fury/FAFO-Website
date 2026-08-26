import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSaleDetails } from '../_lib/paypal.js';

const SALE_ID = '6GJ95762UY252253F';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const sale = await getSaleDetails(SALE_ID);
    return res.status(200).json(sale);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
