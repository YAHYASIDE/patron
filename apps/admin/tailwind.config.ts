import type { Config } from 'tailwindcss';

/**
 * Patron admin design system.
 * Brand identity shared with the storefront: teal-green primary, warm gold as
 * the single bold accent, teal-biased neutrals. Light-first, dark via `.dark`.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // teal-biased neutral ramp (surfaces, text, borders)
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
      },
      boxShadow: {
        card: '0 1px 2px rgba(6,17,15,.05), 0 10px 30px rgba(6,17,15,.06)',
        float: '0 24px 60px rgba(6,17,15,.14)',
      },
    },
  },
  plugins: [],
};

export default config;
