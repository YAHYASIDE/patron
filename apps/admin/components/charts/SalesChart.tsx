'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { money, num } from '@/lib/format';

export type SalesPoint = { date: string; revenue: number; profit: number; orders: number };

/*
 * Sales and profit per day on one dollar axis. Plain SVG drawn at the box's
 * real pixel width (viewBox = measured size), so lines and text stay vector-sharp
 * on any screen density without scaling. Colours were checked with the dataviz
 * validator (colour-blind separation, contrast) for the light and dark surfaces.
 */
const REVENUE = 'stroke-[#00897b] dark:stroke-[#159e8c]';
const REVENUE_FILL = 'fill-[#00897b] dark:fill-[#159e8c]';
const PROFIT = 'stroke-[#b07d12] dark:stroke-[#b8870f]';
const PROFIT_FILL = 'fill-[#b07d12] dark:fill-[#b8870f]';
const KEY_REVENUE = 'bg-[#00897b] dark:bg-[#159e8c]';
const KEY_PROFIT = 'bg-[#b07d12] dark:bg-[#b8870f]';

const PAD = { top: 22, right: 14, bottom: 30, left: 46 };
const LOCALE = 'ar-EG-u-nu-latn';

/** Round tick steps: 1, 2, 2.5 or 5 × 10ⁿ. */
function ticks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** 0 / 25 / 1.2K: axis numbers stay short. */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${num(v / 1000, a >= 10_000 ? 0 : 1)}K`;
  return num(v, Number.isInteger(v) ? 0 : 1);
}

const dayLabel = (iso: string, long = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: long ? 'long' : 'short',
    timeZone: 'UTC',
    ...(long && { weekday: 'long' }),
  });

export default function SalesChart({ points, height = 240 }: { points: SalesPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  const geo = useMemo(() => {
    const values = points.flatMap((p) => [p.revenue, p.profit]);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const yTicks = ticks(lo, hi > lo ? hi : lo + 1, plotH < 200 ? 3 : 4);
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * plotH;
    const line = (key: 'revenue' | 'profit') =>
      points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    const revenueLine = line('revenue');
    const area = n
      ? `${revenueLine}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`
      : '';
    // x labels: as many as fit (~70px each), counted back from the latest day
    const fit = Math.max(2, Math.floor(plotW / 70));
    const every = Math.max(1, Math.ceil(n / fit));
    const xTicks = points.map((_, i) => i).filter((i) => (n - 1 - i) % every === 0);
    let peak = -1;
    points.forEach((p, i) => {
      if (p.revenue > 0 && (peak < 0 || p.revenue > points[peak].revenue)) peak = i;
    });
    return { x, y, yTicks, revenueLine, profitLine: line('profit'), area, xTicks, peak };
  }, [points, n, plotW, plotH]);

  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || n === 0) return;
    const rel = clientX - el.getBoundingClientRect().left - PAD.left;
    const i = n === 1 ? 0 : Math.round((rel / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    // the time axis runs left to right, so the arrow keys follow the screen
    const cur = active ?? n - 1;
    const next =
      e.key === 'ArrowRight'
        ? cur + 1
        : e.key === 'ArrowLeft'
          ? cur - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };

  const a = active !== null ? points[active] : null;
  const tipW = 172;
  // beside the crosshair, on the side with more room, so it never hides the day it describes
  const tipX = active !== null ? geo.x(active) : 0;
  const tipLeft = Math.min(
    Math.max(tipX > width / 2 ? tipX - tipW - 12 : tipX + 12, 0),
    Math.max(0, width - tipW),
  );
  const peak = geo.peak >= 0 ? points[geo.peak] : null;

  return (
    <div>
      {/* legend: always present for two series; the key mirrors the mark (a line) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className={`h-[3px] w-4 rounded-full ${KEY_REVENUE}`} aria-hidden />
          المبيعات
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={`h-[3px] w-4 rounded-full ${KEY_PROFIT}`} aria-hidden />
          الربح
        </span>
      </div>

      <div
        ref={box}
        dir="ltr"
        tabIndex={0}
        role="group"
        aria-label="رسم المبيعات والربح يومًا بيوم. استخدم السهمين يمينًا ويسارًا للتنقّل بين الأيام."
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onFocus={() => setActive((v) => v ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
        className="relative mt-3 touch-pan-y select-none rounded-xl"
        style={{ height }}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block overflow-visible"
            aria-hidden
            shapeRendering="geometricPrecision"
          >
            {/* recessive grid: solid hairlines, one step off the surface */}
            {geo.yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geo.y(t)}
                  y2={geo.y(t)}
                  stroke="rgb(var(--line))"
                  strokeWidth={t === 0 ? 1.25 : 1}
                  opacity={t === 0 ? 1 : 0.8}
                />
                <text
                  x={PAD.left - 8}
                  y={geo.y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="tnum"
                  fontSize={11}
                  fill="rgb(var(--muted))"
                >
                  {compact(t)}
                </text>
              </g>
            ))}
            {geo.xTicks.map((i) => (
              <text
                key={points[i].date}
                x={geo.x(i)}
                y={height - 8}
                textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="rgb(var(--muted))"
              >
                {dayLabel(points[i].date)}
              </text>
            ))}

            <path d={geo.area} className={REVENUE_FILL} opacity={0.1} />
            <path
              d={geo.revenueLine}
              className={REVENUE}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={geo.profitLine}
              className={PROFIT}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* the best day, labelled once */}
            {peak && active === null && (
              <g>
                <circle
                  cx={geo.x(geo.peak)}
                  cy={geo.y(peak.revenue)}
                  r={4}
                  className={REVENUE_FILL}
                  stroke="rgb(var(--surface))"
                  strokeWidth={2}
                />
                <text
                  x={Math.min(Math.max(geo.x(geo.peak), PAD.left + 30), width - PAD.right - 30)}
                  y={geo.y(peak.revenue) - 10}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={700}
                  fill="rgb(var(--text))"
                  className="tnum"
                >
                  {money(peak.revenue)}
                </text>
              </g>
            )}

            {/* single points have no line to show: draw them as dots */}
            {n === 1 &&
              active === null &&
              (['revenue', 'profit'] as const).map((k) => (
                <circle
                  key={k}
                  cx={geo.x(0)}
                  cy={geo.y(points[0][k])}
                  r={4}
                  className={k === 'revenue' ? REVENUE_FILL : PROFIT_FILL}
                  stroke="rgb(var(--surface))"
                  strokeWidth={2}
                />
              ))}

            {/* crosshair: snaps to the nearest day */}
            {a && active !== null && (
              <g>
                <line
                  x1={geo.x(active)}
                  x2={geo.x(active)}
                  y1={PAD.top - 6}
                  y2={PAD.top + plotH}
                  stroke="rgb(var(--muted))"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <circle
                  cx={geo.x(active)}
                  cy={geo.y(a.revenue)}
                  r={5}
                  className={REVENUE_FILL}
                  stroke="rgb(var(--surface))"
                  strokeWidth={2}
                />
                <circle
                  cx={geo.x(active)}
                  cy={geo.y(a.profit)}
                  r={5}
                  className={PROFIT_FILL}
                  stroke="rgb(var(--surface))"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>
        )}

        {a && (
          <div
            dir="rtl"
            className="surface pointer-events-none absolute top-0 z-10 rounded-xl px-3 py-2 text-[12.5px] shadow-float"
            style={{ left: tipLeft, width: tipW }}
          >
            <div className="text-[11.5px] text-muted">{dayLabel(a.date, true)}</div>
            <TipRow keyCls={KEY_REVENUE} label="المبيعات" value={money(a.revenue)} />
            <TipRow keyCls={KEY_PROFIT} label="الربح" value={money(a.profit)} />
            <div className="mt-0.5 text-[11.5px] text-muted">
              <span className="tnum font-semibold">{a.orders}</span> طلب
            </div>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {a
            ? `${dayLabel(a.date, true)}: المبيعات ${money(a.revenue)}، الربح ${money(a.profit)}، ${a.orders} طلب`
            : ''}
        </span>
      </div>
    </div>
  );
}

function TipRow({ keyCls, label, value }: { keyCls: string; label: string; value: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <span className={`h-[3px] w-3 rounded-full ${keyCls}`} aria-hidden />
        {label}
      </span>
      <span className="tnum font-extrabold">{value}</span>
    </div>
  );
}
