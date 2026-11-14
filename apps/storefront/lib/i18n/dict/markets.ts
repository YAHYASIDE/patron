import type { Dict } from '.';

/** Country notices on a brand's page (lib/markets.ts, BrandPage). Arabic keys as written in the code. */
const dict: Dict = {
  fr: {
    'هذا المنتج غير متاح للاستخدام في بلدك. تأكّد قبل الشراء.':
      "Ce produit ne peut pas être utilisé dans votre pays. Vérifiez avant d'acheter.",
    'هذا المنتج يعمل فقط مع حساب من منطقته (مثل حساب أمريكي لبطاقة أمريكية). تأكّد من منطقة حسابك قبل الشراء.':
      "Ce produit ne fonctionne qu'avec un compte de sa région (par exemple un compte américain pour une carte américaine). Vérifiez la région de votre compte avant d'acheter.",
  },
  en: {
    'هذا المنتج غير متاح للاستخدام في بلدك. تأكّد قبل الشراء.':
      'This product cannot be used in your country. Check before you buy.',
    'هذا المنتج يعمل فقط مع حساب من منطقته (مثل حساب أمريكي لبطاقة أمريكية). تأكّد من منطقة حسابك قبل الشراء.':
      "This product only works with an account from its region (for example a US account for a US card). Check your account's region before you buy.",
  },
};

export default dict;
