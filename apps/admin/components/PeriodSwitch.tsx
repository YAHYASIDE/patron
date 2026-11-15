'use client';

/** "Last N days" pills, styled like the reports range switch. */
export default function PeriodSwitch<T extends number>({
  options,
  value,
  onChange,
}: {
  options: readonly { days: T; label: string }[];
  value: T;
  onChange: (days: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="الفترة">
      {options.map((o) => (
        <button
          key={o.days}
          type="button"
          aria-pressed={value === o.days}
          onClick={() => onChange(o.days)}
          className={
            'rounded-full px-4 py-2 text-sm font-bold transition ' +
            (value === o.days ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
