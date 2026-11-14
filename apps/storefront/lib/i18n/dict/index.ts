/**
 * French and English for every Arabic text in the store, keyed by the Arabic
 * exactly as it appears in the code ("{name}" placeholders included). One file
 * per area keeps them readable; they are merged here.
 */
import common from './common';
import catalog from './catalog';
import checkout from './checkout';
import account from './account';
import pages from './pages';
import discovery from './discovery';
import myaccount from './myaccount';
import feedback from './feedback';
import auth2 from './auth2';
import usdt from './usdt';
import referral from './referral';
import ui2 from './ui2';
import markets from './markets';

export type Dict = { fr: Record<string, string>; en: Record<string, string> };

const parts: Dict[] = [common, catalog, checkout, account, pages, discovery, myaccount, feedback, auth2, usdt, referral, ui2, markets];

export const FR: Record<string, string> = Object.assign({}, ...parts.map((p) => p.fr));
export const EN: Record<string, string> = Object.assign({}, ...parts.map((p) => p.en));
