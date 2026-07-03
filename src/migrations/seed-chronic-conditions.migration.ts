import ChronicCondition from '../models/chronic-conditions.model';
import { IChronicConditionStatusEnum } from '../interfaces/chronic-condition.interface';

const CHRONIC_CONDITIONS_SEED: { name: string; description: string }[] = [
    { name: 'السكري', description: 'مرض مزمن يؤثر على مستوى السكر في الدم ويتطلب متابعة طبية مستمرة.' },
    { name: 'ارتفاع ضغط الدم', description: 'حالة مزمنة تزيد من خطر الإصابة بأمراض القلب والسكتة الدماغية.' },
    { name: 'الربو', description: 'مرض تنفسي مزمن يسبب التهاباً وحساسية في الشعب الهوائية.' },
    { name: 'مرض الانسداد الرئوي المزمن', description: 'مجموعة أمراض رئوية مزمنة تسبب صعوبة في التنفس.' },
    { name: 'أمراض القلب التاجية', description: 'أمراض مزمنة تؤثر على الشرايين التي تغذي عضلة القلب.' },
    { name: 'الفشل الكلوي المزمن', description: 'فقدان تدريجي لوظائف الكلى على مدى فترة طويلة.' },
    { name: 'السمنة', description: 'تراكم مفرط للدهون في الجسم يزيد من مخاطر الأمراض المزمنة.' },
    { name: 'ارتفاع الكوليسترول', description: 'ارتفاع مستوى الدهون في الدم يزيد خطر أمراض القلب والأوعية.' },
    { name: 'التهاب المفاصل الروماتويدي', description: 'مرض مناعي ذاتي يسبب التهاباً مزمناً في المفاصل.' },
    { name: 'التهاب المفاصل التنكسي', description: 'تآكل تدريجي للغضروف في المفاصل يسبب ألماً وصلابة.' },
    { name: 'الذئبة الحمراء', description: 'مرض مناعي ذاتي مزمن يؤثر على الجلد والمفاصل والأعضاء الداخلية.' },
    { name: 'التصلب المتعدد', description: 'مرض عصبي مزمن يؤثر على الجهاز العصبي المركزي.' },
    { name: 'مرض باركنسون', description: 'اضطراب عصبي مزمن يؤثر على الحركة والتوازن.' },
    { name: 'مرض الزهايمر', description: 'مرض عصبي تنكسي مزمن يسبب فقداناً تدريجياً للذاكرة والوظائف المعرفية.' },
    { name: 'الصرع', description: 'اضطراب عصبي مزمن يسبب نوبات متكررة.' },
    { name: 'أمراض الغدة الدرقية', description: 'اضطرابات مزمنة في إفراز هرمونات الغدة الدرقية.' },
    { name: 'الاكتئاب', description: 'اضطراب نفسي مزمن يؤثر على المزاج والنشاط اليومي.' },
    { name: 'اضطرابات القلق', description: 'حالات نفسية مزمنة تسبب قلقاً مفرطاً ومستمراً.' },
    { name: 'فيروس نقص المناعة المكتسب', description: 'عدوى فيروسية مزمنة تضعف جهاز المناعة إذا لم تُعالج.' },
    { name: 'التهاب الكبد المزمن', description: 'التهاب طويل الأمد في الكبد قد يؤدي إلى تليف الكبد.' },
    { name: 'فقر الدم المنجلي', description: 'اضطراب وراثي مزمن في شكل خلايا الدم الحمراء.' },
    { name: 'مرض كرون', description: 'مرض التهابي معوي مزمن يؤثر على الجهاز الهضمي.' },
    { name: 'التهاب القولون التقرحي', description: 'مرض التهابي معوي مزمن يؤثر بشكل أساسي على القولون.' },
    { name: 'الصدفية', description: 'مرض جلدي مزمن يسبب بقعاً حمراء مغطاة بقشور فضية.' },
    { name: 'السرطان', description: 'أمراض مزمنة تتميز بنمو غير طبيعي للخلايا في أجزاء مختلفة من الجسم.' },
    { name: 'النقرس', description: 'نوع من التهاب المفاصل المزمن ناتج عن ترسب بلورات حمض اليوريك.' },
    { name: 'الألم العضلي الليفي', description: 'اضطراب مزمن يسبب ألماً منتشراً في العضلات والأنسجة الرخوة.' },
    { name: 'داء الأمعاء الحساسة للغلوتين', description: 'اضطراب مزمن في الجهاز الهضمي يحدث عند تناول الغلوتين.' },
    { name: 'فقر الدم المزمن', description: 'انخفاض مستمر في عدد خلايا الدم الحمراء أو الهيموجلوبين.' },
    { name: 'الصداع النصفي المزمن', description: 'صداع متكرر ومزمن قد يستمر لساعات أو أيام.' },
];

export async function seedChronicConditions(): Promise<void> {
    let inserted = 0;
    let skipped = 0;

    for (const item of CHRONIC_CONDITIONS_SEED) {
        const exists = await ChronicCondition.exists({ name: item.name });
        if (exists) {
            skipped++;
            continue;
        }

        await ChronicCondition.create({
            name: item.name,
            description: item.description,
            status: IChronicConditionStatusEnum.ACTIVE,
            created_by: null,
        });
        inserted++;
    }

    console.log(`[Migration] Chronic conditions seed complete: ${inserted} inserted, ${skipped} already existed`);
}
