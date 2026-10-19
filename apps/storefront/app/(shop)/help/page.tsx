import Link from 'next/link';

export const metadata = { title: 'كيف أشتري؟ | باترون' };

const STEPS = [
  { t: 'اختر المنتج', d: 'ابحث عن اللعبة أو البطاقة أو الاشتراك، ثم اختر الفئة (القيمة) التي تريدها.' },
  { t: 'اكتب بيانات الشحن', d: 'إن طُلب منك (مثل رقم اللاعب ID في ببجي وفري فاير)، اكتبه بدقّة وراجعه قبل المتابعة.' },
  { t: 'ادفع بالتحويل', d: 'حوّل المبلغ إلى أحد حساباتنا (بنكيلي، مصرفي، سداد…) ثم اكتب رقم العملية في صفحة الدفع.' },
  { t: 'نؤكّد الدفع', d: 'نراجع التحويل ونؤكّده، وتتابع حالة طلبك خطوة بخطوة في صفحة «طلباتي».' },
  { t: 'استلم طلبك', d: 'يظهر الكود في صفحة الطلب، اضغط «إظهار الكود». أما الشحن المباشر فيصل إلى حسابك في اللعبة.' },
];

const FAQ = [
  {
    q: 'كم يستغرق وصول الطلب؟',
    a: 'كثير من المنتجات تُسلَّم فور تأكيد الدفع. وغيرها يُسلَّم عادة خلال دقائق، وقد يتأخّر بضع ساعات في أوقات الضغط أو خارج أوقات العمل.',
  },
  {
    q: 'أين أجد الكود بعد الشراء؟',
    a: 'في «طلباتي» ← افتح الطلب ← «إظهار الكود». ويمكنك فتحه مرة أخرى في أي وقت.',
  },
  {
    q: 'كتبت رقم اللاعب خطأ، ماذا أفعل؟',
    a: 'راسلنا على واتساب فورًا قبل تنفيذ الطلب لنصحّحه. إن نُفّذ الشحن على الرقم الذي كتبته فلا يمكن استرجاعه.',
  },
  {
    q: 'لماذا يجب توثيق رقمي؟',
    a: 'للتأكّد أن رقم واتساب لك، فنرسل لك عليه طلبك ونتواصل معك عند الحاجة. يتم التوثيق مرة واحدة فقط.',
  },
  {
    q: 'دفعت ولم يتأكّد طلبي بعد',
    a: 'التحويلات تُراجع يدويًّا. إن مرّ وقت طويل، راسلنا على واتساب ومعك رقم العملية ورقم الطلب.',
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-8">
      <h1 className="text-2xl font-extrabold">كيف أشتري؟</h1>
      <p className="mt-1.5 text-sm text-muted">خمس خطوات بسيطة من الاختيار إلى الاستلام.</p>

      <ol className="mt-6 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.t} className="surface flex gap-3.5 rounded-2xl p-4 shadow-card">
            <span className="tnum grid h-8 w-8 flex-none place-items-center rounded-full bg-teal text-sm font-bold text-white">
              {i + 1}
            </span>
            <div>
              <div className="font-bold">{s.t}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-xl font-extrabold">أسئلة شائعة</h2>
      <div className="mt-4 space-y-2.5">
        {FAQ.map((f) => (
          <details key={f.q} className="surface group rounded-2xl px-4 py-3.5 shadow-card">
            <summary className="cursor-pointer list-none font-bold marker:hidden">
              <span className="flex items-center justify-between gap-3">
                {f.q}
                <span className="text-muted transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted">
        اقرأ أيضًا{' '}
        <Link href="/terms" className="font-bold text-teal hover:underline">
          الشروط وسياسة الاسترجاع
        </Link>
        .
      </p>
    </div>
  );
}
