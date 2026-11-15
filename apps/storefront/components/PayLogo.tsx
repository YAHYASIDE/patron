import { BASE } from '@/lib/api';
import { PAY_LOGOS, colourOf, initials } from '@/lib/paylogos';

/**
 * A payment method's logo: one the owner uploaded ("upload:<id>"), a built-in
 * mark, or letters on a colour derived from the name.
 */
export default function PayLogo({ logo, name, size = 40 }: { logo?: string; name: string; size?: number }) {
  const box = { width: size, height: size };
  if (logo?.startsWith('upload:')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by the API, any size
      <img
        src={`${BASE}/uploads/${logo.slice(7)}`}
        alt={name}
        style={box}
        className="flex-none rounded-xl bg-white object-contain"
      />
    );
  }
  const spec = (logo && PAY_LOGOS[logo]) || { bg: colourOf(name), fg: '#ffffff', text: initials(name) };
  return (
    <span
      role="img"
      aria-label={name}
      style={{ ...box, background: spec.bg, color: spec.fg }}
      className="grid flex-none place-items-center overflow-hidden rounded-xl ring-1 ring-black/5"
    >
      {spec.path ? (
        <svg
          viewBox="0 0 24 24"
          width={spec.bleed ? size : size * 0.6}
          height={spec.bleed ? size : size * 0.6}
          fill="currentColor"
          fillRule="evenodd"
          aria-hidden
        >
          <path d={spec.path} />
        </svg>
      ) : (
        <span
          className="font-extrabold leading-none tracking-tight"
          style={{ fontSize: size * ((spec.text?.length ?? 1) > 2 ? 0.26 : 0.42) }}
        >
          {spec.text}
        </span>
      )}
    </span>
  );
}
