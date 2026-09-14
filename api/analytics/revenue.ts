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

function startOfPrevMonth(d: Date): Date {
  const r = startOfMonth(d);
  r.setMonth(r.getMonth() - 1);
  return r;
}

// Same qualifying-order filter used by the main revenue loop below, factored
// out so the independent this-month-vs-last-month comparison (which always
// covers a fixed 2-month window, regardless of whichever date-range tab is
// selected) applies identical rules instead of drifting out of sync.
function countedAmount(d: any, logPrefix: string, docId: string): number | null {
  const currency = (d.currency || 'USD').toUpperCase();
  if (d.excludedFromRevenue) {
    console.log(`[${logPrefix}] Ignored excluded order ${docId}: source=${d.source || 'unknown'}, amount=${d.amount}, currency=${currency}`);
    return null;
  }
  if (d.paymentStatus !== 'completed') {
    console.log(`[${logPrefix}] Ignored incomplete order ${docId}: status=${d.paymentStatus}, amount=${d.amount}`);
    return null;
  }
  if (!d.amount) {
    console.log(`[${logPrefix}] Ignored zero-amount order ${docId}`);
    return null;
  }
  if (currency !== 'USD') {
    console.log(`[${logPrefix}] Ignored non-USD order ${docId}: amount=${d.amount}, currency=${currency}`);
    return null;
  }
  return parseFloat(d.amount) || 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  try {
    const firestore = await getDb();
    // "This Month" sends days=0 as a sentinel for "since the 1st of the
    // current calendar month" - `parseInt('0', 10) || 30` previously treated
    // that 0 as falsy and silently fell back to the same 30-day window as
    // the "30 Days" filter, making the two show identical numbers.
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
      .limit(2000)
      .get();

    let totalRevenue = 0;
    let totalOrders = 0;
    // Zero-fill every day in the requested range up front - otherwise a day
    // with zero completed orders never gets a key at all (the loop below
    // only touches days that had a qualifying order), so the chart silently
    // renders fewer bars than the selected range instead of a $0 bar for
    // days with no revenue (e.g. "7 Days" showing only 5 bars).
    const daily: Record<string, number> = {};
    for (let d = new Date(cutoff); d <= new Date(); d.setDate(d.getDate() + 1)) {
      daily[startOfDay(d).toISOString().split('T')[0]] = 0;
    }
    const monthly: Record<string, number> = {};
    const planCounts: Record<string, number> = { aio: 0, single: 0, trial: 0 };
    const activePayers = new Set<string>();

    const now = new Date();

    snapshot.docs.forEach(doc => {
      const d = doc.data();
      const docId = doc.id;
      const amt = countedAmount(d, 'Revenue', docId);
      if (amt === null) return;

      totalRevenue += amt;
      totalOrders += 1;

      const date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      const dayKey = startOfDay(date).toISOString().split('T')[0];
      const monthKey = startOfMonth(date).toISOString().slice(0, 7);

      daily[dayKey] = (daily[dayKey] || 0) + amt;
      monthly[monthKey] = (monthly[monthKey] || 0) + amt;

      if (d.plan) planCounts[d.plan] = (planCounts[d.plan] || 0) + 1;
      if (d.userId) activePayers.add(d.userId);

      console.log(`[Revenue] Counted order ${docId}: source=${d.source || 'unknown'}, plan=${d.plan || 'unknown'}, amount=${amt}, currency=${d.currency || 'USD'}, date=${dayKey}`);
    });

    // This-Month-vs-Last-Month comparison - deliberately independent of the
    // days/cutoff above (which follows whichever tab is selected) so this
    // stat is identical no matter which date-range tab is active, per the
    // request that it "show on every tab." Replaces the old MRR figure,
    // which was actually just a hardcoded trailing-30-day revenue sum
    // mislabeled as Monthly Recurring Revenue.
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfPrevMonth(now);
    const momSnapshot = await firestore.collection('orders')
      .where('createdAt', '>=', lastMonthStart)
      .limit(2000)
      .get();

    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let thisMonthPaidTransactions = 0;
    momSnapshot.docs.forEach(doc => {
      const d = doc.data();
      const amt = countedAmount(d, 'RevenueMoM', doc.id);
      if (amt === null) return;
      const date = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      if (date >= thisMonthStart) {
        thisMonthRevenue += amt;
        thisMonthPaidTransactions += 1; // countedAmount already excludes $0/incomplete/excluded orders
      } else if (date >= lastMonthStart) {
        lastMonthRevenue += amt;
      }
    });

    const monthOverMonthPercent = lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : (thisMonthRevenue > 0 ? null : 0); // null = no prior-month baseline to compare against

    // Projected Monthly Payout - projects the current month's pace (revenue
    // and paid-transaction rate) through the rest of the month, deducts
    // fixed hosting costs + a per-transaction PayPal fee budget, then splits
    // what's left 40/40/20 between the two owners and the business account.
    // "Earned so far" runs the identical expense/split logic against the
    // actual (non-projected) month-to-date numbers, so the dashboard can
    // show both "if we stopped selling today" and "at the current pace."
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    const PAYPAL_FEE_PER_TRANSACTION = 2.25;
    const FIXED_EXPENSES = { github: 40, vercel: 20, hostinger: 18.99 };
    const fixedExpensesTotal = FIXED_EXPENSES.github + FIXED_EXPENSES.vercel + FIXED_EXPENSES.hostinger;

    const projectedGrossRevenue = (thisMonthRevenue / daysElapsed) * daysInMonth;
    const projectedTransactions = Math.round((thisMonthPaidTransactions / daysElapsed) * daysInMonth);
    const projectedPayPalFees = projectedTransactions * PAYPAL_FEE_PER_TRANSACTION;
    const projectedExpenses = fixedExpensesTotal + projectedPayPalFees;
    const projectedNetProfit = projectedGrossRevenue - projectedExpenses;
    const projectedNetForSplit = Math.max(0, projectedNetProfit);

    const earnedPayPalFees = thisMonthPaidTransactions * PAYPAL_FEE_PER_TRANSACTION;
    const earnedExpenses = fixedExpensesTotal + earnedPayPalFees;
    const earnedNetProfit = thisMonthRevenue - earnedExpenses;
    const earnedNetForSplit = Math.max(0, earnedNetProfit);

    const round2 = (n: number) => parseFloat(n.toFixed(2));
    // Expenses, net profit, and FAFO's retained share are deliberately left
    // out of the response - the owner-facing dashboard shows only what each
    // owner is projected to receive, not the underlying cost/retention
    // breakdown. Computed above for the payout math itself, just never sent.
    const projectedPayout = {
      daysElapsed,
      daysInMonth,
      revenue: round2(thisMonthRevenue),
      paidTransactions: thisMonthPaidTransactions,
      projectedGrossRevenue: round2(projectedGrossRevenue),
      projectedTransactions,
      owner1Payout: round2(projectedNetForSplit * 0.4),
      owner2Payout: round2(projectedNetForSplit * 0.4),
      earned: {
        owner1Payout: round2(earnedNetForSplit * 0.4),
        owner2Payout: round2(earnedNetForSplit * 0.4)
      }
    };

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
      thisMonthRevenue: parseFloat(thisMonthRevenue.toFixed(2)),
      lastMonthRevenue: parseFloat(lastMonthRevenue.toFixed(2)),
      monthOverMonthPercent: monthOverMonthPercent === null ? null : parseFloat(monthOverMonthPercent.toFixed(1)),
      projectedPayout,
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
