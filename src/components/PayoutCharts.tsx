import { useEffect, useRef, useState, type ReactNode } from 'react';

// Owner-only payout charts. Two charts, each with a single axis (never dual):
//   1. Revenue by day - every transaction is its own block in that day's column.
//   2. Cumulative revenue - the running total, with a dashed projection to the
//      end of the period at the current pace.
// Plus a table view of every transaction (the non-hover, non-visual twin).
// Single series => one color (the site's primary), no legend box; the titles
// say what is plotted.

export interface PayoutTransaction { time: string; amount: number; plan: string | null }
export interface PayoutDay { date: string; total: number; transactions: PayoutTransaction[] }

const SERIES = 'var(--color-primary)';
const SERIES_HOVER = '#ff7a3d';
const SURFACE = 'var(--color-background)';
const GRID = 'rgba(255,255,255,0.06)';
const INK_MUTED = 'rgba(255,255,255,0.32)';
const INK_SECONDARY = 'rgba(255,255,255,0.6)';

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyWhole = (n: number) => `$${Math.round(n).toLocaleString()}`;
// Day keys are YYYY-MM-DD in the server's day boundaries; format them in UTC so
// the label never shifts a day depending on the viewer's timezone.
const keyDate = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const shortDay = (key: string) => keyDate(key, { month: 'short', day: 'numeric' });
const longDay = (key: string) => keyDate(key, { weekday: 'short', month: 'short', day: 'numeric' });
const planLabel = (p: string | null) => (p ? p.toUpperCase() : 'ORDER');

function niceScale(max: number): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 100, ticks: [0, 25, 50, 75, 100] };
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  const step = niceFrac * pow;
  const n = Math.max(1, Math.ceil(max / step));
  return { max: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

// 4px rounded data-end, square at the baseline.
function topRoundedPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

const M = { l: 48, r: 14, t: 18, b: 28 };

// Sits beside the hovered day (never on top of it, so the bar stays visible),
// flipping to the left side when there is no room on the right.
function Tooltip({ left, width, children }: { left: number; width: number; children: ReactNode }) {
  const TIP_W = 230;
  const flip = left + 14 + TIP_W > width;
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-[170px] max-w-[230px] rounded-lg border border-white/10 bg-[#1d2026] px-3 py-2 shadow-xl"
      style={flip ? { left: left - 14, transform: 'translateX(-100%)' } : { left: left + 14 }}
    >
      {children}
    </div>
  );
}

function ChartFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-xs font-black uppercase tracking-widest text-white/40">{title}</h3>
        <p className="text-[10px] font-bold text-white/20 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function DailyColumns({ days, todayKey }: { days: PayoutDay[]; todayKey: string }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const N = days.length;
  const plotW = Math.max(0, width - M.l - M.r);
  const plotH = H - M.t - M.b;
  const band = N ? plotW / N : 0;
  const barW = Math.min(24, band * 0.72);
  const maxTotal = Math.max(0, ...days.map(d => d.total));
  const { max: yMax, ticks } = niceScale(maxTotal);
  const yOf = (v: number) => M.t + plotH - (v / yMax) * plotH;
  const cx = (i: number) => M.l + band * (i + 0.5);
  const todayIdx = days.findIndex(d => d.date === todayKey);
  const peakIdx = maxTotal > 0 ? days.findIndex(d => d.total === maxTotal) : -1;
  const labelEvery = Math.max(1, Math.ceil(N / 7));
  const hd = hover !== null ? days[hover] : null;

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Revenue by day; every transaction is its own block. The full list is in the transactions table below.">
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={yOf(t)} y2={yOf(t)} stroke={GRID} strokeWidth={1} />
              <text x={M.l - 8} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill={INK_MUTED}>{moneyWhole(t)}</text>
            </g>
          ))}

          {todayIdx >= 0 && (
            <rect x={M.l + band * todayIdx} y={M.t} width={band} height={plotH} fill="rgba(255,255,255,0.03)" />
          )}

          {days.map((day, i) => {
            const isHover = hover === i;
            let cum = 0;
            const segs = day.transactions.map((t, k) => {
              const h = Math.max(3, (t.amount / yMax) * plotH);
              const yTop = yOf(cum) - h;
              cum += t.amount;
              return { h, yTop, k };
            });
            const x = cx(i) - barW / 2;
            return (
              <g key={day.date}>
                {segs.map((s, k) => {
                  const isTop = k === segs.length - 1;
                  const isBottom = k === 0;
                  // 2px surface gap between stacked blocks: every block but the
                  // bottom one is drawn 2px short of its lower edge.
                  const h = isBottom ? s.h : Math.max(1, s.h - 2);
                  const fill = isHover ? SERIES_HOVER : SERIES;
                  return isTop ? (
                    <path key={k} d={topRoundedPath(x, s.yTop, barW, h, 4)} style={{ fill }} />
                  ) : (
                    <rect key={k} x={x} y={s.yTop} width={barW} height={h} style={{ fill }} />
                  );
                })}
                {day.transactions.length === 0 && (
                  <line x1={cx(i) - barW / 2} x2={cx(i) + barW / 2} y1={yOf(0) - 0.5} y2={yOf(0) - 0.5} stroke={GRID} strokeWidth={1} />
                )}
                {/* Hit target is the whole day slot, top to bottom - far bigger than the mark. */}
                <rect
                  x={M.l + band * i} y={M.t} width={band} height={plotH + 1}
                  fill="transparent" tabIndex={0}
                  aria-label={`${longDay(day.date)}: ${money(day.total)}, ${day.transactions.length} transaction${day.transactions.length === 1 ? '' : 's'}`}
                  onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  style={{ outline: 'none' }}
                />
              </g>
            );
          })}

          {peakIdx >= 0 && (
            <text x={cx(peakIdx)} y={yOf(maxTotal) - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK_SECONDARY}>
              {moneyWhole(maxTotal)}
            </text>
          )}

          {days.map((day, i) => {
            const isToday = i === todayIdx;
            const collides = todayIdx >= 0 && !isToday && Math.abs(i - todayIdx) < Math.ceil(labelEvery * 0.8);
            if (!isToday && (i % labelEvery !== 0 || collides)) return null;
            return (
              <text key={day.date} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10}
                fontWeight={isToday ? 700 : 400} fill={isToday ? 'rgba(255,255,255,0.85)' : INK_MUTED}>
                {isToday ? 'Today' : shortDay(day.date)}
              </text>
            );
          })}
        </svg>
      )}

      {hd && (
        <Tooltip left={cx(hover as number)} width={width}>
          <div className="text-[10px] font-bold text-white/50">{longDay(hd.date)}</div>
          <div className="text-base font-black text-white leading-tight">{money(hd.total)}</div>
          <div className="text-[10px] font-bold text-white/40 mb-1">
            {hd.transactions.length} transaction{hd.transactions.length === 1 ? '' : 's'}
          </div>
          <div className="space-y-0.5">
            {hd.transactions.slice(0, 8).map((t, k) => (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <span className="inline-block w-3 h-[2px] rounded" style={{ background: SERIES }} />
                <span className="font-bold text-white/80 tabular-nums">{money(t.amount)}</span>
                <span className="text-white/35">{planLabel(t.plan)}</span>
              </div>
            ))}
            {hd.transactions.length > 8 && (
              <div className="text-[10px] text-white/30">+{hd.transactions.length - 8} more</div>
            )}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

function CumulativeLine({ days, todayKey, projectedEnd }: { days: PayoutDay[]; todayKey: string; projectedEnd: number }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 230;
  const N = days.length;
  const todayIdx = Math.max(0, days.findIndex(d => d.date === todayKey));
  const plotW = Math.max(0, width - M.l - M.r);
  const plotH = H - M.t - M.b;
  const band = N ? plotW / N : 0;
  const cx = (i: number) => M.l + band * (i + 0.5);

  const cum: number[] = [];
  let running = 0;
  for (let i = 0; i <= todayIdx && i < N; i++) {
    running += days[i].total;
    cum.push(running);
  }
  const cumToday = cum[todayIdx] ?? 0;
  const hasProjection = todayIdx < N - 1;
  const endValue = hasProjection ? projectedEnd : cumToday;
  const { max: yMax, ticks } = niceScale(Math.max(cumToday, endValue));
  const yOf = (v: number) => M.t + plotH - (v / yMax) * plotH;

  const linePath = cum.map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${yOf(v)}`).join(' ');
  const areaPath = cum.length ? `${linePath} L${cx(todayIdx)},${yOf(0)} L${cx(0)},${yOf(0)} Z` : '';

  const valueAt = (i: number) => {
    if (i <= todayIdx) return { v: cum[i], projected: false };
    const t = (i - todayIdx) / (N - 1 - todayIdx);
    return { v: cumToday + (endValue - cumToday) * t, projected: true };
  };
  const hv = hover !== null ? valueAt(hover) : null;
  const labelEvery = Math.max(1, Math.ceil(N / 7));

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Cumulative revenue over the period with a dashed projection to the end at the current pace.">
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={yOf(t)} y2={yOf(t)} stroke={GRID} strokeWidth={1} />
              <text x={M.l - 8} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill={INK_MUTED}>{moneyWhole(t)}</text>
            </g>
          ))}

          {areaPath && <path d={areaPath} style={{ fill: SERIES }} fillOpacity={0.1} />}
          {linePath && <path d={linePath} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: SERIES }} />}
          {hasProjection && (
            <line x1={cx(todayIdx)} y1={yOf(cumToday)} x2={cx(N - 1)} y2={yOf(endValue)}
              strokeWidth={2} strokeLinecap="round" strokeDasharray="2 6" style={{ stroke: SERIES }} opacity={0.7} />
          )}

          {/* End-dots carry a 2px surface ring. Labels use text ink, never the series color. */}
          <circle cx={cx(todayIdx)} cy={yOf(cumToday)} r={4.5} strokeWidth={2} style={{ fill: SERIES, stroke: SURFACE }} />
          <text x={cx(todayIdx) - 10} y={yOf(cumToday) - 10} textAnchor="end" fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.85)">
            {moneyWhole(cumToday)}
          </text>
          {hasProjection && (
            <>
              <circle cx={cx(N - 1)} cy={yOf(endValue)} r={4.5} strokeWidth={2} style={{ fill: SERIES, stroke: SURFACE }} opacity={0.7} />
              <text x={cx(N - 1)} y={yOf(endValue) - 10} textAnchor="end" fontSize={11} fontWeight={700} fill={INK_SECONDARY}>
                Projected {moneyWhole(endValue)}
              </text>
            </>
          )}

          {hover !== null && hv && (
            <g pointerEvents="none">
              <line x1={cx(hover)} x2={cx(hover)} y1={M.t} y2={M.t + plotH} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
              <circle cx={cx(hover)} cy={yOf(hv.v)} r={4.5} strokeWidth={2} style={{ fill: SERIES, stroke: SURFACE }} />
            </g>
          )}

          {days.map((day, i) => (i % labelEvery === 0 ? (
            <text key={day.date} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={INK_MUTED}>{shortDay(day.date)}</text>
          ) : null))}

          {/* Crosshair layer: the pointer only has to be on the chart, and snaps to the nearest day. */}
          <rect
            x={M.l} y={M.t} width={plotW} height={plotH} fill="transparent"
            onPointerMove={e => {
              const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              const i = Math.floor(((e.clientX - box.left) / box.width) * N);
              setHover(Math.min(N - 1, Math.max(0, i)));
            }}
          />
        </svg>
      )}

      {hover !== null && hv && (
        <Tooltip left={cx(hover)} width={width}>
          <div className="text-[10px] font-bold text-white/50">{longDay(days[hover].date)}</div>
          <div className="text-base font-black text-white leading-tight">{money(hv.v)}</div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-white/40">
            <span className="inline-block w-3 h-[2px] rounded" style={{ background: SERIES, opacity: hv.projected ? 0.6 : 1 }} />
            {hv.projected ? 'Projected at current pace' : `Running total · +${money(days[hover].total)} that day`}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

export default function PayoutCharts({ days, todayKey, projectedEnd }: { days: PayoutDay[]; todayKey: string; projectedEnd: number }) {
  const all = days.flatMap(d => d.transactions.map(t => ({ ...t })));
  const newestFirst = [...all].sort((a, b) => b.time.localeCompare(a.time));
  const total = all.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <ChartFrame title="Revenue by day" subtitle="Each block is one transaction. Hover a day to see them.">
        <DailyColumns days={days} todayKey={todayKey} />
      </ChartFrame>

      <ChartFrame title="Cumulative revenue" subtitle="Running total for the period. The dotted line is the projection at the current pace.">
        <CumulativeLine days={days} todayKey={todayKey} projectedEnd={projectedEnd} />
      </ChartFrame>

      <details className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 group">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-white/40 select-none">
          All transactions ({all.length}) · {money(total)}
        </summary>
        <div className="mt-4 max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-white/25">
                <th className="py-2 pr-4 font-black">Date</th>
                <th className="py-2 pr-4 font-black">Plan</th>
                <th className="py-2 text-right font-black">Amount</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((t, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="py-2 pr-4 text-white/60 tabular-nums">
                    {new Date(t.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="py-2 pr-4 text-white/40">{planLabel(t.plan)}</td>
                  <td className="py-2 text-right font-bold text-white/80 tabular-nums">{money(t.amount)}</td>
                </tr>
              ))}
              {newestFirst.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-white/30">No transactions in this period yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
