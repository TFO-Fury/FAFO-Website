import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireAdmin } from '../_lib/auth.js';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

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
    const { days = '30' } = req.query as { days?: string };
    const daysNum = parseInt(days, 10) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysNum);

    const snapshot = await firestore.collection('orders')
      .where('createdAt', '>=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(2000)
      .get();

    let totalRevenue = 0;
    let totalOrders = 0;
    let mrr = 0;
    const daily: Record<string, number> = {};
    const monthly: Record<string, number> = {};
    const planCounts: Record<string, number> = { aio: 0, single: 0, trial: 0 };
    const activePayers = new Set<string>();

    const now = new Date();

    snapshot.docs.forEach(doc => {
      const d = doc.data();
      if (d.excludedFromRevenue) return;
      if (d.paymentStatus !== 'completed') return;
      if (!d.amount) return;

      const amt = parseFloat(d.amount) || 0;
      totalRevenue += amt;
      totalOrders += 1;

      const date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      const dayKey = startOfDay(date).toISOString().split('T')[0];
      const monthKey = startOfMonth(date).toISOString().slice(0, 7);

      daily[dayKey] = (daily[dayKey] || 0) + amt;
      monthly[monthKey] = (monthly[monthKey] || 0) + amt;

      if (d.plan) planCounts[d.plan] = (planCounts[d.plan] || 0) + 1;
      if (d.userId) activePayers.add(d.userId);
    });

    // Approximate MRR: revenue in the last 30 days
    const mrrCutoff = new Date();
    mrrCutoff.setDate(mrrCutoff.getDate() - 30);
    snapshot.docs.forEach(doc => {
      const d = doc.data();
      if (d.excludedFromRevenue) return;
      if (d.paymentStatus !== 'completed') return;
      const date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      if (date >= mrrCutoff) {
        mrr += parseFloat(d.amount) || 0;
      }
    });

    // Count active subscribers from users collection
    const usersSnap = await firestore.collection('users').get();
    let activeSubscribers = 0;
    let aioSubscribers = 0;
    let singleSubscribers = 0;
    usersSnap.docs.forEach(doc => {
      const d = doc.data();
      if (d.accountStatus !== 'active') return;
      if (d.aioExpires) {
        const exp = d.aioExpires.toDate ? d.aioExpires.toDate() : new Date(d.aioExpires);
        if (!isNaN(exp.getTime()) && exp > now) aioSubscribers += 1;
      }
      if (d.classEntitlements) {
        const hasActive = Object.values(d.classEntitlements).some((ent: any) => {
          const e = ent?.expires?.toDate ? ent.expires.toDate() : new Date(ent?.expires);
          return !isNaN(e.getTime()) && e > now;
        });
        if (hasActive) singleSubscribers += 1;
      }
      if (d.expiresAt) {
        const exp = d.expiresAt.toDate ? d.expiresAt.toDate() : new Date(d.expiresAt);
        if (!isNaN(exp.getTime()) && exp > now) activeSubscribers += 1;
      }
    });
    activeSubscribers = Math.max(activeSubscribers, aioSubscribers + singleSubscribers);

    return res.status(200).json({
      success: true,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalOrders,
      mrr: parseFloat(mrr.toFixed(2)),
      activeSubscribers,
      aioSubscribers,
      singleSubscribers,
      activePayers: activePayers.size,
      daily,
      monthly,
      planCounts
    });
  } catch (err: any) {
    console.error('[AnalyticsRevenue] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
