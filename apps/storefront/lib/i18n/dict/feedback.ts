import type { Dict } from '.';

/** Learning from the shop: the "suggest a product" sheet and the page shown when something breaks. */
const dict: Dict = {
  fr: {
    // SuggestProduct, products "no results", Footer
    'اقترح منتجًا': 'Suggérer un produit',
    'لم تجد ما تبحث عنه؟ اقترح علينا': 'Vous ne trouvez pas ? Suggérez-le-nous',
    'أخبرنا بما تريد أن نضيفه إلى المتجر، وسنحاول توفيره.':
      "Dites-nous ce que vous aimeriez trouver dans la boutique, nous essaierons de l'ajouter.",
    'ما المنتج الذي تبحث عنه؟': 'Quel produit cherchez-vous ?',
    'مثال: بطاقة بلايستيشن 20 دولار': 'Ex. : carte PlayStation 20 dollars',
    'رقم هاتفك أو اسمك (اختياري)': 'Votre téléphone ou votre nom (facultatif)',
    'لنخبرك حين يتوفّر.': "Pour vous prévenir dès qu'il est disponible.",
    'اكتب {n} أحرف على الأقل.': 'Écrivez au moins {n} caractères.',
    'أرسل الاقتراح': 'Envoyer la suggestion',
    'شكرًا لك!': 'Merci !',
    'وصل اقتراحك إلى المتجر، وسنحاول توفيره قريبًا.':
      'Votre suggestion est bien arrivée, nous essaierons de la proposer bientôt.',

    // app/(shop)/error.tsx
    'حدث خطأ غير متوقّع': 'Une erreur inattendue est survenue',
    'تعذّر عرض هذه الصفحة. حاول مرة أخرى، وإن تكرّر الأمر فعُد إلى الرئيسية.':
      "Impossible d'afficher cette page. Réessayez ; si cela se reproduit, revenez à l'accueil.",
  },
  en: {
    // SuggestProduct, products "no results", Footer
    'اقترح منتجًا': 'Suggest a product',
    'لم تجد ما تبحث عنه؟ اقترح علينا': "Can't find it? Suggest it to us",
    'أخبرنا بما تريد أن نضيفه إلى المتجر، وسنحاول توفيره.':
      'Tell us what you would like the shop to add, and we will try to stock it.',
    'ما المنتج الذي تبحث عنه؟': 'What product are you looking for?',
    'مثال: بطاقة بلايستيشن 20 دولار': 'E.g. PlayStation card 20 dollars',
    'رقم هاتفك أو اسمك (اختياري)': 'Your phone or name (optional)',
    'لنخبرك حين يتوفّر.': 'So we can tell you when it arrives.',
    'اكتب {n} أحرف على الأقل.': 'Write at least {n} characters.',
    'أرسل الاقتراح': 'Send suggestion',
    'شكرًا لك!': 'Thank you!',
    'وصل اقتراحك إلى المتجر، وسنحاول توفيره قريبًا.':
      'Your suggestion reached the shop; we will try to add it soon.',

    // app/(shop)/error.tsx
    'حدث خطأ غير متوقّع': 'Something went wrong',
    'تعذّر عرض هذه الصفحة. حاول مرة أخرى، وإن تكرّر الأمر فعُد إلى الرئيسية.':
      'This page could not be shown. Try again; if it keeps happening, go back home.',
  },
};

export default dict;
