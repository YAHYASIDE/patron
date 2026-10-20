/**
 * Linear-time email check (no backtracking regex; see the API's
 * common/validation/email.ts): one "@", no whitespace, a dot inside the domain;
 * `tld` asks for 2+ letters after the last dot.
 */
export function isEmail(value: string, opts: { max?: number; tld?: boolean } = {}): boolean {
  const max = opts.max ?? 254;
  if (!value || value.length > max || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1 || dot === domain.length - 1) return false;
  return !opts.tld || /^[a-z]{2,}$/i.test(domain.slice(dot + 1));
}
