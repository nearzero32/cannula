import mongoose from 'mongoose';
import User from '../models/users.model';
import Suggestion from '../models/suggestions.model';
import { IUserRoleEnum } from '../interfaces/user.interface';

const SUGGESTIONS_SEED: string[] = [
    'أقترح إضافة تذكير بالمواعيد عبر رسائل SMS قبل الموعد بـ 24 ساعة.',
    'يفضل توفير خيار حجز المواعيد في عطلة نهاية الأسبوع.',
    'أتمنى إضافة خاصية البحث عن الأطباء حسب التقييمات.',
    'يرجى تحسين واجهة التطبيق لتكون أكثر سهولة لكبار السن.',
    'أقترح إضافة استشارة طبية عن بُعد عبر الفيديو.',
    'يفضل إظهار أوقات الانتظار المتوقعة عند الحجز.',
    'أتمنى إضافة إمكانية إعادة جدولة الموعد بسهولة دون الاتصال بالعيادة.',
    'يرجى توفير خريطة توضح مواقع العيادات القريبة.',
    'أقترح إضافة سجل طبي إلكتروني للمريض داخل التطبيق.',
    'يفضل دعم اللغة الكردية بالإضافة إلى العربية.',
    'أتمنى إضافة نظام تقييم للأطباء بعد انتهاء الموعد.',
    'يرجى تحسين سرعة تحميل قائمة التخصصات الطبية.',
    'أقترح إرسال إشعار عند تأكيد أو إلغاء الموعد من قبل الطبيب.',
    'يفضل إضافة خيار الدفع الإلكتروني داخل التطبيق.',
    'أتمنى توفير دعم فني عبر الدردشة المباشرة على مدار الساعة.',
];

async function resolveSeedUserId(): Promise<mongoose.Types.ObjectId | null> {
    const patient = await User.findOne({ role: IUserRoleEnum.PATIENT }).select('_id').lean();
    if (patient?._id) return new mongoose.Types.ObjectId(patient._id);

    const fallbackPhone = process.env.SUPER_ADMIN_PHONE || '07000000000';
    const adminUser = await User.findOne({ phone: fallbackPhone }).select('_id').lean();
    if (adminUser?._id) return new mongoose.Types.ObjectId(adminUser._id);

    return null;
}

export async function seedSuggestions(): Promise<void> {
    const user_id = await resolveSeedUserId();
    if (!user_id) {
        console.warn('[Migration] Suggestions seed skipped: no user found to attach suggestions.');
        return;
    }

    let inserted = 0;
    let skipped = 0;

    for (const text of SUGGESTIONS_SEED) {
        const exists = await Suggestion.exists({ suggestion: text, is_deleted: false });
        if (exists) {
            skipped++;
            continue;
        }

        await Suggestion.create({
            user_id,
            suggestion: text,
            is_deleted: false,
            deleted_at: null,
            deleted_by: null,
        });
        inserted++;
    }

    console.log(`[Migration] Suggestions seed complete: ${inserted} inserted, ${skipped} already existed`);
}
