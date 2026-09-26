import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/firebase-admin.js';
import { requireOwner } from '../_lib/auth.js';
import { countedAmount, buildPayout } from '../_lib/payout.js';

// OWNER-ONLY projected payout. Deliberately a separate endpoint from
// revenue.ts (which any admin can call) so nothing payout-related is ever in a
// response an admin can see, and gated by requireOwner, which 404s for anyone
// else - not even a 403 that would confirm the route exists.
//
// Two billing periods:
//   cycle=21       (default) the 21st through the next 21st
//   cycle=calendar the 1st through the next 1st

const DAY_MS = 86400000;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// YYYY-MM-DD from local (server) date parts - the same day boundaries the
// period math above uses, so a transaction is always bucketed into the day the
// payout totals count it in.
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function periodFor(cycle: 'cycle21' | 'calendar', now: Date): { start: Date; end: Date } {
  const anchorDay = cycle === 'calendar' ? 1 : 21;
  const start = new Date(now.getFullYear(), now.getMonth(), anchorDay, 0, 0, 0, 0);
  if (now.getDate() < anchorDay) start.setMonth(start.getMonth() - 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(404).json({ error: 'Not found' });
  }

  const caller = await requireOwner(req, res);
  if (!caller) return;

  try {
    const cycle = req.query.cycle === 'calendar' ? 'calendar' : 'cycle21';
    const now = new Date();
    const { start, end } = periodFor(cycle, now);

    const daysInPeriod = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const daysElapsed = Math.min(
      daysInPeriod,
      Math.max(1, Math.round((startOfDay(now).getTime() - start.getTime()) / DAY_MS) + 1)
    );

    const firestore = await getDb();
    const snapshot = await firestore.collection('orders')
      .where('createdAt', '>=', start)
      .where('createdAt', '<', end)
      .limit(2000)
      .get();

    // Every day in the period up front (zero-filled), so the chart shows the
    // whole period shape - including days that haven't happened yet.
    const days: { date: string; total: number; transactions: { time: string; amount: number; plan: string | null }[] }[] = [];
    const dayIndex: Record<string, number> = {};
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dayIndex[dayKey(d)] = days.length;
      days.push({ date: dayKey(d), total: 0, transactions: [] });
    }

    let revenue = 0;
    let paidTransactions = 0;
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const amt = countedAmount(data, 'OwnerPayout', doc.id);
      if (amt === null) return;
      revenue += amt;
      paidTransactions += 1;

      const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      const idx = dayIndex[dayKey(created)];
      if (idx !== undefined) {
        days[idx].total += amt;
        days[idx].transactions.push({ time: created.toISOString(), amount: amt, plan: data.plan || null });
      }
    });
    days.forEach(day => {
      day.total = parseFloat(day.total.toFixed(2));
      day.transactions.sort((a, b) => a.time.localeCompare(b.time));
    });

    return res.status(200).json({
      success: true,
      cycle,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      todayKey: dayKey(now),
      days,
      ...buildPayout(revenue, paidTransactions, daysElapsed, daysInPeriod)
    });
  } catch (err: any) {
    console.error('[OwnerPayout] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
