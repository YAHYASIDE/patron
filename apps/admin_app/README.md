# Patron الإدارة — تطبيق المالك (apps/admin_app)

تطبيق Flutter لصاحب المتجر وفريقه، يُثبَّت على هاتف المالك (أندرويد) الذي توجد عليه
تطبيقات البنك. يعمل على `/api/v1` نفسه الذي تستعمله لوحة التحكم.

## ماذا يفعل

- **تسجيل الدخول**: بريد الموظف وكلمة المرور. الرموز (tokens) تُحفظ في مخزن الهاتف الآمن
  (Android Keystore عبر `flutter_secure_storage`) وتُجدَّد تلقائيا.
- **القفل بالبصمة**: عند فتح التطبيق مرة أخرى تُطلب البصمة أو قفل الهاتف (`local_auth`)،
  وكذلك بعد 5 دقائق في الخلفية. زر «الدخول بكلمة المرور» يمسح الجلسة المحفوظة ويعيد إلى
  شاشة الدخول. يمكن إيقاف القفل من الإعدادات.
- **الرئيسية**: ما يحتاج انتباهك الآن (`/admin/orders/attention`): طلبات فشل تسليمها، تسليم
  متأخر، تحويلات تنتظر المراجعة، دفع مكرر. تحتها تنبيهات الفريق المفتوحة بألوان الأولوية
  (عاجل أحمر، مهم برتقالي، عادي أخضر مزرق، منخفض رمادي). اسحب للتحديث. الضغط على عنصر
  يفتح الطلب في لوحة التحكم.
- **إشعارات البنك**: قائمة الإشعارات كما حللها الخادم، مع حالة كل إشعار ونسبة الثقة في المبلغ
  والمرجع، وتصفية حسب الحالة.
- **الإعدادات**: القفل بالبصمة، الخروج، عنوان الخادم ولوحة التحكم، قراءة إشعارات البنك.

**التطبيق لا يؤكد أي دفع أبدا.** الإشعار البنكي دليل فقط؛ المالك يراجع الطلب ويؤكده من لوحة
التحكم.

## الحصول على ملف APK

يتطلب جهازا عليه Flutter (stable) و Android SDK:

```bash
cd apps/admin_app
flutter pub get
flutter build apk --release
# الملف: build/app/outputs/flutter-apk/app-release.apk
```

- عنوان الخادم الافتراضي `https://etssadagha-api.onrender.com/api/v1` ولوحة التحكم
  `https://etssadagha-shop.onrender.com`. لتغييرهما عند البناء:
  `flutter build apk --release --dart-define=PATRON_API_URL=https://…/api/v1 --dart-define=PATRON_DASHBOARD_URL=https://…`
  ويمكن تغييرهما أيضا من شاشة «الخادم» في التطبيق.
- التوقيع: بدون إعداد يُوقَّع الإصدار بمفتاح التطوير (يكفي للتثبيت المباشر على هاتف المالك).
  لمفتاح خاص ضع `android/key.properties` (غير مرفوع إلى git) فيه
  `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
- انقل الملف إلى الهاتف وثبته (اسمح بالتثبيت من هذا المصدر عند السؤال).

## تفعيل قراءة إشعارات البنك (اختياري، أندرويد فقط)

الميزة **متوقفة افتراضيا**. لتفعيلها:

1. في التطبيق: إشعارات البنك ← «قراءة إشعارات البنك متوقفة» (أو الإعدادات ← قراءة إشعارات البنك).
2. **الخطوة 1**: «فتح إعدادات الإذن» يفتح شاشة أندرويد «الوصول إلى الإشعارات». فعّل
   «Patron الإدارة — إشعارات البنك» بنفسك. التطبيق لا يستطيع منح هذا الإذن لنفسه.
3. **الخطوة 2**: ضع علامة على تطبيقات البنك التي تريد قراءتها. يقترح التطبيق التطبيقات المثبتة
   التي يبدو اسمها بنكيا والتطبيقات المسموح بها في الخادم (`allowedApps`)، لكنه لا يختار شيئا
   وحده. يمكن إضافة اسم حزمة يدويا (مثل `com.bank.app`).
4. **الخطوة 3**: شغّل «قراءة إشعارات البنك».

لإيقافها: أطفئ المفتاح في الخطوة 3، أو اسحب الإذن من إعدادات أندرويد.

### ما الذي يحدث بعد ذلك

- عند وصول إشعار من تطبيق مختار، يقرأ التطبيق العنوان والنص ووقت النشر واسم الحزمة فقط.
- يُحفظ في تخزين التطبيق الخاص (حتى لو كان التطبيق مغلقا)، ثم يُنقل إلى قائمة إرسال تبقى بعد
  إعادة التشغيل، ويُرسل إلى `POST /admin/bank-notices`. عند فشل الاتصال يعيد المحاولة بفترات
  متزايدة (30 ثانية، دقيقة، دقيقتان… حتى 30 دقيقة).
- يظهر لكل عنصر حالته: بانتظار الإرسال، إعادة المحاولة، رفضه الخادم، أو حالة الخادم (جديد،
  مطابقة مقترحة، أكده المالك، متجاهل، مكرر) مع نسبة الثقة.
- الإرسال يتم والتطبيق مفتوح أو باق في الذاكرة. ما يُلتقط والتطبيق مغلق يُرسل عند فتحه التالي.

## ضمانات الخصوصية

- لا يُقرأ أي إشعار قبل أن يمنح المالك الإذن بنفسه ويشغّل الميزة.
- تُتجاهل إشعارات كل التطبيقات غير المختارة دون قراءة نصها.
- أي إشعار يشبه رمز تحقق (OTP) أو رمزا سريا (PIN) أو كلمة سر **يُحذف على الهاتف ولا يغادر
  المستمع** (`SensitiveText.kt`)، ثم يُفحص مرة ثانية في Dart (`lib/bank/sensitive_filter.dart`).
  يُحفظ فقط عدد المحذوفات، لا نصها.
- أرقام البطاقات تُخفى ولا يبقى منها إلا آخر 4 أرقام.
- لا نسخ احتياطي سحابي لبيانات التطبيق (`allowBackup=false`)؛ الجلسة في مخزن الهاتف الآمن.
- معرّف الجهاز رقم عشوائي يولده التطبيق، لا يأتي من أي معرّف للعتاد.
- لا شيء في التطبيق أو الخادم يؤكد دفعا من إشعار.

## أجزاء أندرويد فقط

- `android/app/src/main/kotlin/com/patron/patron_admin/BankNotificationListener.kt` —
  `NotificationListenerService` (مُعلن في `AndroidManifest.xml` مع
  `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`).
- `BankListenerStore.kt` (التخزين المحلي) و `SensitiveText.kt` (الحجب والإخفاء) و
  `MainActivity.kt` (قناة `patron/bank_listener` و `patron/bank_listener/events`).
- على iOS لا يمكن قراءة إشعارات تطبيقات أخرى: الميزة مخفية، وباقي التطبيق يعمل.

## التطوير

```bash
cd apps/admin_app
flutter pub get
flutter analyze
flutter test
```

التطبيق خارج npm/Turbo. CI: مهمة «Admin app · analyze & test».

---

## English (short)

Flutter app for the Patron shop owner and staff, installed on the owner's Android phone.

- Staff login (email + password); tokens in flutter_secure_storage with automatic refresh;
  biometric unlock (`local_auth`) of a saved session, password as the fallback.
- Home: attention counts/lists (`/admin/orders/attention`) and open staff notifications with
  priority colours; bank notices with status chips and parser confidence; settings.
- **Optional, Android-only, off by default:** a `NotificationListenerService` reads only the bank
  apps the owner selects, drops anything that looks like an OTP/PIN/password and masks card numbers
  before it leaves the listener, queues items durably and uploads them to `POST /admin/bank-notices`
  with exponential backoff. The owner grants notification access in Android settings; the app only
  opens that screen. The app never confirms a payment: notices are evidence, reviewed in the
  dashboard. Hidden on iOS.
- Build: `flutter build apk --release` (needs the Android SDK). Override URLs with
  `--dart-define=PATRON_API_URL=…` / `PATRON_DASHBOARD_URL=…`; optional `android/key.properties`
  for release signing.
- Uploads run while the app process is alive; items captured while it is closed are sent on the
  next launch.
