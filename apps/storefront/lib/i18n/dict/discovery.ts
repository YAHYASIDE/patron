import type { Dict } from '.';

/**
 * The opening screen, the installable app, the header menu and bell, search
 * suggestions, favourites, recently viewed, best sellers, trust numbers,
 * reviews, alerts, saved account details, sharing, countdowns and rates.
 */
const dict: Dict = {
  fr: {
    // Splash, InstallPrompt
    'بطاقات وشحن رقمي موثوق': 'Cartes et recharges numériques de confiance',
    'ثبّت تطبيق patron': "Installez l'application patron",
    'افتح المتجر من شاشتك الرئيسية بلمسة، حتى مع اتصال ضعيف.':
      "Ouvrez la boutique depuis votre écran d'accueil en un geste, même avec une connexion faible.",
    'اضغط زر المشاركة': 'Touchez le bouton Partager',
    'ثم «إضافة إلى الشاشة الرئيسية».': "puis « Sur l'écran d'accueil ».",
    'تثبيت': 'Installer',
    'ليس الآن': 'Plus tard',

    // Header menu, NotificationBell
    'أكوادي': 'Mes codes',
    'المفضّلة': 'Favoris',
    'الإشعارات': 'Notifications',
    'المحفظة': 'Portefeuille',
    'الدعم': 'Assistance',
    'الإشعارات ({n} غير مقروءة)': 'Notifications ({n} non lues)',

    // home: search, rows, trust numbers
    'اقتراحات': 'Suggestions',
    'شاهدتها مؤخرًا': 'Vus récemment',
    'الأكثر مبيعًا هذا الشهر': 'Meilleures ventes du mois',
    'أرقام المتجر': 'La boutique en chiffres',
    'طلبات سُلِّمت': 'commandes livrées',
    'عملاء يثقون بنا': 'clients nous font confiance',

    // tiles and brand page
    'جديد': 'Nouveau',
    'أضف إلى المفضّلة': 'Ajouter aux favoris',
    'أزل من المفضّلة': 'Retirer des favoris',
    'مشاركة': 'Partager',
    'واتساب': 'WhatsApp',
    'نسخ الرابط': 'Copier le lien',
    'نُسخ الرابط': 'Lien copié',
    '{title} على patron': '{title} sur patron',
    'عادة خلال {n} دقيقة': 'Généralement en {n} min',
    'عادة خلال {n} ساعة': 'Généralement en {n} h',
    'بياناتك المحفوظة': 'Vos informations enregistrées',
    'احفظ هذه البيانات لطلباتي القادمة': 'Enregistrer ces informations pour mes prochaines commandes',

    // alerts
    'أعلمني عند انخفاض السعر': 'Me prévenir si le prix baisse',
    'سنُعلمك عند انخفاض السعر': 'Nous vous préviendrons si le prix baisse',
    'فئات غير متوفّرة الآن:': 'Montants indisponibles pour le moment :',
    'أعلمني عند توفّر {name}': 'Me prévenir quand {name} revient',
    'سنُعلمك عند توفّر {name}': 'Nous vous préviendrons quand {name} revient',
    'تعذّر حفظ التنبيه. حاول مرة أخرى.': "Impossible d'enregistrer l'alerte. Réessayez.",

    // reviews
    'آراء العملاء': 'Avis des clients',
    '{n} تقييم': '{n} avis',
    'التقييم {avg} من 5 ({n} تقييم)': 'Note {avg} sur 5 ({n} avis)',
    'ردّ المتجر': 'Réponse de la boutique',
    'عرض المزيد من التقييمات': "Voir plus d'avis",

    // Countdown, CurrencySwitch
    'ينتهي خلال': 'Se termine dans',
    'ينتهي خلال {d} يوم و{h} ساعة': 'Se termine dans {d} j {h} h',
    'سعر الصرف': 'Taux de change',
  },
  en: {
    // Splash, InstallPrompt
    'بطاقات وشحن رقمي موثوق': 'Trusted digital cards and top-ups',
    'ثبّت تطبيق patron': 'Install the patron app',
    'افتح المتجر من شاشتك الرئيسية بلمسة، حتى مع اتصال ضعيف.':
      'Open the shop from your home screen in one tap, even on a weak connection.',
    'اضغط زر المشاركة': 'Tap the Share button',
    'ثم «إضافة إلى الشاشة الرئيسية».': 'then "Add to Home Screen".',
    'تثبيت': 'Install',
    'ليس الآن': 'Not now',

    // Header menu, NotificationBell
    'أكوادي': 'My codes',
    'المفضّلة': 'Favourites',
    'الإشعارات': 'Notifications',
    'المحفظة': 'Wallet',
    'الدعم': 'Support',
    'الإشعارات ({n} غير مقروءة)': 'Notifications ({n} unread)',

    // home: search, rows, trust numbers
    'اقتراحات': 'Suggestions',
    'شاهدتها مؤخرًا': 'Recently viewed',
    'الأكثر مبيعًا هذا الشهر': 'Best sellers this month',
    'أرقام المتجر': 'The shop in numbers',
    'طلبات سُلِّمت': 'orders delivered',
    'عملاء يثقون بنا': 'customers trust us',

    // tiles and brand page
    'جديد': 'New',
    'أضف إلى المفضّلة': 'Add to favourites',
    'أزل من المفضّلة': 'Remove from favourites',
    'مشاركة': 'Share',
    'واتساب': 'WhatsApp',
    'نسخ الرابط': 'Copy link',
    'نُسخ الرابط': 'Link copied',
    '{title} على patron': '{title} on patron',
    'عادة خلال {n} دقيقة': 'Usually within {n} min',
    'عادة خلال {n} ساعة': 'Usually within {n} h',
    'بياناتك المحفوظة': 'Your saved details',
    'احفظ هذه البيانات لطلباتي القادمة': 'Save these details for my next orders',

    // alerts
    'أعلمني عند انخفاض السعر': 'Tell me when the price drops',
    'سنُعلمك عند انخفاض السعر': "We'll tell you when the price drops",
    'فئات غير متوفّرة الآن:': 'Amounts out of stock right now:',
    'أعلمني عند توفّر {name}': 'Tell me when {name} is back',
    'سنُعلمك عند توفّر {name}': "We'll tell you when {name} is back",
    'تعذّر حفظ التنبيه. حاول مرة أخرى.': "Couldn't save the alert. Please try again.",

    // reviews
    'آراء العملاء': 'Customer reviews',
    '{n} تقييم': '{n} reviews',
    'التقييم {avg} من 5 ({n} تقييم)': 'Rated {avg} out of 5 ({n} reviews)',
    'ردّ المتجر': "The shop's reply",
    'عرض المزيد من التقييمات': 'Show more reviews',

    // Countdown, CurrencySwitch
    'ينتهي خلال': 'Ends in',
    'ينتهي خلال {d} يوم و{h} ساعة': 'Ends in {d} d {h} h',
    'سعر الصرف': 'Exchange rate',
  },
};

export default dict;
