import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import PayoutCharts, { type PayoutDay } from './PayoutCharts';

// Owner-only. Only rendered for the owner (AdminPanel doesn't even list the
// tab for anyone else), and the data comes from an owner-gated endpoint that
// 404s for admins, so this is never reachable by another admin.

type Cycle = 'cycle21' | 'calendar';

const CYCLES: { id: Cycle; label: string }[] = [
  { id: 'cycle21', label: '21st – 21st' },
  { id: 'calendar', label: 'Calendar Month' }
];

interface PayoutData {
  periodStart: string;
  periodEnd: string;
  todayKey: string;
  days: PayoutDay[];
  daysElapsed: number;
  daysInPeriod: number;
  revenue: number;
  paidTransactions: number;
  projectedGrossRevenue: number;
  projectedPayPalFees: number;
  projectedNetAfterPayPal: number;
  payoutsUnlocked: boolean;
  owner1Payout: number;
  owner2Payout: number;
  fafoAllocation: number;
  fafoReserve: number;
  amountNeededToUnlock: number;
  earned: {
    paypalFees: number; netAfterPayPal: number; payoutsUnlocked: boolean;
    owner1Payout: number; owner2Payout: number;
    fafoAllocation: number; fafoReserve: number; amountNeededToUnlock: number;
  };
}

const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Period boundaries are midnight UTC on the 21st (matching the server's day buckets), so format
// them in UTC - in a US timezone a local format would show the 20th.
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function OwnerPayout() {
  const [cycle, setCycle] = useState<Cycle>('cycle21');
  const [data, setData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getAuth().currentUser?.getIdToken();
        const res = await fetch(`/api/analytics/payout?cycle=${cycle}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error(`Payout API ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load payout');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [cycle]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-lg font-black uppercase tracking-[0.2em] text-white/80">Projected Monthly Payout</h2>
        <div className="flex gap-2">
          {CYCLES.map(c => (
            <button
              key={c.id}
              onClick={() => setCycle(c.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                c.id === cycle
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-white/5 text-white/40 border border-white/5 hover:bg-white/10'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <div className="h-64 bg-white/5 rounded-2xl animate-pulse" />}

      {!loading && error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{error}</div>
      )}

      {!error && data && (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-5">
          <h3 className="text-xs font-black uppercase tracking-widest text-white/40">
            {fmtDay(data.periodStart)} – {fmtDay(data.periodEnd)}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PayoutColumn
              label="Earned So Far"
              sublabel="If sales stopped today"
              revenue={data.revenue}
              paypalFees={data.earned.paypalFees}
              netAfterPayPal={data.earned.netAfterPayPal}
              owner1={data.earned.owner1Payout}
              owner2={data.earned.owner2Payout}
              fafoAllocation={data.earned.fafoAllocation}
              fafoReserve={data.earned.fafoReserve}
              amountNeededToUnlock={data.earned.amountNeededToUnlock}
              unlocked={data.earned.payoutsUnlocked}
            />
            <PayoutColumn
              label="Projected Period End"
              sublabel="At the current pace"
              revenue={data.projectedGrossRevenue}
              revenueLabel="Projected Revenue"
              paypalFees={data.projectedPayPalFees}
              netAfterPayPal={data.projectedNetAfterPayPal}
              owner1={data.owner1Payout}
              owner2={data.owner2Payout}
              fafoAllocation={data.fafoAllocation}
              fafoReserve={data.fafoReserve}
              amountNeededToUnlock={data.amountNeededToUnlock}
              unlocked={data.payoutsUnlocked}
              accent
            />
          </div>

          <p className="text-[10px] font-bold text-white/20 pt-4 border-t border-white/5">
            Based on {fmt(data.revenue)} revenue and {data.paidTransactions} paid transaction{data.paidTransactions === 1 ? '' : 's'} from{' '}
            {fmtDay(data.periodStart)} through today (day {data.daysElapsed} of {data.daysInPeriod}).
          </p>
        </div>

        <PayoutCharts days={data.days} todayKey={data.todayKey} projectedEnd={data.projectedGrossRevenue} />
        </div>
      )}
    </div>
  );
}

function PayoutColumn({
  label, sublabel, revenue, revenueLabel, paypalFees, netAfterPayPal,
  owner1, owner2, fafoAllocation, fafoReserve, amountNeededToUnlock, unlocked, accent
}: {
  label: string; sublabel: string; revenue: number; revenueLabel?: string; paypalFees: number; netAfterPayPal: number;
  owner1: number; owner2: number; fafoAllocation: number; fafoReserve: number;
  amountNeededToUnlock: number; unlocked: boolean; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 space-y-4 border ${accent ? 'bg-primary/[0.04] border-primary/10' : 'bg-white/[0.015] border-white/[0.04]'}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{label}</span>
        <span className="text-[9px] font-bold text-white/20">{sublabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <StatLine label={revenueLabel || 'Revenue'} value={fmt(revenue)} />
        <StatLine label="Net After PayPal/Fees" value={fmt(Math.max(0, netAfterPayPal - fafoAllocation))} />
        <StatLine label="FAFO Operating Budget Funded" value={fmt(fafoAllocation)} />
      </div>

      <div className="pt-3 border-t border-white/5 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-white/20">Owner 1</div>
          <div className={`text-lg font-black tabular-nums ${accent ? 'text-primary' : 'text-white/80'}`}>{fmt(owner1)}</div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-white/20">Owner 2</div>
          <div className={`text-lg font-black tabular-nums ${accent ? 'text-primary' : 'text-white/80'}`}>{fmt(owner2)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <StatLine label="PayPal + FAFO Fees" value={fmt(paypalFees + fafoReserve)} />
      </div>

      <div className={`text-[10px] font-black uppercase tracking-widest ${unlocked ? 'text-green-500' : 'text-yellow-500/80'}`}>
        Payout Status: {unlocked ? 'Available' : 'Locked'}
      </div>
      {!unlocked && (
        <div className="text-[9px] font-bold text-white/30">
          {fmt(amountNeededToUnlock)} more needed to cover FAFO's $80 monthly operating budget.
        </div>
      )}
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-widest text-white/20 truncate">{label}</div>
      <div className="text-xs font-bold tabular-nums text-white/60">{value}</div>
    </div>
  );
}
