import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { DollarSign, Users, TrendingUp, Activity, Calendar, CreditCard, Award, Layers } from 'lucide-react';

interface RevenueData {
  totalRevenue: number;
  totalOrders: number;
  mrr: number;
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
  { label: '30 Days', days: 30 },
  { label: 'This Month', days: 0 },
  { label: 'This Year', days: 365 }
];

interface AnalyticsDashboardProps {
  onSelectUser?: (email: string) => void;
}

export default function AnalyticsDashboard({ onSelectUser }: AnalyticsDashboardProps) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterIdx, setFilterIdx] = useState(1); // 30 days default
  const [error, setError] = useState<string | null>(null);

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
        <Card icon={<TrendingUp className="w-4 h-4" />} label="MRR" value={fmt(data?.mrr || 0)} accent="text-green-500" />
        <Card icon={<Users className="w-4 h-4" />} label="Active Subs" value={`${data?.activeSubscribers || 0}`} accent="text-blue-500" />
        <Card icon={<CreditCard className="w-4 h-4" />} label="Total Orders" value={`${data?.totalOrders || 0}`} accent="text-white/60" />
        <Card icon={<Award className="w-4 h-4" />} label="AIO Subs" value={`${data?.aioSubscribers || 0}`} accent="text-purple-500" />
        <Card icon={<Layers className="w-4 h-4" />} label="Single Subs" value={`${data?.singleSubscribers || 0}`} accent="text-orange-500" />
        <Card icon={<Activity className="w-4 h-4" />} label="Active Payers" value={`${data?.activePayers || 0}`} accent="text-cyan-500" />
        <Card icon={<Calendar className="w-4 h-4" />} label="Period" value={filter.label} accent="text-white/40" />
      </div>

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
    </div>
  );
}

function Card({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-4 space-y-2 hover:border-white/[0.08] transition-colors">
      <div className="flex items-center gap-2">
        <span className={`${accent}`}>{icon}</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-white/20">{label}</span>
      </div>
      <div className={`text-lg font-black tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
