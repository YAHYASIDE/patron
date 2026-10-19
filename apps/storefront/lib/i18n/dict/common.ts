import type { Dict } from '.';

/** The root layout, header, footer, banners, verification, phone field and shared lib messages. */
const dict: Dict = {
  fr: {
    // app/layout.tsx
    'patron — بطاقات وشحن رقمي فوري': 'patron — Cartes et recharges numériques instantanées',
    'اشترِ شحن الألعاب وبطاقات الهدايا والاشتراكات رقميًّا، وتسلّمها فورًا. أسعار واضحة ودفع آمن.':
      'Achetez des recharges de jeux, des cartes cadeaux et des abonnements en ligne, livrés instantanément. Prix clairs et paiement sécurisé.',

    // Header, ThemeToggle
    'الرئيسية': 'Accueil',
    'كل المنتجات': 'Tous les produits',
    'طلباتي': 'Mes commandes',
    'حسابي': 'Mon compte',
    'تسجيل الدخول': 'Se connecter',
    'السلّة': 'Panier',
    'القائمة': 'Menu',
    'الوضع الليلي': 'Mode sombre',
    'تبديل السمة': 'Changer de thème',
    'تبديل الوضع الليلي/النهاري': 'Basculer entre mode sombre et mode clair',

    // Footer
    'تسليم سريع وموثوق': 'Livraison rapide et fiable',
    'نسلّم طلبك بعد تأكيد الدفع، ويصلك إشعار فور التسليم.': 'Nous livrons votre commande après confirmation du paiement, et vous êtes notifié dès la livraison.',
    'دفع آمن': 'Paiement sécurisé',
    'بياناتك محميّة ومعاملاتك مشفّرة.': 'Vos données sont protégées et vos transactions chiffrées.',
    'دعم قريب منك': 'Une assistance proche de vous',
    'مساعدة سريعة عند أي استفسار.': 'Une aide rapide pour toute question.',
    'المنتجات': 'Produits',
    'كيف أشتري؟': 'Comment acheter ?',
    'الشروط والاسترجاع': 'Conditions et remboursements',

    // CurrencySwitch, lib/currency.ts, lib/regions.ts
    'البلد: {region}، العملة: {currency}': 'Pays : {region}, devise : {currency}',
    'بلدك': 'Votre pays',
    'ابحث عن بلدك': 'Cherchez votre pays',
    'لا يوجد بلد بهذا الاسم.': 'Aucun pays de ce nom.',
    'العملة': 'Devise',
    'اللغة': 'Langue',
    'دولار': 'Dollar',
    'فرنك': 'Franc CFA',
    'دينار': 'Dinar',
    'موريتانيا': 'Mauritanie',
    'مالي': 'Mali',
    'الجزائر': 'Algérie',
    'النيجر': 'Niger',
    'دولة أخرى': 'Autre pays',

    // lib/format.ts currency symbols (أوقية is also the ouguiya label above)
    'أوقية': 'MRU',
    'د.ج': 'DA',
    'د.ل': 'LYD',
    'ر.س': 'SAR',
    'د.إ': 'AED',
    'ج.م': 'EGP',

    // WakeBanner, Banners, WhatsApp
    'جارٍ تشغيل المتجر، لحظات وتظهر المنتجات…': 'Démarrage de la boutique, les produits arrivent dans un instant…',
    'العروض': 'Promotions',
    'راسلنا على واتساب': 'Écrivez-nous sur WhatsApp',
    'مستعجل؟ راسلنا على واتساب': 'Pressé ? Écrivez-nous sur WhatsApp',

    // VerifyBanner, VerifyPanel
    'حسابك غير موثّق': 'Votre compte n’est pas vérifié',
    'وثّقه الآن': 'Vérifiez-le maintenant',
    'انتهت جلستك. سجّل الدخول من جديد.': 'Votre session a expiré. Reconnectez-vous.',
    'تعذّر الاتصال بالخادم. حاول مرة أخرى.': 'Impossible de joindre le serveur. Réessayez.',
    'الرمز غير صحيح أو انتهت صلاحيته.': 'Code incorrect ou expiré.',
    'محاولات كثيرة. اطلب رمزًا جديدًا.': 'Trop de tentatives. Demandez un nouveau code.',
    'هذا الرقم مسجّل في حساب آخر.': 'Ce numéro est déjà associé à un autre compte.',
    'طلبت رموزًا كثيرة. انتظر بضع دقائق.': 'Vous avez demandé trop de codes. Patientez quelques minutes.',
    'الرمز 6 أرقام.': 'Le code comporte 6 chiffres.',
    'تخطَّ الآن': 'Passer pour l’instant',
    'ليس الآن، أكمل التسوّق': 'Pas maintenant, continuer mes achats',
    'تم توثيق حسابك': 'Votre compte est vérifié',
    'يمكنك الآن الشراء.': 'Vous pouvez maintenant acheter.',
    'وثّق رقم واتساب': 'Vérifiez votre numéro WhatsApp',
    'نرسل لك رمزًا من 6 أرقام على واتساب لنتأكد أن الرقم لك. يلزم ذلك مرة واحدة قبل الشراء.':
      'Nous vous envoyons un code à 6 chiffres sur WhatsApp pour confirmer que ce numéro est bien le vôtre. Une seule fois, avant votre premier achat.',
    'سيرسل لك المتجر الرمز على واتساب خلال دقائق. اكتبه هنا عند وصوله.':
      'La boutique vous enverra le code sur WhatsApp d’ici quelques minutes. Saisissez-le ici dès réception.',
    'الرقم:': 'Numéro :',
    'جارٍ الطلب…': 'Envoi de la demande…',
    'أرسل لي رمز التحقق': 'Envoyez-moi le code de vérification',
    'على الرقم': 'Envoyé au',
    'رمز التحقق': 'Code de vérification',
    'جارٍ التحقق…': 'Vérification…',
    'تحقّق': 'Vérifier',
    'لم يصلك الرمز؟ أعد الطلب': 'Code non reçu ? Redemandez-le',
    'توثيق الحساب': 'Vérification du compte',
    'إغلاق': 'Fermer',

    // PhoneField, lib/countries.ts
    'رقم واتساب': 'Numéro WhatsApp',
    'الدولة: {name}. تغيير الدولة': 'Pays : {name}. Changer de pays',
    'اختر الدولة': 'Choisir le pays',
    'اختر دولتك': 'Choisissez votre pays',
    'ابحث عن دولتك أو رمزها': 'Rechercher un pays ou son indicatif',
    'ابحث عن دولتك': 'Rechercher votre pays',
    'لا توجد دولة بهذا الاسم.': 'Aucun pays ne porte ce nom.',
    'اكتب رقم واتساب.': 'Saisissez votre numéro WhatsApp.',
    'الرقم الموريتاني 8 أرقام ويبدأ بـ 2 أو 3 أو 4.': 'Un numéro mauritanien compte 8 chiffres et commence par 2, 3 ou 4.',
    'تحقّق من الرقم.': 'Vérifiez le numéro.',

    // lib/api.ts, lib/hooks.ts
    'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حدّث الصفحة.':
      'Impossible de joindre le serveur. Vérifiez votre connexion Internet puis actualisez la page.',
    'خطأ {status}': 'Erreur {status}',
    'حدث خطأ غير متوقّع.': 'Une erreur inattendue s’est produite.',
  },
  en: {
    // app/layout.tsx
    'patron — بطاقات وشحن رقمي فوري': 'patron — Instant gift cards and digital top-ups',
    'اشترِ شحن الألعاب وبطاقات الهدايا والاشتراكات رقميًّا، وتسلّمها فورًا. أسعار واضحة ودفع آمن.':
      'Buy game top-ups, gift cards and subscriptions online and get them instantly. Clear prices and secure payment.',

    // Header, ThemeToggle
    'الرئيسية': 'Home',
    'كل المنتجات': 'All products',
    'طلباتي': 'My orders',
    'حسابي': 'My account',
    'تسجيل الدخول': 'Sign in',
    'السلّة': 'Cart',
    'القائمة': 'Menu',
    'الوضع الليلي': 'Dark mode',
    'تبديل السمة': 'Toggle theme',
    'تبديل الوضع الليلي/النهاري': 'Switch between dark and light mode',

    // Footer
    'تسليم سريع وموثوق': 'Fast, reliable delivery',
    'نسلّم طلبك بعد تأكيد الدفع، ويصلك إشعار فور التسليم.': 'We deliver your order once the payment is confirmed, and notify you as soon as it is delivered.',
    'دفع آمن': 'Secure payment',
    'بياناتك محميّة ومعاملاتك مشفّرة.': 'Your data is protected and your transactions are encrypted.',
    'دعم قريب منك': 'Support close to you',
    'مساعدة سريعة عند أي استفسار.': 'Quick help with any question.',
    'المنتجات': 'Products',
    'كيف أشتري؟': 'How to buy',
    'الشروط والاسترجاع': 'Terms & refunds',

    // CurrencySwitch, lib/currency.ts, lib/regions.ts
    'البلد: {region}، العملة: {currency}': 'Country: {region}, currency: {currency}',
    'بلدك': 'Your country',
    'ابحث عن بلدك': 'Search for your country',
    'لا يوجد بلد بهذا الاسم.': 'No country by that name.',
    'العملة': 'Currency',
    'اللغة': 'Language',
    'دولار': 'Dollar',
    'فرنك': 'CFA franc',
    'دينار': 'Dinar',
    'موريتانيا': 'Mauritania',
    'مالي': 'Mali',
    'الجزائر': 'Algeria',
    'النيجر': 'Niger',
    'دولة أخرى': 'Other country',

    // lib/format.ts currency symbols (أوقية is also the ouguiya label above)
    'أوقية': 'MRU',
    'د.ج': 'DA',
    'د.ل': 'LYD',
    'ر.س': 'SAR',
    'د.إ': 'AED',
    'ج.م': 'EGP',

    // WakeBanner, Banners, WhatsApp
    'جارٍ تشغيل المتجر، لحظات وتظهر المنتجات…': 'Starting the shop, products will appear in a moment…',
    'العروض': 'Deals',
    'راسلنا على واتساب': 'Message us on WhatsApp',
    'مستعجل؟ راسلنا على واتساب': 'In a hurry? Message us on WhatsApp',

    // VerifyBanner, VerifyPanel
    'حسابك غير موثّق': 'Your account is not verified',
    'وثّقه الآن': 'Verify it now',
    'انتهت جلستك. سجّل الدخول من جديد.': 'Your session has ended. Please sign in again.',
    'تعذّر الاتصال بالخادم. حاول مرة أخرى.': 'Couldn’t reach the server. Please try again.',
    'الرمز غير صحيح أو انتهت صلاحيته.': 'The code is wrong or has expired.',
    'محاولات كثيرة. اطلب رمزًا جديدًا.': 'Too many attempts. Ask for a new code.',
    'هذا الرقم مسجّل في حساب آخر.': 'This number is registered to another account.',
    'طلبت رموزًا كثيرة. انتظر بضع دقائق.': 'You’ve asked for too many codes. Wait a few minutes.',
    'الرمز 6 أرقام.': 'The code has 6 digits.',
    'تخطَّ الآن': 'Skip for now',
    'ليس الآن، أكمل التسوّق': 'Not now, keep shopping',
    'تم توثيق حسابك': 'Your account is verified',
    'يمكنك الآن الشراء.': 'You can shop now.',
    'وثّق رقم واتساب': 'Verify your WhatsApp number',
    'نرسل لك رمزًا من 6 أرقام على واتساب لنتأكد أن الرقم لك. يلزم ذلك مرة واحدة قبل الشراء.':
      'We send you a 6-digit code on WhatsApp to make sure the number is yours. You only need to do this once, before buying.',
    'سيرسل لك المتجر الرمز على واتساب خلال دقائق. اكتبه هنا عند وصوله.':
      'The shop will send you the code on WhatsApp within minutes. Type it here when it arrives.',
    'الرقم:': 'Number:',
    'جارٍ الطلب…': 'Requesting…',
    'أرسل لي رمز التحقق': 'Send me the verification code',
    'على الرقم': 'Sent to',
    'رمز التحقق': 'Verification code',
    'جارٍ التحقق…': 'Verifying…',
    'تحقّق': 'Verify',
    'لم يصلك الرمز؟ أعد الطلب': 'Didn’t get the code? Ask again',
    'توثيق الحساب': 'Account verification',
    'إغلاق': 'Close',

    // PhoneField, lib/countries.ts
    'رقم واتساب': 'WhatsApp number',
    'الدولة: {name}. تغيير الدولة': 'Country: {name}. Change country',
    'اختر الدولة': 'Choose the country',
    'اختر دولتك': 'Choose your country',
    'ابحث عن دولتك أو رمزها': 'Search for your country or its code',
    'ابحث عن دولتك': 'Search for your country',
    'لا توجد دولة بهذا الاسم.': 'No country by that name.',
    'اكتب رقم واتساب.': 'Enter your WhatsApp number.',
    'الرقم الموريتاني 8 أرقام ويبدأ بـ 2 أو 3 أو 4.': 'A Mauritanian number has 8 digits and starts with 2, 3 or 4.',
    'تحقّق من الرقم.': 'Check the number.',

    // lib/api.ts, lib/hooks.ts
    'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حدّث الصفحة.':
      'Couldn’t reach the server. Check your internet connection, then refresh the page.',
    'خطأ {status}': 'Error {status}',
    'حدث خطأ غير متوقّع.': 'An unexpected error occurred.',
  },
};

export default dict;
