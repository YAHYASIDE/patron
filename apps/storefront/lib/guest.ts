'use client';

/**
 * A visitor who chose "skip for now" on the sign-in page browses as a guest;
 * signing in is asked again only to buy (checkout, orders and account pages
 * still require it).
 */
const KEY = 'patron_guest';

export function isGuest(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function browseAsGuest() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}
