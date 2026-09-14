import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';

function startOfMonth(d: Date): Date {
  const r = new Date(d);
  r.setDate(1);
  r.setHours(0, 0, 0, 0);
  return r;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  try {
    const firestore = await getDb();
    // Same "This Month" sentinel handling as api/analytics/revenue.ts - see
    // its comment for why days=0 needs to be checked before the || fallback.
    const { days = '30' } = req.query as { days?: string };
    const daysNum = days === '0' ? 0 : (parseInt(days, 10) || 30);
    const cutoff = daysNum === 0 ? startOfMonth(new Date()) : (() => {
      const c = new Date();
      c.setDate(c.getDate() - daysNum);
      return c;
    })();

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
        userEmail: d.userEmail || null,
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
