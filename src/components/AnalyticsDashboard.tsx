import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { DollarSign, Users, TrendingUp, Activity, Calendar, CreditCard, Award, Layers } from 'lucide-react';

interface RevenueData {
  totalRevenue: number;
  totalOrders: number;
  thisMonthRevenue: number;
  lastMonthRevenue: number;
  monthOverMonthPercent: number | null;
  projectedPayout: {
    daysElapsed: number;
    daysInMonth: number;
    revenue: number;
    paidTransactions: number;
    projectedGrossRevenue: number;
    projectedTransactions: number;
    expenses: { github: number; vercel: number; hostinger: number; paypalFees: number; total: number };
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
  } | null;
  activeSubscribers: number;
  aioSubscribers: number;
  singleSubscribers: number;
  activePayers: number;
  daily: Record<string, number>;
  monthly: Record<string, number>;
  planCounts: Record<string, number>;
}

const timeFilters = [
  { label: '7 Days', days: 7 },
  { label: 'This Month', days: 0 },
  { label: 'This Year', days: 365 }
];

interface SpecPopularity {
  windowDays: number;
  activePlayers: number;
  specs: { spec: string; class: string; players: number; percent: number }[];
}

interface AnalyticsDashboardProps {
  onSelectUser?: (email: string) => void;
}

export default function AnalyticsDashboard({ onSelectUser }: AnalyticsDashboardProps) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterIdx, setFilterIdx] = useState(0); // 7 days default
  const [error, setError] = useState<string | null>(null);

  // Independent of the time-filter tabs above - spec popularity is always a
  // fixed trailing-7-day window (see api/analytics/spec-popularity.ts), so it
  // loads once rather than refetching when the filter changes.
  const [specPop, setSpecPop] = useState<SpecPopularity | null>(null);
  const [specPopLoading, setSpecPopLoading] = useState(true);
  const [specPopError, setSpecPopError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();
        const res = await fetch('/api/analytics/spec-popularity', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error(`Spec Popularity API ${res.status}`);
        const json = await res.json();
        if (!cancelled) setSpecPop(json);
      } catch (e: any) {
        if (!cancelled) setSpecPopError(e.message || 'Failed to load spec popularity');
      } finally {
        if (!cancelled) setSpecPopLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filter = timeFilters[filterIdx];
  const days = filter.days;

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        const headers: any = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const [revRes, ordRes] = await Promise.all([
          fetch(`/api/analytics/revenue?days=${days}`, { headers }),
          fetch(`/api/analytics/orders?days=${days}`, { headers })
        ]);

        if (!revRes.ok) throw new Error(`Revenue API ${revRes.status}`);
        if (!ordRes.ok) throw new Error(`Orders API ${ordRes.status}`);

        const revData = await revRes.json();
        const ordData = await ordRes.json();

        if (!cancelled) {
          setData(revData);
          setOrders(ordData.orders || []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [days]);

  const dailyEntries = data ? Object.entries(data.daily).sort(([a], [b]) => a.localeCompare(b)) : [];
  const maxDaily = Math.max(1, ...dailyEntries.map(([, v]) => v));

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-white/5 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-lg font-black uppercase tracking-[0.2em] text-white/80">Analytics</h2>
        <div className="flex gap-2">
          {timeFilters.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setFilterIdx(i)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                i === filterIdx
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-white/5 text-white/40 border border-white/5 hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Card icon={<DollarSign className="w-4 h-4" />} label="Total Revenue" value={fmt(data?.totalRevenue || 0)} accent="text-primary" />
        <Card
          icon={<TrendingUp className="w-4 h-4" />}
          label="This Month's Revenue"
          value={fmt(data?.thisMonthRevenue || 0)}
          accent="text-green-500"
          subtitle={<MonthOverMonthSubtitle percent={data?.monthOverMonthPercent ?? null} />}
        />
        <Card icon={<Users className="w-4 h-4" />} label="Active Subs" value={`${data?.activeSubscribers || 0}`} accent="text-blue-500" />
        <Card icon={<CreditCard className="w-4 h-4" />} label="Total Orders" value={`${data?.totalOrders || 0}`} accent="text-white/60" />
        <Card icon={<Award className="w-4 h-4" />} label="AIO Subs" value={`${data?.aioSubscribers || 0}`} accent="text-purple-500" />
        <Card icon={<Layers className="w-4 h-4" />} label="Single Subs" value={`${data?.singleSubscribers || 0}`} accent="text-orange-500" />
        <Card icon={<Activity className="w-4 h-4" />} label="Active Payers" value={`${data?.activePayers || 0}`} accent="text-cyan-500" />
        <Card icon={<Calendar className="w-4 h-4" />} label="Period" value={filter.label} accent="text-white/40" />
      </div>

      {/* Projected Monthly Payout */}
      {data?.projectedPayout && (
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-5">
          <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Projected Monthly Payout</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PayoutColumn
              label="Earned So Far"
              sublabel="If sales stopped today"
              revenue={data.projectedPayout.revenue}
              paypalFees={data.projectedPayout.earned.paypalFees}
              netAfterPayPal={data.projectedPayout.earned.netAfterPayPal}
              owner1={data.projectedPayout.earned.owner1Payout}
              owner2={data.projectedPayout.earned.owner2Payout}
              fafoAllocation={data.projectedPayout.earned.fafoAllocation}
              fafoReserve={data.projectedPayout.earned.fafoReserve}
              amountNeededToUnlock={data.projectedPayout.earned.amountNeededToUnlock}
              unlocked={data.projectedPayout.earned.payoutsUnlocked}
            />
            <PayoutColumn
              label="Projected Month End"
              sublabel="At the current pace"
              revenue={data.projectedPayout.projectedGrossRevenue}
              revenueLabel="Projected Revenue"
              paypalFees={data.projectedPayout.projectedPayPalFees}
              netAfterPayPal={data.projectedPayout.projectedNetAfterPayPal}
              owner1={data.projectedPayout.owner1Payout}
              owner2={data.projectedPayout.owner2Payout}
              fafoAllocation={data.projectedPayout.fafoAllocation}
              fafoReserve={data.projectedPayout.fafoReserve}
              amountNeededToUnlock={data.projectedPayout.amountNeededToUnlock}
              unlocked={data.projectedPayout.payoutsUnlocked}
              accent
            />
          </div>

          <p className="text-[10px] font-bold text-white/20 pt-4 border-t border-white/5">
            Based on {fmt(data.projectedPayout.revenue)} revenue and {data.projectedPayout.paidTransactions} paid transaction{data.projectedPayout.paidTransactions === 1 ? '' : 's'} through{' '}
            {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} (day {data.projectedPayout.daysElapsed} of {data.projectedPayout.daysInMonth}).
          </p>
        </div>
      )}

      {/* Daily Revenue Bars */}
      {dailyEntries.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Daily Revenue</h3>
            <span className="text-[10px] font-bold text-white/20 tabular-nums">{dailyEntries.length} days</span>
          </div>
          <div className="flex items-end gap-1 h-48 overflow-x-auto">
            {dailyEntries.map(([date, amount]) => {
              const h = Math.max(4, (amount / maxDaily) * 100);
              return (
                <div key={date} className="flex-1 min-w-[32px] flex flex-col items-center justify-end gap-1 h-full">
                  <span className="text-[9px] font-black text-primary/80 tabular-nums whitespace-nowrap">
                    {amount > 0 ? `$${amount.toFixed(0)}` : ''}
                  </span>
                  <div
                    className="w-full bg-primary/60 hover:bg-primary transition-colors rounded-t"
                    style={{ height: `${h}%` }}
                    title={`${date}: $${amount.toFixed(2)}`}
                  />
                  <span className="text-[8px] font-bold text-white/20 tabular-nums rotate-45 origin-left translate-y-2">
                    {date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Orders */}
      {orders.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Recent Orders</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">Plan</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">User</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">Amount</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">Source</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">Status</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-white/20 py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.slice(0, 20).map((o: any) => {
                  const email = o.email || o.userEmail;
                  const clickable = !!email && !!onSelectUser;
                  return (
                  <tr
                    key={o.id}
                    onClick={clickable ? () => onSelectUser!(email) : undefined}
                    className={`transition-colors ${clickable ? 'hover:bg-white/[0.04] cursor-pointer' : 'hover:bg-white/[0.01]'}`}
                  >
                    <td className="py-2 text-xs font-bold text-white/60 uppercase">{o.plan}</td>
                    <td className="py-2">
                      <div className="text-xs font-bold text-white/80">{email || 'Unknown User'}</div>
                      <div className="text-[9px] font-mono text-white/20 truncate max-w-[140px]">{o.userId || '—'}</div>
                    </td>
                    <td className="py-2 text-xs font-bold text-white/60 tabular-nums">
                      {o.excludedFromRevenue ? (
                        <span className="text-white/20 line-through">${o.amount}</span>
                      ) : (
                        <span className="text-primary">${o.amount}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs font-bold text-white/40 uppercase">{o.source}</td>
                    <td className="py-2">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                        o.paymentStatus === 'completed' ? 'bg-green-500/10 text-green-500' :
                        o.paymentStatus === 'refunded' ? 'bg-red-500/10 text-red-500' :
                        'bg-white/5 text-white/40'
                      }`}>
                        {o.paymentStatus}
                      </span>
                    </td>
                    <td className="py-2 text-[10px] font-bold text-white/30 tabular-nums">
                      {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Spec Popularity - always a fixed 7-day window, independent of the
          time-filter tabs above (see the dedicated fetch). */}
      {!specPopLoading && specPopError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{specPopError}</div>
      )}
      {specPop && <SpecPopularityChart data={specPop} />}
    </div>
  );
}

// One row per spec (all ~40, including specs nobody's played in the window,
// at 0%) sorted by popularity. This is a real HTML table, not a div-based bar
// chart with a separate "table view" bolted on - the bar is a background
// fill inside the % cell, so the same markup IS both the visual chart and the
// accessible data table (every value is plain text, nothing is chart-only).
// Single series (just "% of active players"), so one flat color, no legend.
function SpecPopularityChart({ data }: { data: SpecPopularity }) {
  const maxPercent = Math.max(1, ...data.specs.map(s => s.percent));
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-white/40">Spec Popularity</h3>
          <p className="text-[10px] font-bold text-white/20 mt-1">
            % of active players on each spec, last {data.windowDays} days ({data.activePlayers} active player{data.activePlayers === 1 ? '' : 's'})
          </p>
        </div>
      </div>

      {data.activePlayers === 0 ? (
        <p className="text-[10px] font-bold text-white/20 italic py-4">No manager activity in the last {data.windowDays} days yet.</p>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {data.specs.map(s => (
              <tr key={s.spec} className="group">
                <td className="py-1 pr-3 w-[1%] whitespace-nowrap">
                  <span className="text-[11px] font-black text-white/70 uppercase tracking-tight">{s.spec}</span>
                </td>
                <td className="py-1 pr-3 w-[1%] whitespace-nowrap hidden sm:table-cell">
                  <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">{formatClassLabel(s.class)}</span>
                </td>
                <td className="py-1 w-full">
                  <div className="h-3 rounded bg-white/[0.03] overflow-hidden" title={`${s.spec}: ${s.percent}% (${s.players} player${s.players === 1 ? '' : 's'})`}>
                    <div
                      className="h-full rounded bg-primary/70 group-hover:bg-primary transition-colors"
                      style={{ width: `${(s.percent / maxPercent) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 pl-3 w-[1%] whitespace-nowrap text-right">
                  <span className="text-[11px] font-bold text-white/60 tabular-nums">{s.percent}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatClassLabel(cls: string): string {
  return cls.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function PayoutColumn({
  label, sublabel, revenue, revenueLabel, paypalFees, netAfterPayPal,
  owner1, owner2, fafoAllocation, fafoReserve, amountNeededToUnlock, unlocked, accent
}: {
  label: string; sublabel: string; revenue: number; revenueLabel?: string; paypalFees: number; netAfterPayPal: number;
  owner1: number; owner2: number; fafoAllocation: number; fafoReserve: number;
  amountNeededToUnlock: number; unlocked: boolean; accent?: boolean;
}) {
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className={`rounded-xl p-4 space-y-4 border ${accent ? 'bg-primary/[0.04] border-primary/10' : 'bg-white/[0.015] border-white/[0.04]'}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{label}</span>
        <span className="text-[9px] font-bold text-white/20">{sublabel}</span>
      </div>

      {/* Tiered split: the first $80 of net-after-PayPal funds FAFO's flat
          operating budget; $80-$400 splits 50/50 between the owners with no
          FAFO reserve; above $400, additional revenue splits 40/40/20 and
          that's where FAFO's reserve/overflow starts accumulating. Payouts
          are available as soon as the $80 budget is funded. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <ExpenseLine label={revenueLabel || 'Revenue'} value={fmt(revenue)} />
        <ExpenseLine label="Net After PayPal/Fees" value={fmt(Math.max(0, netAfterPayPal - fafoAllocation))} />
        <ExpenseLine label="FAFO Operating Budget Funded" value={fmt(fafoAllocation)} />
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
        <ExpenseLine label="PayPal + FAFO Fees" value={fmt(paypalFees + fafoReserve)} />
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

function ExpenseLine({ label, value, accent, note }: { label: string; value: string; accent?: boolean; note?: string }) {
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-widest text-white/20 truncate">{label}</div>
      <div className={`text-xs font-bold tabular-nums ${accent ? 'text-primary' : 'text-white/60'}`}>{value}</div>
      {note && <div className="text-[8px] font-bold text-white/20 leading-tight mt-0.5">{note}</div>}
    </div>
  );
}

function Card({ icon, label, value, accent, subtitle }: { icon: React.ReactNode; label: string; value: string; accent: string; subtitle?: React.ReactNode }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-4 space-y-2 hover:border-white/[0.08] transition-colors">
      <div className="flex items-center gap-2">
        <span className={`${accent}`}>{icon}</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-white/20">{label}</span>
      </div>
      <div className={`text-lg font-black tabular-nums ${accent}`}>{value}</div>
      {subtitle}
    </div>
  );
}

// Independent of the selected date-range tab - always compares the current
// calendar month to the prior one, so it reads the same everywhere.
function MonthOverMonthSubtitle({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <div className="text-[10px] font-bold text-white/20">No prior month to compare</div>;
  }
  const up = percent >= 0;
  return (
    <div className={`text-[10px] font-bold flex items-center gap-1 ${up ? 'text-green-500' : 'text-red-500'}`}>
      <span>{up ? '↑' : '↓'}</span>
      <span>{Math.abs(percent).toFixed(1)}% from last month</span>
    </div>
  );
}
