/**
 * Customer guidance per brand, in Arabic, French and English: where to find the
 * account value a top-up needs ("help", by input key), what to check before
 * paying, how to use what was delivered, and the one costly mistake.
 * Written from the October 2026 product research (official pages and resellers).
 * Applied by catalog pack v5 (catalog-pack.ts) to products that have no guide.
 */
export type Text = { ar: string; fr: string; en: string };
export type BrandGuide = { help?: Record<string, Text>; before?: Text[]; after?: Text[]; warning?: Text };

export const GUIDES: Record<string, BrandGuide> = {
  pubg: {
    help: {
      player_id: {
        ar: 'افتح PUBG Mobile ← اضغط على صورتك أعلى اليسار ← رقم الـ ID في بطاقة المعلومات الأساسية (عادة 10 أرقام). اضغط عليه مطولاً لنسخه.',
        fr: "Ouvrez PUBG Mobile → touchez votre avatar en haut à gauche → l'ID figure dans la carte « Infos de base » (souvent 10 chiffres). Appui long pour le copier.",
        en: 'Open PUBG Mobile → tap your avatar (top-left) → the ID is in the Basic Info card (usually 10 digits). Long-press it to copy.',
      },
    },
    before: [
      {
        ar: 'انسخ رقم الـ ID من ملفك في اللعبة.',
        fr: 'Copiez votre ID depuis votre profil dans le jeu.',
        en: 'Copy your ID from your in-game profile.',
      },
      {
        ar: 'الصقه في الخانة وراجعه رقماً رقماً قبل الدفع.',
        fr: 'Collez-le dans le champ et vérifiez-le chiffre par chiffre avant de payer.',
        en: 'Paste it in the field and check it digit by digit before paying.',
      },
      {
        ar: 'هذه الباقة لنسخة PUBG Mobile العالمية فقط؛ النسخ الكورية واليابانية والفيتنامية وBGMI غير مدعومة.',
        fr: 'Ce pack est réservé à PUBG Mobile version mondiale : les versions coréenne, japonaise, vietnamienne et BGMI ne sont pas prises en charge.',
        en: 'This pack is for PUBG Mobile Global only; the KR, JP, VN and BGMI versions are not supported.',
      },
      {
        ar: 'لا نطلب منك كلمة المرور أو رمز التحقق أبداً.',
        fr: 'Nous ne vous demandons jamais votre mot de passe ni de code de vérification.',
        en: 'We never ask for your password or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تُضاف الشدّات (UC) إلى حسابك مباشرة خلال دقائق، دون إدخال أي كود.',
        fr: 'Les UC sont ajoutés directement à votre compte en quelques minutes, sans code à saisir.',
        en: 'Your UC is added straight to your account within minutes; no code to enter.',
      },
      {
        ar: 'إذا لم تظهر، أعد تشغيل اللعبة ثم راسلنا مع رقم الطلب.',
        fr: "S'ils n'apparaissent pas, relancez le jeu puis contactez-nous avec votre numéro de commande.",
        en: "If it doesn't show up, restart the game and message us with your order number.",
      },
    ],
    warning: {
      ar: 'الشحن إلى ID خاطئ يذهب لحساب آخر ولا يمكن استرجاعه.',
      fr: 'Une recharge envoyée sur un mauvais ID part sur un autre compte et ne peut pas être remboursée.',
      en: "A top-up sent to the wrong ID goes to someone else's account and cannot be refunded.",
    },
  },
  freefire: {
    help: {
      player_id: {
        ar: 'افتح Free Fire ← اضغط على صورتك أعلى اليسار ← الرقم الظاهر تحت اسمك هو رقم اللاعب.',
        fr: 'Ouvrez Free Fire → touchez votre avatar en haut à gauche → le numéro sous votre pseudo est votre ID joueur.',
        en: 'Open Free Fire → tap your avatar (top-left) → the number under your username is your Player ID.',
      },
    },
    before: [
      {
        ar: 'انسخ رقم اللاعب من ملفك في اللعبة.',
        fr: 'Copiez votre ID joueur depuis votre profil dans le jeu.',
        en: 'Copy your Player ID from your in-game profile.',
      },
      {
        ar: 'الصقه في الخانة وراجعه رقماً رقماً قبل الدفع.',
        fr: 'Collez-le dans le champ et vérifiez-le chiffre par chiffre avant de payer.',
        en: 'Paste it in the field and check it digit by digit before paying.',
      },
      {
        ar: 'تأكد أن منطقة الباقة (الشرق الأوسط أو عالمي) تطابق منطقة حسابك.',
        fr: 'Vérifiez que la région du pack (Moyen-Orient ou Global) correspond à celle de votre compte.',
        en: "Make sure the pack region (Middle East or Global) matches your account's region.",
      },
      {
        ar: 'لا نحتاج كلمة المرور ولا حساب فيسبوك أو جوجل.',
        fr: "Nous n'avons besoin ni de votre mot de passe ni de votre compte Facebook ou Google.",
        en: 'We never need your password or your Facebook/Google login.',
      },
    ],
    after: [
      {
        ar: 'تُضاف الجواهر إلى حسابك مباشرة خلال دقائق.',
        fr: 'Les diamants sont ajoutés directement à votre compte en quelques minutes.',
        en: 'Your diamonds are added straight to your account within minutes.',
      },
      {
        ar: 'إذا استلمت كوداً بدل الشحن المباشر: ادخل shop.garena.sg ← اختر Free Fire ← سجّل برقم اللاعب ← «Redeem» والصق الكود.',
        fr: 'Si vous recevez un code : allez sur shop.garena.sg → Free Fire → connectez-vous avec votre ID joueur → « Redeem » et collez le code.',
        en: 'If you get a code instead: go to shop.garena.sg → Free Fire → log in with your Player ID → Redeem, and paste the code.',
      },
    ],
    warning: {
      ar: 'الشحن إلى رقم لاعب خاطئ لا يمكن استرجاعه.',
      fr: 'Une recharge envoyée sur un mauvais ID joueur ne peut pas être remboursée.',
      en: 'A top-up sent to the wrong Player ID cannot be refunded.',
    },
  },
  mlbb: {
    help: {
      user_id: {
        ar: 'افتح Mobile Legends ← اضغط على صورتك أعلى اليسار ← سترى رقماً مثل 12345678 (1234). الرقم الطويل قبل القوسين هو User ID.',
        fr: 'Ouvrez Mobile Legends → touchez votre avatar en haut à gauche → vous verrez par exemple 12345678 (1234). Le long numéro avant les parenthèses est le User ID.',
        en: "Open Mobile Legends → tap your avatar (top-left) → you'll see something like 12345678 (1234). The long number before the brackets is the User ID.",
      },
      zone_id: {
        ar: 'هو الرقم القصير بين القوسين بجانب User ID، مثل (1234).',
        fr: "C'est le petit numéro entre parenthèses à côté du User ID, par exemple (1234).",
        en: 'The short number in brackets next to the User ID, e.g. (1234).',
      },
    },
    before: [
      {
        ar: 'اكتب الرقم الطويل في خانة User ID والرقم الذي بين القوسين في خانة Zone ID.',
        fr: 'Saisissez le long numéro dans « User ID » et celui entre parenthèses dans « Zone ID ».',
        en: 'Enter the long number as User ID and the number in brackets as Zone ID.',
      },
      {
        ar: 'راجع الرقمين معاً قبل الدفع؛ الاسم المستعار وحده لا يكفي.',
        fr: 'Vérifiez les deux numéros avant de payer : le pseudo seul ne suffit pas.',
        en: 'Check both numbers before paying; your nickname alone is not enough.',
      },
      {
        ar: 'لا نطلب منك كلمة المرور أو رمز التحقق أبداً.',
        fr: 'Nous ne vous demandons jamais votre mot de passe ni de code de vérification.',
        en: 'We never ask for your password or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تصل الجواهر إلى حسابك مباشرة خلال دقائق.',
        fr: 'Les diamants arrivent directement sur votre compte en quelques minutes.',
        en: 'Your diamonds arrive in your account within minutes.',
      },
      {
        ar: 'إن لم تظهر، أعد تشغيل اللعبة وتحقق من البريد داخل اللعبة.',
        fr: "S'ils n'apparaissent pas, relancez le jeu et consultez la messagerie du jeu.",
        en: "If they don't show up, restart the game and check your in-game mail.",
      },
    ],
    warning: {
      ar: 'User ID أو Zone ID خاطئ يرسل الجواهر إلى حساب آخر ولا يمكن استرجاعها.',
      fr: 'Un User ID ou un Zone ID erroné envoie les diamants sur un autre compte, sans remboursement possible.',
      en: 'A wrong User ID or Zone ID sends the diamonds to another account, with no refund.',
    },
  },
  codm: {
    help: {
      player_id: {
        ar: 'افتح Call of Duty: Mobile ← اضغط على اسمك أعلى الشاشة لفتح ملف اللاعب ← رقم UID يظهر تحت اسمك. انسخه كاملاً.',
        fr: "Ouvrez Call of Duty: Mobile → touchez votre nom en haut de l'écran pour ouvrir votre profil → l'UID s'affiche sous votre nom. Copiez-le en entier.",
        en: 'Open Call of Duty: Mobile → tap your name at the top to open your Player Profile → the UID is under your name. Copy all of it.',
      },
    },
    before: [
      {
        ar: 'انسخ رقم UID كاملاً من ملف اللاعب.',
        fr: "Copiez l'UID complet depuis votre profil joueur.",
        en: 'Copy your full UID from your Player Profile.',
      },
      {
        ar: 'الصقه في الخانة وراجعه رقماً رقماً قبل الدفع.',
        fr: 'Collez-le dans le champ et vérifiez-le chiffre par chiffre avant de payer.',
        en: 'Paste it in the field and check it digit by digit before paying.',
      },
      {
        ar: 'لا نطلب أبداً كلمة المرور أو البريد أو رمز التحقق.',
        fr: 'Nous ne demandons jamais votre mot de passe, votre e-mail ni de code de vérification.',
        en: 'We never ask for your password, email or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تُضاف نقاط CP إلى حسابك خلال دقائق، وقد تتأخر حتى 30 دقيقة.',
        fr: "Les CP sont crédités en quelques minutes, parfois jusqu'à 30 minutes.",
        en: 'Your CP is added within minutes, sometimes up to 30 minutes.',
      },
      {
        ar: 'أعد فتح اللعبة وتحقق من رصيد CP في المتجر.',
        fr: 'Rouvrez le jeu et vérifiez votre solde de CP dans la boutique.',
        en: 'Reopen the game and check your CP balance in the store.',
      },
    ],
    warning: {
      ar: 'الشحن إلى UID خاطئ لا يمكن استرجاعه، ومن يطلب كلمة مرورك باسمنا فهو محتال.',
      fr: 'Une recharge sur un mauvais UID ne peut pas être remboursée, et toute personne qui vous demande votre mot de passe en notre nom est un escroc.',
      en: 'A top-up to the wrong UID cannot be refunded, and anyone asking for your password in our name is a scammer.',
    },
  },
  genshin: {
    help: {
      uid: {
        ar: 'رقم UID يظهر دائماً أسفل يمين شاشة اللعبة، أو من قائمة Paimon ← الملف الشخصي.',
        fr: "L'UID est toujours affiché en bas à droite de l'écran de jeu, ou dans le menu Paimon → Profil.",
        en: 'Your UID is always shown at the bottom-right of the game screen, or in the Paimon menu → Profile.',
      },
      server: {
        ar: 'يُحدَّد السيرفر من أول رقم في UID: 6 أمريكا، 7 أوروبا، 8 أو 18 آسيا، و9 عادةً تايوان/هونغ كونغ/ماكاو. سيرفرات الصين (UID يبدأ بـ 1 أو 2 أو 5) غير مدعومة.',
        fr: "Le serveur dépend du premier chiffre de l'UID : 6 Amérique, 7 Europe, 8 ou 18 Asie, et 9 en principe TW/HK/MO. Les serveurs de Chine continentale (UID commençant par 1, 2 ou 5) ne sont pas pris en charge.",
        en: 'The server follows the first digit of your UID: 6 America, 7 Europe, 8 or 18 Asia, and 9 usually TW/HK/MO. Mainland China servers (UID starting with 1, 2 or 5) are not supported.',
      },
    },
    before: [
      {
        ar: 'انسخ رقم UID من أسفل يمين الشاشة.',
        fr: "Copiez votre UID en bas à droite de l'écran.",
        en: 'Copy your UID from the bottom-right of the screen.',
      },
      {
        ar: 'تأكد أن السيرفر المختار يطابق أول رقم في UID.',
        fr: 'Vérifiez que le serveur choisi correspond au premier chiffre de votre UID.',
        en: 'Check that the selected server matches the first digit of your UID.',
      },
      {
        ar: 'بطاقة Welkin: لا يمكن شراؤها إذا تجاوز رصيدك منها 180 يوماً.',
        fr: "Carte Welkin : impossible de l'acheter si vous avez déjà plus de 180 jours en réserve.",
        en: "Welkin Moon: it can't be bought if you already have more than 180 days stacked.",
      },
      {
        ar: 'لا نحتاج كلمة المرور أبداً.',
        fr: "Nous n'avons jamais besoin de votre mot de passe.",
        en: 'We never need your password.',
      },
    ],
    after: [
      {
        ar: 'تصل بلورات Genesis Crystals إلى حسابك خلال دقائق، ويمكنك تحويلها إلى Primogems من المتجر.',
        fr: 'Les Genesis Crystals arrivent en quelques minutes ; vous pouvez les convertir en Primogems dans la boutique.',
        en: 'Genesis Crystals arrive within minutes; you can convert them to Primogems in the shop.',
      },
      {
        ar: 'بطاقة Welkin: تحصل على 300 بلورة فوراً ثم 90 Primogem يومياً لمدة 30 يوماً، بشرط الدخول إلى اللعبة كل يوم.',
        fr: 'Carte Welkin : 300 cristaux tout de suite, puis 90 Primogems par jour pendant 30 jours, à condition de vous connecter chaque jour.',
        en: 'Welkin Moon: 300 crystals right away, then 90 Primogems a day for 30 days, as long as you log in each day.',
      },
    ],
    warning: {
      ar: 'راجع UID والسيرفر قبل الدفع: الشحن إلى UID خاطئ لا يمكن استرجاعه.',
      fr: "Vérifiez l'UID et le serveur avant de payer : une recharge sur un mauvais UID ne peut pas être remboursée.",
      en: 'Check your UID and server before paying: a top-up to the wrong UID cannot be refunded.',
    },
  },
  yalla: {
    help: {
      player_id: {
        ar: 'افتح يلا لودو ← اضغط على صورتك لفتح الملف الشخصي ← انسخ الرقم الظاهر بجانب ID.',
        fr: 'Ouvrez Yalla Ludo → touchez votre photo pour ouvrir votre profil → copiez le numéro affiché à côté de « ID ».',
        en: 'Open Yalla Ludo → tap your picture to open your profile → copy the number next to ID.',
      },
    },
    before: [
      {
        ar: 'انسخ رقم الـ ID من ملفك الشخصي في اللعبة.',
        fr: 'Copiez votre ID depuis votre profil dans le jeu.',
        en: 'Copy your ID from your in-game profile.',
      },
      {
        ar: 'الصقه في الخانة وراجعه رقماً رقماً قبل الدفع.',
        fr: 'Collez-le dans le champ et vérifiez-le chiffre par chiffre avant de payer.',
        en: 'Paste it in the field and check it digit by digit before paying.',
      },
      {
        ar: 'لا نطلب منك كلمة المرور أو رمز التحقق أبداً.',
        fr: 'Nous ne vous demandons jamais votre mot de passe ni de code de vérification.',
        en: 'We never ask for your password or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تُضاف الجواهر إلى حسابك خلال دقائق.',
        fr: 'Les diamants sont ajoutés à votre compte en quelques minutes.',
        en: 'Your diamonds are added to your account within minutes.',
      },
      {
        ar: 'افتح المتجر داخل اللعبة لتتأكد من الرصيد.',
        fr: 'Ouvrez la boutique du jeu pour vérifier votre solde.',
        en: 'Open the in-game store to check your balance.',
      },
    ],
    warning: {
      ar: 'الرقم الخاطئ يعني شحن حساب شخص آخر دون استرجاع.',
      fr: "Un mauvais ID signifie recharger le compte de quelqu'un d'autre, sans remboursement.",
      en: "A wrong ID means topping up someone else's account, with no refund.",
    },
  },
  jawaker: {
    help: {
      player_id: {
        ar: 'افتح جواكر ← اضغط على أيقونة الإعدادات (الترس) ← «رقم اللاعب» يظهر أسفل صفحة الإعدادات أو بيانات الحساب. اكتبه بدون علامة #.',
        fr: "Ouvrez Jawaker → touchez l'icône Paramètres (roue dentée) → le « numéro de joueur » figure en bas des paramètres ou des infos du compte. Saisissez-le sans le #.",
        en: 'Open Jawaker → tap the Settings (gear) icon → your Player Number is at the bottom of Settings / Account details. Enter it without the #.',
      },
    },
    before: [
      {
        ar: 'انسخ «رقم اللاعب» من الإعدادات؛ اسم المستخدم لا يكفي.',
        fr: "Copiez votre « numéro de joueur » dans les paramètres : le nom d'utilisateur ne suffit pas.",
        en: 'Copy your Player Number from Settings; your username is not enough.',
      },
      {
        ar: 'الصقه بدون علامة # وراجعه قبل الدفع.',
        fr: 'Collez-le sans le # et vérifiez-le avant de payer.',
        en: 'Paste it without the # and check it before paying.',
      },
      {
        ar: 'لا نطلب منك كلمة المرور أو رمز التحقق أبداً.',
        fr: 'Nous ne vous demandons jamais votre mot de passe ni de code de vérification.',
        en: 'We never ask for your password or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تُضاف التوكنز إلى حسابك خلال 1 إلى 15 دقيقة، وتجد رصيدك داخل التطبيق.',
        fr: "Les jetons arrivent sur votre compte en 1 à 15 minutes ; votre solde s'affiche dans l'application.",
        en: "Your tokens arrive within 1 to 15 minutes; you'll see the balance in the app.",
      },
      {
        ar: 'يمكنك استخدامها لشراء أو تجديد اشتراك «باشا» من المتجر.',
        fr: "Vous pouvez les utiliser pour acheter ou renouveler l'abonnement « Pasha » dans la boutique.",
        en: 'You can use them to buy or renew Pasha from the store.',
      },
    ],
    warning: {
      ar: 'رقم لاعب خاطئ يعني شحن حساب آخر ولا يمكن استرجاعه.',
      fr: 'Un mauvais numéro de joueur crédite un autre compte, sans remboursement possible.',
      en: 'A wrong Player Number tops up another account and cannot be refunded.',
    },
  },
  bigo: {
    help: {
      bigo_id: {
        ar: 'افتح Bigo Live ← اذهب إلى صفحتك «أنا» (Me)؛ المعرّف يظهر عادةً تحت اسمك بجانب ID. قد يحتوي على حروف وأرقام.',
        fr: "Ouvrez Bigo Live → allez sur votre page « Moi » (Me) ; l'identifiant apparaît en général sous votre nom, à côté de « ID ». Il peut contenir des lettres et des chiffres.",
        en: 'Open Bigo Live → go to your Me page; the Bigo ID is usually shown under your name next to ID. It can contain letters and numbers.',
      },
    },
    before: [
      {
        ar: 'انسخ Bigo ID من صفحتك الشخصية.',
        fr: 'Copiez votre Bigo ID depuis votre page de profil.',
        en: 'Copy your Bigo ID from your profile page.',
      },
      {
        ar: 'الصقه وراجعه حرفاً حرفاً قبل الدفع.',
        fr: 'Collez-le et vérifiez-le caractère par caractère avant de payer.',
        en: 'Paste it and check it character by character before paying.',
      },
      {
        ar: 'لا نطلب منك كلمة المرور أو رمز التحقق أبداً.',
        fr: 'Nous ne vous demandons jamais votre mot de passe ni de code de vérification.',
        en: 'We never ask for your password or a verification code.',
      },
    ],
    after: [
      {
        ar: 'تُضاف الماسات إلى محفظتك في التطبيق خلال دقائق (أنا ← المحفظة).',
        fr: 'Les diamants arrivent dans votre portefeuille Bigo en quelques minutes (Moi → Portefeuille).',
        en: 'Your diamonds land in your in-app wallet within minutes (Me → Wallet).',
      },
    ],
    warning: {
      ar: 'المعرّف الخاطئ يرسل الماسات لشخص آخر ولا يمكن استرجاعها.',
      fr: "Un identifiant erroné envoie les diamants à quelqu'un d'autre, sans remboursement possible.",
      en: 'A wrong Bigo ID sends the diamonds to someone else, with no refund.',
    },
  },
  tiktok: {
    help: {
      username: {
        ar: 'افتح تيك توك ← الملف الشخصي (أسفل اليمين) ← الاسم الذي يبدأ بـ @ تحت صورتك.',
        fr: 'Ouvrez TikTok → Profil (en bas à droite) → le nom qui commence par @ sous votre photo.',
        en: 'Open TikTok → Profile (bottom-right) → the @handle under your photo.',
      },
    },
    before: [
      {
        ar: 'انسخ اسم المستخدم كما يظهر تحت صورتك (يبدأ بـ @).',
        fr: "Copiez votre nom d'utilisateur tel qu'il apparaît sous votre photo (il commence par @).",
        en: 'Copy your username exactly as shown under your photo (it starts with @).',
      },
      {
        ar: 'راجعه حرفاً حرفاً قبل الدفع.',
        fr: 'Vérifiez-le lettre par lettre avant de payer.',
        en: 'Check it letter by letter before paying.',
      },
      {
        ar: 'لن نطلب أبداً كلمة المرور أو رمز التحقق (SMS).',
        fr: 'Nous ne vous demanderons jamais votre mot de passe ni le code reçu par SMS.',
        en: 'We will never ask for your password or SMS code.',
      },
    ],
    after: [
      {
        ar: 'افتح تيك توك ← الملف الشخصي ← القائمة (☰) ← الرصيد (Balance) لترى العملات.',
        fr: 'Ouvrez TikTok → Profil → menu (☰) → Solde (Balance) pour voir vos pièces.',
        en: 'Open TikTok → Profile → menu (☰) → Balance to see your coins.',
      },
      {
        ar: 'إذا استلمت كود بطاقة: افتح tiktok.com/coin من المتصفح، سجّل الدخول، وأدخل الكود.',
        fr: 'Si vous recevez un code carte : ouvrez tiktok.com/coin dans le navigateur, connectez-vous et saisissez le code.',
        en: 'If you received a card code: open tiktok.com/coin in a browser, log in and enter the code.',
      },
    ],
    warning: {
      ar: 'اسم مستخدم خاطئ يرسل العملات إلى حساب آخر، ولا يمكن نقلها أو استرجاعها.',
      fr: "Un nom d'utilisateur erroné envoie les pièces sur un autre compte : elles ne peuvent être ni transférées ni remboursées.",
      en: "A wrong username sends the coins to another account; they can't be moved or refunded.",
    },
  },
  snapchat: {
    help: {
      username: {
        ar: 'افتح سناب شات ← اضغط على صورتك أعلى اليسار ← اسم المستخدم يظهر تحت اسمك.',
        fr: "Ouvrez Snapchat → touchez votre avatar en haut à gauche → votre nom d'utilisateur s'affiche sous votre nom.",
        en: 'Open Snapchat → tap your avatar (top-left) → your username is shown under your display name.',
      },
    },
    before: [
      {
        ar: 'اكتب اسم المستخدم في سناب شات بدقة.',
        fr: "Saisissez votre nom d'utilisateur Snapchat avec précision.",
        en: 'Enter your Snapchat username exactly.',
      },
      {
        ar: 'سنرسل لك طلب صداقة من حساب المتجر؛ اقبله، فسناب يشترط الصداقة لإرسال الهدية.',
        fr: "Nous vous enverrons une demande d'ami depuis le compte de la boutique : acceptez-la, Snapchat l'exige pour envoyer le cadeau.",
        en: "We'll send you a friend request from the shop's account; accept it, as Snapchat requires this to send the gift.",
      },
      {
        ar: 'تأكد أنه ليس لديك اشتراك Snapchat+ فعّال حالياً.',
        fr: "Vérifiez que vous n'avez pas déjà un abonnement Snapchat+ actif.",
        en: "Make sure you don't already have an active Snapchat+ subscription.",
      },
      {
        ar: 'لا نحتاج كلمة المرور أبداً.',
        fr: "Nous n'avons jamais besoin de votre mot de passe.",
        en: 'We never need your password.',
      },
    ],
    after: [
      {
        ar: 'افتح سناب ← الملف الشخصي ← بطاقة Snapchat+ ← الهدايا المستلمة (Gifts Received) ← استرداد (Redeem).',
        fr: 'Ouvrez Snapchat → Profil → carte Snapchat+ → Cadeaux reçus (Gifts Received) → Utiliser (Redeem).',
        en: 'Open Snapchat → Profile → Snapchat+ card → Gifts Received → Redeem.',
      },
      {
        ar: 'إذا استلمت كود بطاقة: افتح snapchat.com/plus وأدخل الكود.',
        fr: 'Si vous avez reçu un code carte : ouvrez snapchat.com/plus et saisissez le code.',
        en: 'If you received a card code: open snapchat.com/plus and enter the code.',
      },
    ],
    warning: {
      ar: 'الهدية لا تُسترد ولا تُنقل لحساب آخر، فتحقق من اسم المستخدم جيداً.',
      fr: "Le cadeau n'est ni remboursable ni transférable : vérifiez bien votre nom d'utilisateur.",
      en: "The gift can't be refunded or moved to another account, so double-check your username.",
    },
  },
  telegram: {
    help: {
      username: {
        ar: 'افتح تيليجرام ← الإعدادات ← اسم المستخدم يبدأ بـ @ تحت رقمك. إن لم يكن لديك واحد، أنشئه من نفس المكان.',
        fr: "Ouvrez Telegram → Paramètres → votre nom d'utilisateur commence par @, sous votre numéro. Si vous n'en avez pas, créez-le au même endroit.",
        en: "Open Telegram → Settings → your @username is under your phone number. If you don't have one, create it there.",
      },
    },
    before: [
      {
        ar: 'اكتب اسم المستخدم (يبدأ بـ @) وليس رقم الهاتف.',
        fr: "Saisissez votre nom d'utilisateur (avec @), pas votre numéro de téléphone.",
        en: 'Enter your @username, not your phone number.',
      },
      {
        ar: 'تأكد أن اسم المستخدم مفعّل في الإعدادات وراجعه قبل الدفع.',
        fr: "Vérifiez qu'il est bien activé dans les paramètres et relisez-le avant de payer.",
        en: 'Make sure it is set in Settings and check it before paying.',
      },
      {
        ar: 'لا نحتاج كلمة المرور ولا رمز الدخول أبداً.',
        fr: "Nous n'avons jamais besoin de votre mot de passe ni de votre code de connexion.",
        en: 'We never need your password or login code.',
      },
    ],
    after: [
      {
        ar: 'ستصلك رسالة هدية من تيليجرام ويتفعّل Premium تلقائياً.',
        fr: "Vous recevrez un message cadeau de Telegram et Premium s'active automatiquement.",
        en: "You'll get a gift message from Telegram and Premium turns on automatically.",
      },
      {
        ar: 'تحقق من تاريخ الانتهاء في الإعدادات ← Telegram Premium. الهدية لمدة محددة ولا تتجدد تلقائياً.',
        fr: 'Consultez la date de fin dans Paramètres → Telegram Premium. Le cadeau a une durée fixe et ne se renouvelle pas.',
        en: 'See the end date in Settings → Telegram Premium. The gift is for a fixed term and does not auto-renew.',
      },
    ],
    warning: {
      ar: 'اسم مستخدم خاطئ يرسل الهدية لشخص آخر ولا يمكن استرجاعها.',
      fr: "Un nom d'utilisateur erroné envoie le cadeau à quelqu'un d'autre, sans remboursement possible.",
      en: 'A wrong username sends the gift to someone else, with no refund.',
    },
  },
  discord: {
    help: {},
    before: [
      {
        ar: 'لا نحتاج أي بيانات منك: ستستلم رابط هدية بعد الدفع.',
        fr: "Nous n'avons besoin d'aucune information : vous recevrez un lien cadeau après le paiement.",
        en: "We don't need any details: you'll receive a gift link after paying.",
      },
      {
        ar: 'تأكد أنك مسجّل الدخول في ديسكورد على الحساب الذي تريد تفعيل Nitro عليه.',
        fr: "Assurez-vous d'être connecté à Discord sur le compte où vous voulez activer Nitro.",
        en: "Make sure you're logged into Discord on the account you want Nitro on.",
      },
      {
        ar: 'لا نطلب كلمة المرور أبداً.',
        fr: 'Nous ne demandons jamais votre mot de passe.',
        en: 'We never ask for your password.',
      },
    ],
    after: [
      {
        ar: 'افتح رابط الهدية (discord.gift/...) وأنت مسجّل الدخول.',
        fr: 'Ouvrez le lien cadeau (discord.gift/...) en étant connecté.',
        en: 'Open the gift link (discord.gift/...) while logged in.',
      },
      {
        ar: 'اضغط قبول (Accept) فيتفعّل Nitro فوراً.',
        fr: "Touchez « Accepter » (Accept) : Nitro s'active immédiatement.",
        en: 'Tap Accept and Nitro activates right away.',
      },
    ],
    warning: {
      ar: 'الرابط يتفعّل لأول حساب يفتحه، فلا تشاركه مع أحد.',
      fr: "Le lien s'active sur le premier compte qui l'ouvre : ne le partagez avec personne.",
      en: "The link activates on the first account that opens it, so don't share it with anyone.",
    },
  },
  apple: {
    help: {},
    before: [
      {
        ar: 'تأكد أن بلد حسابك هو الولايات المتحدة: الإعدادات ← اسمك ← الوسائط والمشتريات ← عرض الحساب ← البلد/المنطقة.',
        fr: 'Vérifiez que le pays de votre compte est les États-Unis : Réglages → votre nom → Contenu multimédia et achats → Voir le compte → Pays/Région.',
        en: 'Check that your account country is United States: Settings → your name → Media & Purchases → View Account → Country/Region.',
      },
      {
        ar: 'البطاقة الأمريكية لا تعمل على حساب موريتاني أو سعودي أو من أي بلد آخر.',
        fr: "La carte américaine ne fonctionne pas sur un compte mauritanien, saoudien ou d'un autre pays.",
        en: "A US card won't work on a Mauritanian, Saudi or any other non-US account.",
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'افتح App Store ← اضغط على صورتك أعلى الشاشة ← «استرداد بطاقة هدية أو رمز».',
        fr: "Ouvrez l'App Store → touchez votre photo en haut → « Utiliser une carte cadeau ou un code ».",
        en: 'Open the App Store → tap your photo at the top → Redeem Gift Card or Code.',
      },
      {
        ar: 'أدخل الكود يدوياً أو صوّره بالكاميرا، أو من الكمبيوتر عبر apple.com/redeem.',
        fr: "Saisissez le code ou scannez-le avec l'appareil photo, ou depuis un ordinateur sur apple.com/redeem.",
        en: 'Type the code or scan it with the camera, or use apple.com/redeem on a computer.',
      },
      {
        ar: 'يُضاف الرصيد إلى حسابك لتستخدمه في التطبيقات والاشتراكات مثل iCloud وApple Music.',
        fr: 'Le solde est ajouté à votre compte pour les apps et abonnements comme iCloud ou Apple Music.',
        en: 'The balance is added to your account for apps and subscriptions like iCloud and Apple Music.',
      },
    ],
    warning: {
      ar: 'البطاقة الأمريكية تعمل فقط على حساب Apple منطقته الولايات المتحدة، ولا يمكن استرجاعها بعد ظهور الكود.',
      fr: "La carte américaine ne fonctionne que sur un compte Apple réglé sur les États-Unis, et elle n'est plus remboursable une fois le code affiché.",
      en: "The US card only works on an Apple Account set to United States and can't be refunded once the code is shown.",
    },
  },
  gplay: {
    help: {},
    before: [
      {
        ar: 'تأكد أن بلد حسابك هو الولايات المتحدة: متجر Play ← صورتك ← الإعدادات ← عام ← الحساب والجهاز ← البلد والملفات الشخصية.',
        fr: "Vérifiez que le pays de votre compte est les États-Unis : Play Store → votre photo → Paramètres → Général → Préférences du compte et de l'appareil → Pays et profils.",
        en: 'Check that your account country is United States: Play Store → your photo → Settings → General → Account and device preferences → Country and profiles.',
      },
      {
        ar: 'تغيير بلد Google Play ممكن مرة واحدة في السنة فقط ومن داخل البلد الجديد.',
        fr: "Le pays Google Play ne peut être changé qu'une fois par an, et seulement depuis le nouveau pays.",
        en: "Google Play's country can only be changed once a year, and only from inside the new country.",
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'افتح play.google.com/redeem، أو متجر Play ← صورتك ← الدفعات والاشتراكات ← استرداد رمز.',
        fr: 'Ouvrez play.google.com/redeem, ou Play Store → votre photo → Paiements et abonnements → Utiliser un code.',
        en: 'Open play.google.com/redeem, or Play Store → your photo → Payments & subscriptions → Redeem code.',
      },
      {
        ar: 'أدخل الكود ← تأكيد، فيُضاف المبلغ إلى رصيد Google Play.',
        fr: "Saisissez le code → Confirmer : le montant s'ajoute à votre solde Google Play.",
        en: 'Enter the code → Confirm; the amount is added to your Google Play balance.',
      },
    ],
    warning: {
      ar: 'البطاقة الأمريكية لا تعمل إلا على حساب Google Play بلده الولايات المتحدة، ولا يُسترجع المبلغ إذا كان حسابك على بلد آخر.',
      fr: "La carte américaine ne fonctionne que sur un compte Google Play réglé sur les États-Unis, sans remboursement si votre compte est d'un autre pays.",
      en: "The US card only works on a Google Play account set to United States; there's no refund if your account is in another country.",
    },
  },
  psn: {
    help: {},
    before: [
      {
        ar: 'تأكد أن بلد حسابك هو الولايات المتحدة: الإعدادات ← المستخدمون والحسابات ← الحساب ← معلومات الملف ← البلد/المنطقة.',
        fr: 'Vérifiez que le pays de votre compte est les États-Unis : Paramètres → Utilisateurs et comptes → Compte → Profil → Pays/Région.',
        en: 'Check that your account country is United States: Settings → Users and Accounts → Account → Profile → Country/Region.',
      },
      {
        ar: 'البطاقة الأمريكية لا تعمل على حساب إماراتي أو سعودي أو غيره.',
        fr: 'La carte américaine ne fonctionne pas sur un compte émirati, saoudien ou autre.',
        en: "A US card won't work on a UAE, Saudi or other-region account.",
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'على PS5/PS4: الإعدادات ← المستخدمون والحسابات ← الحساب ← الدفع والاشتراكات ← استرداد الرموز.',
        fr: 'Sur PS5/PS4 : Paramètres → Utilisateurs et comptes → Compte → Paiement et abonnements → Utiliser des codes.',
        en: 'On PS5/PS4: Settings → Users and Accounts → Account → Payment and Subscriptions → Redeem Codes.',
      },
      {
        ar: 'أو من الموقع: store.playstation.com ← سجّل الدخول ← صورتك ← استرداد الرموز (Redeem Codes).',
        fr: 'Ou sur le site : store.playstation.com → connectez-vous → votre avatar → Utiliser des codes (Redeem Codes).',
        en: 'Or online: store.playstation.com → log in → your avatar → Redeem Codes.',
      },
      {
        ar: 'أدخل الكود المكوّن من 12 خانة ← تأكيد، فيُضاف الرصيد إلى محفظتك.',
        fr: "Saisissez le code à 12 caractères → Confirmer : le solde s'ajoute à votre porte-monnaie.",
        en: 'Enter the 12-character code → Confirm; the balance goes into your wallet.',
      },
    ],
    warning: {
      ar: 'كود PSN الأمريكي يعمل فقط على حساب منطقته الولايات المتحدة، وفي أي منطقة أخرى يظهر «رمز غير صالح» ولا يُسترجع.',
      fr: 'Le code PSN américain ne fonctionne que sur un compte de la région États-Unis : ailleurs il affiche « code non valide », sans remboursement.',
      en: "The US PSN code only works on a United States account; on any other region it shows 'invalid code' and can't be refunded.",
    },
  },
  xbox: {
    help: {},
    before: [
      {
        ar: 'تأكد أن بلد حسابك هو الولايات المتحدة: account.microsoft.com ← معلوماتك ← البلد/المنطقة.',
        fr: 'Vérifiez que le pays de votre compte est les États-Unis : account.microsoft.com → Vos informations → Pays/Région.',
        en: 'Check that your account country is United States: account.microsoft.com → Your info → Country/region.',
      },
      {
        ar: 'البطاقة الأمريكية تعمل فقط على حساب Microsoft بعملة الدولار الأمريكي.',
        fr: 'La carte américaine fonctionne uniquement sur un compte Microsoft en dollars US.',
        en: 'The US card only works on a Microsoft account in US dollars.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'ادخل إلى redeem.microsoft.com وسجّل الدخول بحساب Microsoft.',
        fr: 'Allez sur redeem.microsoft.com et connectez-vous avec votre compte Microsoft.',
        en: 'Go to redeem.microsoft.com and log in with your Microsoft account.',
      },
      {
        ar: 'أو على جهاز Xbox: زر Xbox ← المتجر ← استرداد (Redeem).',
        fr: 'Ou sur la console : bouton Xbox → Store → Utiliser un code (Redeem).',
        en: 'Or on the console: Xbox button → Store → Redeem.',
      },
      {
        ar: 'أدخل الكود المكوّن من 25 خانة ← تأكيد، فيُضاف الرصيد إلى حسابك.',
        fr: "Saisissez le code à 25 caractères → Confirmer : le solde s'ajoute à votre compte.",
        en: 'Enter the 25-character code → Confirm; the balance is added to your account.',
      },
    ],
    warning: {
      ar: 'إذا لم يكن حساب Microsoft على الولايات المتحدة فلن تتمكن من استخدام الرصيد، ولا يُسترجع الكود بعد تسليمه.',
      fr: "Si votre compte Microsoft n'est pas réglé sur les États-Unis, vous ne pourrez pas utiliser le solde, et le code n'est pas remboursable après livraison.",
      en: "If your Microsoft account isn't set to United States you won't be able to use the balance, and the code can't be refunded after delivery.",
    },
  },
  steam: {
    help: {},
    before: [
      {
        ar: 'تأكد أن عملة محفظة Steam في حسابك هي الدولار الأمريكي ($).',
        fr: 'Vérifiez que votre porte-monnaie Steam est en dollars US ($).',
        en: 'Check that your Steam wallet currency is US dollars ($).',
      },
      {
        ar: 'للتحقق: Steam ← اسم حسابك أعلى اليمين ← تفاصيل الحساب، أو انظر هل أسعار المتجر بالدولار $.',
        fr: 'Pour vérifier : Steam → votre nom de compte en haut à droite → Détails du compte, ou regardez si les prix de la boutique sont en $.',
        en: 'To check: Steam → your account name (top-right) → Account details, or see whether store prices are in $.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'افتح store.steampowered.com/account/redeemwalletcode وسجّل الدخول.',
        fr: 'Ouvrez store.steampowered.com/account/redeemwalletcode et connectez-vous.',
        en: 'Open store.steampowered.com/account/redeemwalletcode and log in.',
      },
      {
        ar: 'أو من برنامج Steam: Games (الألعاب) ← Redeem a Steam Wallet Code.',
        fr: "Ou dans l'application Steam : Jeux (Games) → Utiliser un code porte-monnaie Steam.",
        en: 'Or in the Steam app: Games → Redeem a Steam Wallet Code.',
      },
      {
        ar: 'أدخل الكود ← متابعة، فيُضاف الرصيد إلى محفظتك.',
        fr: "Saisissez le code → Continuer : le solde s'ajoute à votre porte-monnaie.",
        en: 'Enter the code → Continue; the balance is added to your wallet.',
      },
    ],
    warning: {
      ar: 'إذا لم تكن عملة حسابك الدولار فلن يعمل الكود، ولا يمكن استرجاعه.',
      fr: "Si votre compte n'est pas en dollars, le code ne fonctionnera pas et ne pourra pas être remboursé.",
      en: "If your account currency isn't USD the code won't work, and it can't be refunded.",
    },
  },
  nintendo: {
    help: {},
    before: [
      {
        ar: 'تأكد أن بلد حسابك هو الولايات المتحدة: accounts.nintendo.com ← معلومات المستخدم ← البلد/المنطقة.',
        fr: 'Vérifiez que le pays de votre compte est les États-Unis : accounts.nintendo.com → Informations utilisateur → Pays/Région.',
        en: 'Check that your account country is United States: accounts.nintendo.com → User info → Country/Region.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'على جهاز Switch: افتح Nintendo eShop ← اختر حسابك ← «إدخال رمز» (Enter Code).',
        fr: 'Sur la Switch : ouvrez le Nintendo eShop → choisissez votre compte → « Saisir un code » (Enter Code).',
        en: 'On Switch: open Nintendo eShop → pick your account → Enter Code.',
      },
      {
        ar: 'أو من المتصفح: ec.nintendo.com/redeem ← سجّل الدخول بحساب Nintendo.',
        fr: 'Ou dans le navigateur : ec.nintendo.com/redeem → connectez-vous avec votre compte Nintendo.',
        en: 'Or in a browser: ec.nintendo.com/redeem → log in with your Nintendo Account.',
      },
      {
        ar: 'أدخل الكود المكوّن من 16 خانة ← تأكيد، فيُضاف الرصيد إلى حسابك.',
        fr: "Saisissez le code à 16 caractères → Confirmer : le solde s'ajoute à votre compte.",
        en: 'Enter the 16-character code → Confirm; the balance is added to your account.',
      },
    ],
    warning: {
      ar: 'الكود الأمريكي لا يعمل إلا على حساب Nintendo منطقته الولايات المتحدة، ولا يُسترجع بعد التسليم.',
      fr: "Le code américain ne fonctionne que sur un compte Nintendo réglé sur les États-Unis, et n'est pas remboursable après livraison.",
      en: "The US code only works on a Nintendo Account set to United States and can't be refunded after delivery.",
    },
  },
  roblox: {
    help: {},
    before: [
      {
        ar: 'بطاقات Roblox تعمل من أي بلد، والرصيد يتحوّل إلى عملة حسابك دون رسوم.',
        fr: "Les cartes Roblox fonctionnent depuis n'importe quel pays, et le crédit est converti dans la devise de votre compte sans frais.",
        en: 'Roblox cards work from any country, and the credit converts to your account currency with no fees.',
      },
      {
        ar: 'لا نحتاج اسم المستخدم ولا كلمة المرور؛ ستستلم كوداً تُدخله بنفسك.',
        fr: "Nous n'avons besoin ni de votre nom d'utilisateur ni de votre mot de passe : vous recevrez un code à saisir vous-même.",
        en: "We don't need your username or password; you'll get a code to enter yourself.",
      },
      {
        ar: 'اختر الفئة وادفع.',
        fr: 'Choisissez le montant et payez.',
        en: 'Pick the amount and pay.',
      },
    ],
    after: [
      {
        ar: 'افتح المتصفح وادخل إلى roblox.com/redeem (الاسترداد لا يعمل من تطبيق الجوال).',
        fr: "Ouvrez votre navigateur sur roblox.com/redeem (l'application mobile ne permet pas d'utiliser le code).",
        en: "Open roblox.com/redeem in a web browser (redeeming doesn't work in the mobile app).",
      },
      {
        ar: 'سجّل الدخول ← أدخل الكود ← Redeem.',
        fr: 'Connectez-vous → saisissez le code → Redeem.',
        en: 'Log in → enter the code → Redeem.',
      },
      {
        ar: 'يُضاف الرصيد إلى حسابك، ثم اشترِ به Robux أو Premium.',
        fr: 'Le crédit est ajouté à votre compte : utilisez-le pour acheter des Robux ou Premium.',
        en: 'The credit is added to your account; use it to buy Robux or Premium.',
      },
    ],
    warning: {
      ar: 'تأكد أنك مسجّل على حسابك الصحيح قبل الاسترداد، فالرصيد لا يُنقل إلى حساب آخر بعد ذلك.',
      fr: "Vérifiez que vous êtes connecté au bon compte avant d'utiliser le code : le crédit ne peut plus être transféré ensuite.",
      en: "Make sure you're logged into the right account before redeeming; the credit can't be moved to another account afterwards.",
    },
  },
  razer: {
    help: {},
    before: [
      {
        ar: 'تحتاج حساب Razer ID مجانياً من razer.com.',
        fr: 'Il vous faut un compte Razer ID gratuit sur razer.com.',
        en: 'You need a free Razer ID account from razer.com.',
      },
      {
        ar: 'تأكد أن محفظة Razer Gold على المنطقة «Global».',
        fr: 'Vérifiez que votre portefeuille Razer Gold est sur la région « Global ».',
        en: 'Make sure your Razer Gold wallet region is Global.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك رمز PIN. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez un code PIN. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive a PIN. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'ادخل إلى gold.razer.com وسجّل الدخول.',
        fr: 'Allez sur gold.razer.com et connectez-vous.',
        en: 'Go to gold.razer.com and log in.',
      },
      {
        ar: 'اضغط Reload ← Razer Gold PIN ← أدخل رمز الـ PIN (وليس الرقم التسلسلي).',
        fr: 'Touchez Reload → Razer Gold PIN → saisissez le code PIN (pas le numéro de série).',
        en: 'Tap Reload → Razer Gold PIN → enter the PIN (not the serial number).',
      },
      {
        ar: 'قد يرسل لك Razer رمز تحقق على بريدك أو هاتفك؛ لا تشاركه مع أي أحد، حتى معنا.',
        fr: 'Razer peut vous envoyer un code de vérification par e-mail ou SMS : ne le communiquez à personne, même pas à nous.',
        en: 'Razer may send a verification code to your email or phone; never share it with anyone, including us.',
      },
      {
        ar: 'بعدها يُضاف الرصيد وتستخدمه لشحن ألعابك.',
        fr: "Le solde est alors ajouté et vous pouvez l'utiliser pour recharger vos jeux.",
        en: 'The balance is then added and you can use it to top up your games.',
      },
    ],
    warning: {
      ar: 'رمز PIN العالمي يُستخدم مع محفظة على المنطقة «Global»، وأدخل الـ PIN وليس الرقم التسلسلي.',
      fr: "Le PIN Global s'utilise avec un portefeuille réglé sur « Global » : saisissez bien le PIN, pas le numéro de série.",
      en: 'Use the Global PIN with a wallet set to Global, and enter the PIN, not the serial number.',
    },
  },
  battlenet: {
    help: {},
    before: [
      {
        ar: 'افتح تطبيق Battle.net ← المتجر (Shop) وتأكد أن الأسعار بالدولار الأمريكي ($).',
        fr: "Ouvrez l'application Battle.net → Boutique (Shop) et vérifiez que les prix sont en dollars US ($).",
        en: 'Open the Battle.net app → Shop and check that prices are in US dollars ($).',
      },
      {
        ar: 'عملة المتجر يحددها بلد الإقامة في account.battle.net ← إعدادات الحساب.',
        fr: 'La devise dépend du pays de résidence indiqué dans account.battle.net → Paramètres du compte.',
        en: 'The Shop currency is set by your Country of Residence in account.battle.net → Account Settings.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'ادخل إلى battle.net/balance وسجّل الدخول بحسابك.',
        fr: 'Allez sur battle.net/balance et connectez-vous.',
        en: 'Go to battle.net/balance and log in.',
      },
      {
        ar: 'أدخل الكود ← تأكيد، فيُضاف الرصيد إلى Battle.net Balance.',
        fr: "Saisissez le code → Confirmer : le montant s'ajoute à votre solde Battle.net.",
        en: "Enter the code → Confirm; it's added to your Battle.net Balance.",
      },
      {
        ar: 'الحد الأقصى للرصيد 110$ بدون Authenticator و350$ مع تفعيله.',
        fr: 'Le solde est plafonné à 110 $ sans Authenticator et à 350 $ avec.',
        en: 'Your balance is capped at $110 without the Authenticator and $350 with it.',
      },
      {
        ar: 'الرصيد لا يعمل في متاجر أجهزة الكونسول ولا لمشتريات Hearthstone على الجوال.',
        fr: "Le solde n'est pas utilisable sur les boutiques consoles ni pour les achats Hearthstone sur mobile.",
        en: "The balance can't be used on console stores or for Hearthstone mobile purchases.",
      },
    ],
    warning: {
      ar: 'إذا لم يكن متجر Battle.net في حسابك بالدولار فلن يعمل الكود، ولا يُسترجع بعد التسليم.',
      fr: "Si votre boutique Battle.net n'affiche pas les prix en dollars, le code ne fonctionnera pas et n'est pas remboursable après livraison.",
      en: "If your Battle.net Shop isn't in USD the code won't work, and it can't be refunded after delivery.",
    },
  },
  minecraft: {
    help: {},
    before: [
      {
        ar: 'تحتاج حساب Microsoft مجانياً.',
        fr: 'Il vous faut un compte Microsoft gratuit.',
        en: 'You need a free Microsoft account.',
      },
      {
        ar: 'لـ Minecoins: اختر الجهاز الذي تلعب عليه (Windows أو Xbox أو الجوال) قبل الدفع.',
        fr: "Pour les Minecoins : choisissez l'appareil sur lequel vous jouez (Windows, Xbox ou mobile) avant de payer.",
        en: 'For Minecoins: choose the device you play on (Windows, Xbox or mobile) before paying.',
      },
      {
        ar: 'اختر المنتج وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le produit et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the product and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'Java & Bedrock: ادخل إلى minecraft.net/redeem ← سجّل الدخول بحساب Microsoft ← أدخل الكود.',
        fr: 'Java & Bedrock : allez sur minecraft.net/redeem → connectez-vous avec votre compte Microsoft → saisissez le code.',
        en: 'Java & Bedrock: go to minecraft.net/redeem → log in with your Microsoft account → enter the code.',
      },
      {
        ar: 'ثم حمّل اللعبة من Minecraft Launcher.',
        fr: 'Téléchargez ensuite le jeu depuis le Minecraft Launcher.',
        en: 'Then download the game from the Minecraft Launcher.',
      },
      {
        ar: 'Minecoins: ادخل إلى redeem.microsoft.com، أو افتح Minecraft Bedrock ← المتجر ← استرداد رمز.',
        fr: 'Minecoins : allez sur redeem.microsoft.com, ou ouvrez Minecraft Bedrock → Boutique → Utiliser un code.',
        en: 'Minecoins: go to redeem.microsoft.com, or open Minecraft Bedrock → Store → Redeem code.',
      },
    ],
    warning: {
      ar: 'كود Minecoins مخصص لجهاز معيّن، فاختر جهازك الصحيح؛ الكود لا يُسترجع بعد التسليم.',
      fr: "Le code Minecoins est lié à un appareil précis : choisissez le bon, car le code n'est pas remboursable après livraison.",
      en: "Minecoins codes are tied to one platform, so pick the right device; the code can't be refunded after delivery.",
    },
  },
  amazon: {
    help: {},
    before: [
      {
        ar: 'هذه البطاقة لموقع amazon.com الأمريكي فقط، ولا تعمل على أمازون الإمارات أو السعودية أو غيرها.',
        fr: 'Cette carte est valable uniquement sur amazon.com (États-Unis), pas sur Amazon Émirats, Arabie saoudite ou autres.',
        en: "This card is for amazon.com (US) only; it won't work on Amazon UAE, Saudi or other Amazon sites.",
      },
      {
        ar: 'تأكد أن المنتج الذي تريده يُشحن إلى عنوانك أو إلى شركة شحن وسيطة.',
        fr: "Vérifiez que l'article souhaité peut être livré à votre adresse ou chez un transitaire.",
        en: 'Check that the item you want ships to your address or to a parcel forwarder.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'ادخل إلى amazon.com/redeem وسجّل الدخول.',
        fr: 'Allez sur amazon.com/redeem et connectez-vous.',
        en: 'Go to amazon.com/redeem and log in.',
      },
      {
        ar: 'أدخل كود المطالبة (Claim code) ← «Apply to your balance».',
        fr: 'Saisissez le code (Claim code) → « Apply to your balance ».',
        en: 'Enter the claim code → Apply to your balance.',
      },
      {
        ar: 'عند الشراء يُخصم المبلغ من رصيد البطاقة تلقائياً.',
        fr: 'Lors de vos achats, le montant est déduit automatiquement de ce solde.',
        en: 'When you shop, the amount is taken from your gift card balance automatically.',
      },
    ],
    warning: {
      ar: 'الكود يعمل على amazon.com فقط، وبعد إضافته إلى حسابك لا يمكن نقله أو استرجاعه.',
      fr: 'Le code ne fonctionne que sur amazon.com et, une fois ajouté à votre compte, il ne peut être ni transféré ni remboursé.',
      en: "The code only works on amazon.com; once added to your account it can't be moved or refunded.",
    },
  },
  netflixcard: {
    help: {},
    before: [
      {
        ar: 'ادخل إلى netflix.com ← الحساب ← الخطة/الفوترة، وتأكد أن فاتورتك بالدولار الأمريكي ($).',
        fr: 'Allez sur netflix.com → Compte → Abonnement / facturation, et vérifiez que votre facture est en dollars US ($).',
        en: 'Go to netflix.com → Account → Membership/billing and check that your bill is in US dollars ($).',
      },
      {
        ar: 'البطاقة تعمل فقط إذا كانت عملة فاتورتك هي عملة البطاقة نفسها.',
        fr: 'La carte ne fonctionne que si votre facture est dans la même devise que la carte.',
        en: 'The card only works if your bill is in the same currency as the card.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'افتح netflix.com/redeem من المتصفح وسجّل الدخول.',
        fr: 'Ouvrez netflix.com/redeem dans votre navigateur et connectez-vous.',
        en: 'Open netflix.com/redeem in a browser and log in.',
      },
      {
        ar: 'أدخل رمز البطاقة ← استرداد، فتُضاف القيمة كاملة إلى رصيدك وتُستخدم في الأشهر القادمة.',
        fr: 'Saisissez le code → Valider : la valeur entière est ajoutée à votre solde et servira pour les mois suivants.',
        en: 'Enter the code → Redeem; the full value goes to your balance and pays for the coming months.',
      },
    ],
    warning: {
      ar: 'إذا كانت فاتورة Netflix بعملة غير الدولار فلن تعمل البطاقة، وهي غير قابلة للاسترجاع.',
      fr: "Si votre facture Netflix n'est pas en dollars, la carte ne fonctionnera pas, et elle n'est pas remboursable.",
      en: "If your Netflix bill isn't in USD the card won't work, and it's non-refundable.",
    },
  },
  twitch: {
    help: {},
    before: [
      {
        ar: 'البطاقة الأمريكية مخصّصة لحسابات Twitch في الولايات المتحدة.',
        fr: 'La carte américaine est destinée aux comptes Twitch des États-Unis.',
        en: 'The US card is meant for United States Twitch accounts.',
      },
      {
        ar: 'تأكد قبل الشراء أن حسابك يدعم رصيد الهدايا بالدولار (Gift balance).',
        fr: "Avant d'acheter, vérifiez que votre compte accepte le solde cadeau en dollars (Gift balance).",
        en: 'Before buying, check that your account supports a USD gift balance.',
      },
      {
        ar: 'اختر الفئة وادفع، وسيصلك الكود. لا نحتاج كلمة المرور.',
        fr: "Choisissez le montant et payez : vous recevrez le code. Nous n'avons pas besoin de votre mot de passe.",
        en: "Pick the amount and pay; you'll receive the code. We don't need your password.",
      },
    ],
    after: [
      {
        ar: 'ادخل إلى twitch.tv/redeem وسجّل الدخول.',
        fr: 'Allez sur twitch.tv/redeem et connectez-vous.',
        en: 'Go to twitch.tv/redeem and log in.',
      },
      {
        ar: 'أدخل الكود ← استرداد.',
        fr: 'Saisissez le code → Valider.',
        en: 'Enter the code → Redeem.',
      },
      {
        ar: 'استخدم الرصيد للاشتراك في القنوات أو إهداء الاشتراكات أو شراء Bits.',
        fr: 'Utilisez le solde pour vous abonner à des chaînes, offrir des abonnements ou acheter des Bits.',
        en: 'Use the balance for subs, gift subs or Bits.',
      },
    ],
    warning: {
      ar: 'بطاقة Twitch الأمريكية قد لا تعمل على حساب خارج الولايات المتحدة، والكود غير قابل للاسترجاع.',
      fr: "La carte Twitch américaine peut ne pas fonctionner sur un compte hors États-Unis, et le code n'est pas remboursable.",
      en: 'The US Twitch card may not work on an account outside the United States, and the code is non-refundable.',
    },
  },
  usdt: {
    help: {
      network: {
        ar: 'لديك حساب بينانس؟ اختر «Binance ID» (تحويل داخلي مجاني وفوري). محفظة أخرى مثل Trust Wallet أو MetaMask؟ اختر BEP20.',
        fr: 'Vous avez un compte Binance ? Choisissez « Binance ID » (transfert interne gratuit et instantané). Un autre portefeuille comme Trust Wallet ou MetaMask ? Choisissez BEP20.',
        en: 'Have a Binance account? Choose Binance ID (free, instant internal transfer). Another wallet like Trust Wallet or MetaMask? Choose BEP20.',
      },
      address: {
        ar: 'Binance ID: افتح Binance ← اضغط على صورتك أعلى اليسار ← انسخ الرقم بجانب UID. BEP20: الأصول ← إيداع ← USDT ← شبكة BNB Smart Chain (BEP20) ← انسخ العنوان الذي يبدأ بـ 0x (لا حاجة لـ Memo).',
        fr: "Binance ID : ouvrez Binance → touchez votre photo en haut à gauche → copiez le numéro à côté de « UID ». BEP20 : Actifs → Dépôt → USDT → réseau BNB Smart Chain (BEP20) → copiez l'adresse qui commence par 0x (pas de mémo).",
        en: 'Binance ID: open Binance → tap your photo (top-left) → copy the number next to UID. BEP20: Assets → Deposit → USDT → network BNB Smart Chain (BEP20) → copy the address starting with 0x (no memo needed).',
      },
    },
    before: [
      {
        ar: 'اختر طريقة الاستلام: Binance ID أو شبكة BEP20.',
        fr: 'Choisissez le mode de réception : Binance ID ou réseau BEP20.',
        en: 'Choose how to receive: Binance ID or the BEP20 network.',
      },
      {
        ar: 'انسخ رقم UID أو عنوان 0x من تطبيقك والصقه هنا، لا تكتبه يدوياً.',
        fr: "Copiez l'UID ou l'adresse 0x depuis votre application et collez-la ici, sans la retaper.",
        en: "Copy your UID or 0x address from your app and paste it here; don't type it by hand.",
      },
      {
        ar: 'راجع الرقم أو العنوان حرفاً حرفاً قبل الدفع.',
        fr: "Vérifiez le numéro ou l'adresse caractère par caractère avant de payer.",
        en: 'Check the number or address character by character before paying.',
      },
      {
        ar: 'لا نطلب كلمة المرور ولا رموز التحقق أبداً.',
        fr: 'Nous ne demandons jamais votre mot de passe ni vos codes de vérification.',
        en: 'We never ask for your password or verification codes.',
      },
    ],
    after: [
      {
        ar: 'تصلك USDT خلال دقائق.',
        fr: 'Vos USDT arrivent en quelques minutes.',
        en: 'Your USDT arrives within minutes.',
      },
      {
        ar: 'في بينانس: الأصول ← Funding للتحويل الداخلي، أو Spot للإيداع عبر BEP20.',
        fr: 'Dans Binance : Actifs → Funding pour un transfert interne, ou Spot pour un dépôt BEP20.',
        en: 'In Binance: Assets → Funding for an internal transfer, or Spot for a BEP20 deposit.',
      },
      {
        ar: 'عند الإرسال عبر BEP20 نعطيك رقم العملية (TxID) لتتحقق منه على bscscan.com.',
        fr: "Pour un envoi BEP20, nous vous donnons l'identifiant de transaction (TxID) à vérifier sur bscscan.com.",
        en: 'For BEP20 sends we give you the transaction ID (TxID) to check on bscscan.com.',
      },
    ],
    warning: {
      ar: 'الإرسال إلى عنوان خاطئ أو على شبكة غير BEP20 يضيّع المبلغ نهائياً ولا يمكن استرجاعه.',
      fr: 'Un envoi vers une mauvaise adresse ou sur un autre réseau que BEP20 est perdu définitivement, sans remboursement possible.',
      en: 'Sending to a wrong address or on a network other than BEP20 loses the funds for good, with no refund.',
    },
  },
  kast: {
    help: {
      network: {
        ar: 'ننصح بـ BNB Chain (BEP20) فهي الأرخص. اختر هنا نفس الشبكة التي تختارها في KAST عند نسخ العنوان.',
        fr: "Nous recommandons BNB Chain (BEP20), le moins cher. Choisissez ici le même réseau que dans KAST au moment de copier l'adresse.",
        en: 'We recommend BNB Chain (BEP20), the cheapest option. Pick the same network here as in KAST when you copy the address.',
      },
      address: {
        ar: 'افتح تطبيق KAST ← Receive (استلام) ← USDT ← اختر الشبكة (BNB Chain أو Tron أو Solana) ← انسخ العنوان.',
        fr: "Ouvrez l'application KAST → Receive (Recevoir) → USDT → choisissez le réseau (BNB Chain, Tron ou Solana) → copiez l'adresse.",
        en: 'Open the KAST app → Receive → USDT → choose the network (BNB Chain, Tron or Solana) → copy the address.',
      },
    },
    before: [
      {
        ar: 'تأكد أن حسابك في KAST موثّق (KYC). توفر KAST في موريتانيا غير مضمون، فتأكد أن حسابك يعمل قبل الشراء.',
        fr: "Vérifiez que votre compte KAST est validé (KYC). La disponibilité de KAST en Mauritanie n'est pas garantie : assurez-vous que votre compte fonctionne avant d'acheter.",
        en: "Make sure your KAST account is verified (KYC). KAST availability in Mauritania isn't guaranteed, so check your account works before buying.",
      },
      {
        ar: 'في KAST: Receive ← USDT ← اختر الشبكة ← انسخ العنوان.',
        fr: "Dans KAST : Receive → USDT → choisissez le réseau → copiez l'adresse.",
        en: 'In KAST: Receive → USDT → choose the network → copy the address.',
      },
      {
        ar: 'اختر نفس الشبكة هنا والصق العنوان، ثم راجعه قبل الدفع.',
        fr: "Choisissez le même réseau ici, collez l'adresse et vérifiez-la avant de payer.",
        en: 'Select the same network here, paste the address and check it before paying.',
      },
      {
        ar: 'لا نطلب كلمة المرور ولا رموز التحقق أبداً.',
        fr: 'Nous ne demandons jamais votre mot de passe ni vos codes de vérification.',
        en: 'We never ask for your password or verification codes.',
      },
    ],
    after: [
      {
        ar: 'يظهر الرصيد في KAST عادة خلال دقائق، ويمكنك الإنفاق به فوراً بالبطاقة.',
        fr: 'Le solde apparaît généralement dans KAST en quelques minutes et peut être dépensé tout de suite avec la carte.',
        en: 'The balance usually shows in KAST within minutes and you can spend it right away with your card.',
      },
      {
        ar: 'إذا لم يظهر خلال ساعة، أرسل لنا لقطة شاشة وسنعطيك رقم العملية (TxID) لمراسلة دعم KAST.',
        fr: "S'il n'apparaît pas au bout d'une heure, envoyez-nous une capture d'écran : nous vous donnerons le TxID pour contacter le support KAST.",
        en: "If it hasn't arrived after an hour, send us a screenshot and we'll give you the TxID to contact KAST support.",
      },
    ],
    warning: {
      ar: 'يجب أن تكون الشبكة هنا هي نفسها في KAST؛ الشبكة الخاطئة تعني ضياع المبلغ.',
      fr: 'Le réseau choisi ici doit être le même que dans KAST : un mauvais réseau signifie des fonds perdus.',
      en: 'The network here must match the one in KAST; the wrong network means the funds are lost.',
    },
  },
  redotpay: {
    help: {
      network: {
        ar: 'الأفضل: RedotPay UID (تحويل داخلي مجاني وفوري، ويجب أن يكون الحسابان موثّقين). أو اختر عنوان USDT على TRC20 أو BEP20.',
        fr: 'Le mieux : RedotPay UID (transfert interne gratuit et instantané, les deux comptes doivent être vérifiés). Sinon, une adresse USDT en TRC20 ou BEP20.',
        en: 'Best: RedotPay UID (free, instant internal transfer; both accounts must be verified). Otherwise, a USDT address on TRC20 or BEP20.',
      },
      address: {
        ar: 'UID: افتح RedotPay ← الملف الشخصي ← انسخ الرقم بجانب UID. عنوان: الرئيسية ← Deposit ← USDT ← On-chain deposit ← اختر الشبكة نفسها ← انسخ العنوان.',
        fr: "UID : ouvrez RedotPay → Profil → copiez le numéro à côté de « UID ». Adresse : Accueil → Deposit → USDT → On-chain deposit → choisissez le même réseau → copiez l'adresse.",
        en: 'UID: open RedotPay → Profile → copy the number next to UID. Address: Home → Deposit → USDT → On-chain deposit → choose the same network → copy the address.',
      },
    },
    before: [
      {
        ar: 'تأكد أن حسابك في RedotPay موثّق (KYC).',
        fr: 'Vérifiez que votre compte RedotPay est validé (KYC).',
        en: 'Make sure your RedotPay account is verified (KYC).',
      },
      {
        ar: 'الأسهل: انسخ رقم UID من ملفك الشخصي والصقه هنا.',
        fr: "Le plus simple : copiez l'UID depuis votre profil et collez-le ici.",
        en: 'Easiest: copy the UID from your profile and paste it here.',
      },
      {
        ar: 'للإيداع عبر الشبكة: اختر هنا نفس الشبكة (TRC20 أو BEP20) التي نسخت منها العنوان.',
        fr: "Pour un dépôt on-chain : choisissez ici le même réseau (TRC20 ou BEP20) que celui de l'adresse copiée.",
        en: 'For an on-chain deposit: choose the same network (TRC20 or BEP20) as the address you copied.',
      },
      {
        ar: 'راجع الرقم أو العنوان قبل الدفع؛ لا نطلب كلمة المرور أبداً.',
        fr: "Vérifiez le numéro ou l'adresse avant de payer ; nous ne demandons jamais votre mot de passe.",
        en: 'Check the number or address before paying; we never ask for your password.',
      },
    ],
    after: [
      {
        ar: 'التحويل الداخلي يصل فوراً، والإيداع عبر الشبكة يصل عادة خلال 1 إلى 15 دقيقة.',
        fr: 'Le transfert interne arrive immédiatement ; un dépôt on-chain arrive en général en 1 à 15 minutes.',
        en: 'Internal transfers arrive instantly; on-chain deposits usually take 1 to 15 minutes.',
      },
      {
        ar: 'الرصيد يُستخدم مباشرة في بطاقة RedotPay.',
        fr: 'Le solde est utilisable directement avec votre carte RedotPay.',
        en: 'The balance is ready to use on your RedotPay card.',
      },
    ],
    warning: {
      ar: 'التحويل الداخلي لا يمكن التراجع عنه، والإيداع على شبكة خاطئة قد لا يُسترجع أبداً.',
      fr: 'Un transfert interne est irréversible, et un dépôt sur le mauvais réseau risque de ne jamais être récupéré.',
      en: "Internal transfers can't be reversed, and a deposit on the wrong network may never be recovered.",
    },
  },
  airtime: {
    help: {
      phone: {
        ar: 'اكتب +222 ثم رقمك المكوّن من 8 أرقام. أرقام Chinguitel تبدأ بـ 2، وMattel بـ 3، وMauritel بـ 4.',
        fr: 'Saisissez +222 puis votre numéro à 8 chiffres. Les numéros Chinguitel commencent par 2, Mattel par 3 et Mauritel par 4.',
        en: 'Enter +222 followed by your 8-digit number. Chinguitel numbers start with 2, Mattel with 3 and Mauritel with 4.',
      },
    },
    before: [
      {
        ar: 'اكتب الرقم المكوّن من 8 أرقام بعد +222.',
        fr: 'Saisissez le numéro à 8 chiffres après +222.',
        en: 'Enter the 8-digit number after +222.',
      },
      {
        ar: 'تأكد أن الرقم تابع للشبكة التي اخترتها (Chinguitel أو Mattel أو Mauritel).',
        fr: "Vérifiez que le numéro appartient bien à l'opérateur choisi (Chinguitel, Mattel ou Mauritel).",
        en: 'Make sure the number belongs to the operator you picked (Chinguitel, Mattel or Mauritel).',
      },
      {
        ar: 'راجع الرقم رقماً رقماً ثم اختر المبلغ وادفع.',
        fr: 'Vérifiez-le chiffre par chiffre, puis choisissez le montant et payez.',
        en: 'Check it digit by digit, then pick the amount and pay.',
      },
    ],
    after: [
      {
        ar: 'يصل الرصيد إلى الرقم خلال دقائق، وتصلك رسالة من المشغّل.',
        fr: "Le crédit arrive sur le numéro en quelques minutes et l'opérateur vous envoie un SMS.",
        en: 'The credit reaches the number within minutes and the operator sends you an SMS.',
      },
      {
        ar: 'تحقق من رصيدك عبر كود الاستعلام الخاص بشبكتك.',
        fr: 'Vérifiez votre solde avec le code de consultation de votre opérateur.',
        en: "Check your balance with your operator's balance code.",
      },
    ],
    warning: {
      ar: 'الشحن إلى رقم خاطئ أو رقم من شبكة أخرى لا يمكن استرجاعه.',
      fr: "Une recharge sur un mauvais numéro ou sur un numéro d'un autre opérateur ne peut pas être remboursée.",
      en: 'Credit sent to a wrong number or a number on another network cannot be refunded.',
    },
  },
};
