import { IAppointmentStatusEnum } from '../../src/interfaces/appointment.interface';
import { IHomeCareRequestStatusEnum } from '../../src/interfaces/home-care-request.interface';
import { PharmacyRequestStatusEnum } from '../../src/interfaces/pharmacy-treatment-request.interface';
import { INotificationStatusEnum } from '../../src/interfaces/notification.interface';
import { IDoctorStatusEnum, IDoctorVerificationStatusEnum } from '../../src/interfaces/doctor.interface';
import { SUGGESTIONS_SEED } from '../../src/migrations/seed-suggestions.migration';
import type { SeedImageMode } from './core';

export const IMAGE_MANIFEST = {
    placeholder: 'https://placehold.co/1200x630/0f766e/ffffff.png?text=Cannula+Demo',
    doctorMale: [
        'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=600&auto=format&fit=crop',
    ],
    doctorFemale: [
        'https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1651008376811-b90baee60c1f?w=600&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1638202993928-7d113b8e5d3f?w=600&auto=format&fit=crop',
    ],
    banners: [
        'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=1400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=1400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1516841273335-e39b37888115?w=1400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1512678080530-7760d81faba6?w=1400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=1400&auto=format&fit=crop',
    ],
    catalog: [
        'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1584982751601-97dcc096659c?w=900&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1551076805-e1869033e561?w=900&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1576765608622-067973a79f53?w=900&auto=format&fit=crop',
    ],
    pharmacy: [
        'https://placehold.co/512x512/2563eb/ffffff.png?text=Demo+Pharmacy+1',
        'https://placehold.co/512x512/7c3aed/ffffff.png?text=Demo+Pharmacy+2',
        'https://placehold.co/512x512/059669/ffffff.png?text=Demo+Pharmacy+3',
        'https://placehold.co/512x512/d97706/ffffff.png?text=Demo+Pharmacy+4',
    ],
} as const;

export function optionalImage(mode: SeedImageMode, values: readonly string[], index: number): string | null {
    return mode === 'remote' ? values[index % values.length]! : null;
}

export const DOCTOR_PUBLIC_VISIBILITY = {
    status: IDoctorStatusEnum.ACTIVE,
    verification_status: IDoctorVerificationStatusEnum.VERIFIED,
    license_verified: true,
} as const;

export const AVAILABILITY_PATTERNS = [
    [{ start_time: '09:00', end_time: '14:00' }, { start_time: '17:00', end_time: '21:00' }],
    [{ start_time: '08:00', end_time: '13:00' }, { start_time: '16:00', end_time: '22:00' }],
] as const;

export const NOTIFICATION_SEED_POLICY = {
    status: INotificationStatusEnum.SENT,
    createDeliveryRows: false,
    pendingPublicBroadcast: false,
} as const;

export const SPECIALTIES = [
    ['طب عام', 'الرعاية الطبية الأولية والمتابعة العامة'], ['طب الأطفال', 'رعاية صحة الأطفال وحديثي الولادة'],
    ['أمراض القلب', 'تشخيص ومتابعة أمراض القلب والأوعية'], ['الأمراض الجلدية', 'العناية بالبشرة والشعر والأظافر'],
    ['النسائية والتوليد', 'صحة المرأة ومتابعة الحمل'], ['العظام والمفاصل', 'إصابات وأمراض العظام والمفاصل'],
    ['الأنف والأذن والحنجرة', 'تشخيص أمراض الأنف والأذن والحنجرة'], ['طب العيون', 'فحوصات وعلاج أمراض العيون'],
    ['الأمراض الباطنية', 'تشخيص ومتابعة الأمراض الباطنية'], ['الأعصاب', 'أمراض الجهاز العصبي والصداع'],
    ['المسالك البولية', 'أمراض الكلى والمسالك البولية'], ['الطب النفسي', 'الصحة النفسية والدعم العلاجي'],
] as const;

export const CLINICS = [
    ['عيادة كانيولا التجريبية - المنصور', 'بغداد - المنصور - شارع تجريبي ١', 33.3152, 44.3661],
    ['مركز كانيولا التجريبي - الكرادة', 'بغداد - الكرادة - شارع تجريبي ٢', 33.3028, 44.4431],
    ['عيادات كانيولا التعليمية - الجادرية', 'بغداد - الجادرية - مجمع تجريبي', 33.2765, 44.3779],
    ['مركز الصحة التجريبي - زيونة', 'بغداد - زيونة - شارع تجريبي ٣', 33.3247, 44.4836],
    ['عيادة النخيل التجريبية - الحارثية', 'بغداد - الحارثية - منطقة تجريبية', 33.3178, 44.3502],
] as const;

export const DOCTOR_NAMES = [
    ['أحمد علي', 'male'], ['سارة كريم', 'female'], ['محمد حسن', 'male'], ['نور الهدى سالم', 'female'],
    ['علي فاضل', 'male'], ['زهراء قاسم', 'female'], ['مصطفى ناصر', 'male'], ['مريم خليل', 'female'],
    ['حسين جبار', 'male'], ['رنا ماجد', 'female'], ['عمر سعد', 'male'], ['آية محمود', 'female'],
    ['كرار عباس', 'male'], ['هدى رائد', 'female'], ['سيف طارق', 'male'], ['لينا وسام', 'female'],
    ['ياسر حميد', 'male'], ['شهد عادل', 'female'], ['منتظر صباح', 'male'], ['دانية وليد', 'female'],
    ['زيد حازم', 'male'], ['بان أحمد', 'female'], ['مهند إياد', 'male'], ['فرح سامي', 'female'],
] as const;

export const HOME_CARE_CATEGORIES = [
    ['تحاليل', 'سحب العينات والفحوصات المنزلية', 'home-care-analysis'],
    ['تمريض', 'خدمات تمريضية يقدمها مختصون في المنزل', 'home-care-nursing'],
    ['رعاية', 'متابعة يومية ودعم صحي منزلي', 'home-care-care'],
    ['علاج ومتابعة', 'جلسات علاجية ومتابعة مهنية منزلية', 'mobile-home-care-followup'],
] as const;

export const HOME_CARE_SERVICES = [
    ['سحب عينات مختبرية', 0, 15000, 20, 30], ['فحص السكر المنزلي', 0, 10000, 15, 20],
    ['قياس العلامات الحيوية', 0, 12000, 20, 30], ['حقن عضلية', 1, 10000, 15, 20],
    ['حقن وريدية', 1, 18000, 20, 30], ['تبديل الضماد', 1, 20000, 25, 40],
    ['تركيب ومتابعة محلول', 1, 25000, 45, 60], ['جلسة تمريض منزلية', 1, 30000, 60, 90],
    ['رعاية كبار السن', 2, 40000, 120, 180], ['متابعة ما بعد العملية', 2, 35000, 60, 90],
    ['جلسة علاج طبيعي منزلية', 3, 30000, 45, 60], ['متابعة الأدوية والالتزام', 3, 18000, 30, 45],
] as const;

export const NURSE_NAMES = [
    ['حيدر سالم', 'male'], ['نور حسين', 'female'], ['سجاد كريم', 'male'],
    ['روان أحمد', 'female'], ['قاسم نوري', 'male'], ['سرى علي', 'female'],
] as const;

export const PHARMACY_NAMES = ['صيدلية كانيولا التجريبية', 'صيدلية الرافدين التجريبية', 'صيدلية دجلة التجريبية', 'صيدلية بغداد التعليمية'] as const;

export const APPOINTMENT_STATES = [
    IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED, IAppointmentStatusEnum.CONFIRMED,
    IAppointmentStatusEnum.COMPLETED, IAppointmentStatusEnum.COMPLETED,
    IAppointmentStatusEnum.CANCELLED, IAppointmentStatusEnum.NO_SHOW,
] as const;

export const HOME_CARE_STATES = [
    IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED,
    IHomeCareRequestStatusEnum.ASSIGNED, IHomeCareRequestStatusEnum.ON_THE_WAY,
    IHomeCareRequestStatusEnum.ARRIVED, IHomeCareRequestStatusEnum.IN_PROGRESS,
    IHomeCareRequestStatusEnum.COMPLETED, IHomeCareRequestStatusEnum.CANCELLED,
] as const;

export const PHARMACY_STATES = [
    PharmacyRequestStatusEnum.OPEN, PharmacyRequestStatusEnum.UNDER_REVIEW,
    PharmacyRequestStatusEnum.WAITING_CUSTOMER_APPROVAL, PharmacyRequestStatusEnum.CONFIRMED,
    PharmacyRequestStatusEnum.PREPARING, PharmacyRequestStatusEnum.READY_FOR_DELIVERY,
    PharmacyRequestStatusEnum.OUT_FOR_DELIVERY, PharmacyRequestStatusEnum.DELIVERED,
    PharmacyRequestStatusEnum.CANCELLED,
] as const;

export const SUGGESTIONS = SUGGESTIONS_SEED.slice(0, 6);

export const PUBLIC_NOTIFICATIONS = [
    ['مرحباً بكم في كانيولا', 'استكشفوا خدمات الرعاية الصحية المتاحة في التطبيق.', 'system'],
    ['تحديث التطبيق', 'يتوفر إصدار تجريبي محسن لتجربة أكثر سهولة.', 'system'],
    ['خدمة رعاية جديدة', 'أضيفت خدمات منزلية جديدة إلى كتالوج الرعاية.', 'services'],
    ['نصيحة صحية', 'حافظ على شرب الماء بانتظام خلال اليوم.', 'medications'],
    ['مواعيد أسهل', 'يمكنك البحث عن الطبيب حسب التخصص والعيادة.', 'appointments'],
    ['تنبيه عام', 'حدّث بيانات الاتصال لضمان وصول التنبيهات المهمة.', 'account'],
    ['خدمات منزلية', 'تعرّف على خيارات التمريض والرعاية المنزلية.', 'services'],
    ['صحتك أولاً', 'المتابعة الدورية تساعد على الوقاية والكشف المبكر.', 'system'],
    ['تذكير بالملف الصحي', 'أبقِ معلومات الحساسية والحالات المزمنة محدثة.', 'account'],
    ['أطباء متاحون', 'راجع قائمة الأطباء وأوقات الحجز المتاحة.', 'appointments'],
] as const;

export const TARGETED_NOTIFICATIONS = [
    ['تم استلام طلب الموعد', 'طلب موعدك التجريبي قيد المراجعة.', 'appointments', 'appointment_booked'],
    ['تم تأكيد الموعد', 'تم تأكيد موعدك التجريبي القادم.', 'appointments', 'appointment_confirmed'],
    ['تذكير بالموعد', 'لديك موعد تجريبي قريب، راجع التفاصيل.', 'appointments', 'appointment_reminder'],
    ['اكتملت الزيارة', 'تم تسجيل الموعد التجريبي كمكتمل.', 'appointments', 'appointment_completed'],
    ['تم تأكيد طلب الرعاية', 'تم تأكيد طلب الرعاية المنزلية التجريبي.', 'services', 'home_care_confirmed'],
    ['تم تعيين الممرض', 'تم تعيين مقدم الرعاية لطلبك التجريبي.', 'services', 'home_care_assigned'],
    ['مقدم الرعاية في الطريق', 'مقدم الرعاية متجه إلى عنوانك التجريبي.', 'services', 'home_care_on_the_way'],
    ['اكتملت الخدمة', 'تم إكمال خدمة الرعاية المنزلية التجريبية.', 'services', 'home_care_completed'],
    ['عرض صيدلية جاهز', 'يوجد عرض سعر تجريبي بانتظار موافقتك.', 'medications', 'pharmacy_quotation_ready'],
    ['الطلب قيد التحضير', 'تعمل الصيدلية التجريبية على تجهيز الطلب.', 'medications', 'pharmacy_preparing'],
    ['الطلب في الطريق', 'خرج طلب الصيدلية التجريبي للتوصيل.', 'medications', 'pharmacy_out_for_delivery'],
    ['تم تسليم الطلب', 'تم تسليم طلب الصيدلية التجريبي بنجاح.', 'medications', 'pharmacy_delivered'],
] as const;

export const FIXTURE_COUNTS = {
    Specialties: 12, Clinics: 5, Doctors: 24, DoctorAvailabilities: 168, Ads: 6,
    ChronicConditions: 30, HomeCareCategories: 4, HomeCareServices: 12, Nurses: 6,
    Pharmacies: 4, PatientUsers: 1, Patients: 1, Children: 2, Appointments: 7,
    HomeCareRequests: 8, PharmacyRequests: 9, Favorites: 5,
    PublicNotifications: 10, TargetedNotifications: 12, NotificationReads: 4,
    Suggestions: 6, AboutUs: 1,
} as const;
