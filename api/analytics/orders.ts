import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  try {
    const firestore = await getDb();
    const { days = '30' } = req.query as { days?: string };
    const daysNum = parseInt(days, 10) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysNum);

    const snapshot = await firestore.collection('orders')
      .where('createdAt', '>=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const orders = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.userId,
        email: d.email,
        plan: d.plan,
        className: d.className,
        amount: d.amount,
        currency: d.currency,
        source: d.source,
        paymentProvider: d.paymentProvider,
        paymentStatus: d.paymentStatus,
        transactionId: d.transactionId,
        excludedFromRevenue: !!d.excludedFromRevenue,
        createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().toISOString() : d.createdAt
      };
    });

    return res.status(200).json({ success: true, orders, count: orders.length });
  } catch (err: any) {
    console.error('[AnalyticsOrders] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
