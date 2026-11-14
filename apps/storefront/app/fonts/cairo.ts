import localFont from 'next/font/local';

/**
 * Cairo, self-hosted. `next/font/google` downloaded it at build time, and
 * Google Fonts sometimes answers with extension-less `/l/font?kit=` links
 * that next/font cannot parse: builds failed at random, on CI and on Render.
 * These are Google's own Cairo v31 files (SIL Open Font License), one variable
 * face (weights 400–800) per script with Google's unicode ranges, so a page
 * only downloads the scripts it shows.
 *
 * Three families stacked in Tailwind's `sans`: Arabic first, then extended Latin,
 * then Latin. Only the last carries the metric-adjusted fallback; a fallback on
 * an earlier one would catch Latin text before Cairo's Latin face could.
 * next/font needs literal options, hence the repeated ranges.
 */
export const cairoArabic = localFont({
  src: './cairo-arabic.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-cairo-arabic',
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0600-06FF, U+0750-077F, U+0870-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC7, U+10EC9-10EEE, U+10EF0-10EFF, U+1EE00-1EEFF',
    },
  ],
});

export const cairoLatinExt = localFont({
  src: './cairo-latin-ext.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-cairo-latin-ext',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

export const cairoLatin = localFont({
  src: './cairo-latin.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-cairo-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

/** Class names for <html>: they define the three variables Tailwind's `sans` stacks. */
export const cairoVariables = [cairoArabic.variable, cairoLatinExt.variable, cairoLatin.variable].join(' ');
