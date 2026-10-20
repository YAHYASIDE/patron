import type { Config } from 'tailwindcss';

/**
 * Patron storefront design system.
 * Same brand identity as the admin and the API-side marketing: teal-green
 * primary, warm gold as the single bold accent, teal-biased neutrals.
 * Light-first, dark via `.dark`. Kept intentionally in step with
 * apps/admin/tailwind.config.ts so the two faces of Patron feel like one brand.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f4f6f6',
          100: '#eef2f1',
          200: '#dde5e3',
          300: '#c3d1cd',
          400: '#90a6a0',
          500: '#5d706c',
          600: '#435551',
          700: '#2a3a36',
          800: '#16241f',
          900: '#0d1a16',
          950: '#06110f',
        },
        teal: {
          DEFAULT: '#0d6d64',
          soft: '#2dd4bf',
          deep: '#07423c',
          ink: '#042f2b',
        },
        gold: {
          DEFAULT: '#c79a3a',
          soft: '#e9c45a',
          deep: '#a37d28',
        },
        ok: '#15803d',
        warn: '#b45309',
        bad: '#b91c1c',
      },
      fontFamily: {
        sans: ['var(--font-cairo)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(6,17,15,.05), 0 10px 30px rgba(6,17,15,.06)',
        float: '0 24px 60px rgba(6,17,15,.14)',
        glow: '0 10px 40px rgba(45,212,191,.22)',
      },
      maxWidth: {
        page: '1200px',
      },
    },
  },
  plugins: [],
};

export default config;
