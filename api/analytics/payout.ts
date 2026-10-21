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

// Vercel functions run in UTC - plain `now.getDate()` etc. read the UTC
// calendar day, not the owner's. That's invisible most of the day but flips
// the "today"/period-boundary math to the wrong day for the few hours each
// evening (Eastern) after UTC has already crossed midnight but the owner's
// wall clock hasn't - e.g. showing a brand-new empty period a few hours
// early. Everything here reads the calendar day in the owner's zone instead.
const OWNER_TZ = 'America/New_York';

function easternParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OWNER_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const get = (type: string) => +parts.find(p => p.type === type)!.value;
  return { y: get('year'), m: get('month'), day: get('day') };
}

// Midnight on (y, m, day) *in OWNER_TZ*, as the correct UTC instant - not a
// fixed-offset guess, so this stays correct across the DST transition too.
// Standard trick: render a UTC guess in OWNER_TZ, measure how far that
// render is from the guess, and apply that same delta to correct it.
function ownerMidnightUTC(y: number, m: number, day: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: OWNER_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(guess);
  const get = (type: string) => +parts.find(p => p.type === type)!.value;
  const renderedAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(guess.getTime() + (guess.getTime() - renderedAsUTC));
}

function startOfOwnerDay(d: Date): Date {
  const { y, m, day } = easternParts(d);
  return ownerMidnightUTC(y, m, day);
}

// YYYY-MM-DD in the owner's zone - matches the period-boundary math above, so
// a transaction is always bucketed into the day the payout totals count it in.
function dayKey(d: Date): string {
  const { y, m, day } = easternParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(day)}`;
}

function periodFor(cycle: 'cycle21' | 'calendar', now: Date): { start: Date; end: Date } {
  const anchorDay = cycle === 'calendar' ? 1 : 21;
  const { y, m, day } = easternParts(now);
  let startY = y, startM = m;
  if (day < anchorDay) {
    startM -= 1;
    if (startM === 0) { startM = 12; startY -= 1; }
  }
  const start = ownerMidnightUTC(startY, startM, anchorDay);
  const endM = startM === 12 ? 1 : startM + 1;
  const endY = startM === 12 ? startY + 1 : startY;
  const end = ownerMidnightUTC(endY, endM, anchorDay);
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
      Math.max(1, Math.round((startOfOwnerDay(now).getTime() - start.getTime()) / DAY_MS) + 1)
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
