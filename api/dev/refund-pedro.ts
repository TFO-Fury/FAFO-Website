import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSaleDetails, refundSale } from '../_lib/paypal.js';

// The sale tied to the duplicate subscription (I-XENL422S5E7U) we cancelled -
// customer was double-charged $35 on renewal due to the never-cancelled
// duplicate subscription bug. One-off refund of that specific sale only.
const SALE_ID = '5N530262E3015144X';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const dryRun = req.query.dryRun === 'true';

  try {
    const sale = await getSaleDetails(SALE_ID);
    const check = {
      id: sale.id,
      state: sale.state,
      amount: sale.amount,
      billing_agreement_id: sale.billing_agreement_id,
      alreadyRefunded: sale.state === 'refunded' || sale.state === 'partially_refunded'
    };

    if (check.alreadyRefunded) {
      return res.status(400).json({ error: 'Sale already refunded', check });
    }
    if (check.state !== 'completed') {
      return res.status(400).json({ error: `Sale not in completed state (${check.state}), refusing to refund`, check });
    }

    if (dryRun) {
      return res.status(200).json({ dryRun: true, check });
    }

    const refund = await refundSale(SALE_ID);
    return res.status(200).json({ success: true, check, refund });
  } catch (err: any) {
    console.error('[RefundPedro] Error:', err);
    return res.status(500).json({ error: err.message || 'Refund failed' });
  }
}
