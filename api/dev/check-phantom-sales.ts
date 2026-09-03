import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSaleDetails } from '../_lib/paypal.js';

const SALE_IDS = ['61N01867914232007', '1MS39881CE404445X', '6W534967XX432373C'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const results = [];
  for (const id of SALE_IDS) {
    try {
      const sale = await getSaleDetails(id);
      results.push({
        id,
        state: sale.state,
        amount: sale.amount,
        billing_agreement_id: sale.billing_agreement_id,
        create_time: sale.create_time,
        update_time: sale.update_time
      });
    } catch (err: any) {
      results.push({ id, error: err.message });
    }
  }
  return res.status(200).json(results);
}
