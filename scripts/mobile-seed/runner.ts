import mongoose from 'mongoose';
import { createClient } from 'redis';
import User from '../../src/models/users.model';
import Specialty from '../../src/models/specialties.model';
import Clinic from '../../src/models/clinics.model';
import Doctor from '../../src/models/doctors.model';
import DoctorAvailability from '../../src/models/doctor-availability.model';
import Ads from '../../src/models/ads.model';
import AboutUs from '../../src/models/about-us.model';
import ChronicCondition from '../../src/models/chronic-conditions.model';
import Suggestion from '../../src/models/suggestions.model';
import HomeCareCategory from '../../src/models/home-care-category.model';
import HomeCareService from '../../src/models/home-care-service.model';
import Nurse from '../../src/models/nurse.model';
import Pharmacy from '../../src/models/pharmacy.model';
import Patient from '../../src/models/patients.model';
import PatientHealthProfile from '../../src/models/patient-health-profile.model';
import PatientChild from '../../src/models/patient-child.model';
import ChildHealthProfile from '../../src/models/child-health-profile.model';
import DoctorFavorite from '../../src/models/doctors_favorite.model';
import Appointment from '../../src/models/appointments.model';
import HomeCareRequest from '../../src/models/home-care-request.model';
import PharmacyTreatmentRequest from '../../src/models/pharmacy-treatment-request.model';
import Notification from '../../src/models/notifications.model';
import NotificationRecipient from '../../src/models/notification-recipient.model';
import NotificationRead, { INotificationReaderTypeEnum } from '../../src/models/notification-read.model';
import NotificationDelivery from '../../src/models/notification-delivery.model';
import { hashPassword, isArgon2Hash, verifyPassword } from '../../src/constants/hashing';
import { seedChronicConditions } from '../../src/migrations/seed-chronic-conditions.migration';
import { normalizeHomeCareName } from '../../src/services/home-care.validation';
import { IUserRoleEnum, IUserStatusEnum } from '../../src/interfaces/user.interface';
import { ISpecialtyStatusEnum } from '../../src/interfaces/specialty.interface';
import { IChronicConditionStatusEnum } from '../../src/interfaces/chronic-condition.interface';
import { IClinicStatusEnum } from '../../src/interfaces/clinic.interface';
import { IAdsStatusEnum } from '../../src/interfaces/ads.interface';
import { IHomeCareStatusEnum } from '../../src/interfaces/home-care.interface';
import { INurseStatusEnum } from '../../src/interfaces/nurse.interface';
import { IPharmacyStatusEnum } from '../../src/interfaces/pharmacy.interface';
import { IPatientStatusEnum } from '../../src/interfaces/patient.interface';
import { PatientChildRelationshipEnum, PatientChildStatusEnum } from '../../src/interfaces/patient-child.interface';
import { BloodTypeEnum } from '../../src/interfaces/health-profile.interface';
import {
    AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum,
    IAppointmentPaymentStatusEnum, IAppointmentStatusEnum,
} from '../../src/interfaces/appointment.interface';
import {
    IHomeCareDispatchModeEnum, IHomeCareDispatchStatusEnum, IHomeCareRequestCancelledByTypeEnum,
    IHomeCareRequestStatusEnum,
} from '../../src/interfaces/home-care-request.interface';
import {
    PharmacyDispatchModeEnum, PharmacyDispatchStatusEnum, PharmacyPaymentMethodEnum, PharmacyRequestStatusEnum,
} from '../../src/interfaces/pharmacy-treatment-request.interface';
import {
    INotificationAudienceEnum, INotificationCategoryEnum, INotificationPrivacyEnum,
    INotificationRecipientModelEnum, INotificationTypeEnum,
} from '../../src/interfaces/notification.interface';
import { INotificationDeliveryRecipientTypeEnum, INotificationDeliveryStatusEnum } from '../../src/interfaces/notification-delivery.interface';
import {
    credentialDocument, DEMO_PHONE, DEMO_PIN, deterministicObjectId, knownSeedIds, SeedEntityError,
    relativeDates, RESET_ENTITY_KEYS, type ResetEntity, type SeedImageMode,
} from './core';
import {
    APPOINTMENT_STATES, AVAILABILITY_PATTERNS, CLINICS, DOCTOR_NAMES, DOCTOR_PUBLIC_VISIBILITY, FIXTURE_COUNTS, HOME_CARE_CATEGORIES,
    HOME_CARE_SERVICES, HOME_CARE_STATES, IMAGE_MANIFEST, NURSE_NAMES, optionalImage,
    NOTIFICATION_SEED_POLICY, PHARMACY_NAMES, PHARMACY_STATES, PUBLIC_NOTIFICATIONS, SPECIALTIES, SUGGESTIONS,
    TARGETED_NOTIFICATIONS,
} from './fixtures';

type Model = { modelName?: string; updateOne(filter: unknown, update: unknown, options?: unknown): PromiseLike<unknown>; deleteMany(filter: unknown): PromiseLike<unknown> };
type SeedIds = {
    demoPatientUserId: mongoose.Types.ObjectId;
    demoPatientProfileId: mongoose.Types.ObjectId;
    doctorIds: mongoose.Types.ObjectId[];
    specialtyIds: mongoose.Types.ObjectId[];
    clinicIds: mongoose.Types.ObjectId[];
};

async function upsert(model: Model, entity: string, key: string, payload: Record<string, unknown>) {
    const _id = deterministicObjectId(entity, key);
    try {
        await model.updateOne(
            { _id },
            { $set: payload, $setOnInsert: { _id } },
            { upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        const phaseByEntity: Record<string, string> = {
            specialty: 'specialties', clinic: 'clinics', 'doctor-user': 'doctor-users', doctor: 'doctors',
            availability: 'doctor-availability', ad: 'ads', 'home-care-category': 'home-care-categories',
            'home-care-service': 'home-care-services', 'nurse-user': 'nurse-users', nurse: 'nurses',
            'pharmacy-user': 'pharmacy-users', pharmacy: 'pharmacies', 'patient-user': 'patient-user',
            patient: 'patient', 'health-profile': 'health-profile', child: 'children',
            'child-health-profile': 'child-health-profiles', favorite: 'favorites', appointment: 'appointments',
            'home-care-request': 'home-care-requests', 'pharmacy-request': 'pharmacy-requests',
            suggestion: 'suggestions', 'about-us': 'about-us', notification: 'notifications',
            'notification-recipient': 'notification-recipients', 'notification-read': 'notification-reads',
        };
        const phase = phaseByEntity[entity] ?? entity;
        throw new SeedEntityError(phase, `${entity}:${key}`, model.modelName ?? entity, error);
    }
    return _id;
}

async function assertPhoneAvailable(phone: string, intendedId: mongoose.Types.ObjectId) {
    const conflict = await User.findOne({ phone, _id: { $ne: intendedId } }).select('_id role').lean().exec();
    if (conflict) throw new Error(`Demo phone ${phone} is already owned by another account; refusing to overwrite it.`);
}

async function seedUsers(entity: 'doctor-user' | 'nurse-user' | 'pharmacy-user', names: readonly (readonly [string, string])[] | readonly string[], phonePrefix: string, role: string, passwordHash: string) {
    const ids: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < names.length; index++) {
        const key = `${entity.split('-')[0]}-${index + 1}`;
        const id = deterministicObjectId(entity, key);
        const phone = `${phonePrefix}${String(index + 1).padStart(2, '0')}`;
        await assertPhoneAvailable(phone, id);
        const item = names[index]!;
        const fullName = typeof item === 'string' ? item : item[0];
        await upsert(User, entity, key, {
            full_name: fullName, phone, ...credentialDocument(passwordHash), role,
            status: IUserStatusEnum.ACTIVE, is_phone_verified: true, is_email_verified: false,
            must_change_pin: false,
        });
        ids.push(id);
    }
    return ids;
}

export async function resetMobileSeed(): Promise<Record<string, number>> {
    const removed: Record<string, number> = {};
    const removeIds = async (label: string, model: Model, entity: ResetEntity, idEntity?: string) => {
        const result = await model.deleteMany({ _id: { $in: knownSeedIds(entity, idEntity) } }) as { deletedCount?: number };
        removed[label] = result.deletedCount ?? 0;
    };
    const notificationIds = [
        ...knownSeedIds('publicNotifications', 'notification'),
        ...knownSeedIds('targetedNotifications', 'notification'),
    ];
    const deliveryResult = await NotificationDelivery.deleteMany({ notification_id: { $in: notificationIds } });
    removed.NotificationDeliveries = deliveryResult.deletedCount;
    await removeIds('NotificationReads', NotificationRead, 'notificationReads', 'notification-read');
    await removeIds('NotificationRecipients', NotificationRecipient, 'notificationRecipients', 'notification-recipient');
    const notificationResult = await Notification.deleteMany({ _id: { $in: notificationIds } });
    removed.Notifications = notificationResult.deletedCount;
    await removeIds('PharmacyRequests', PharmacyTreatmentRequest, 'pharmacyRequests', 'pharmacy-request');
    await removeIds('HomeCareRequests', HomeCareRequest, 'homeCareRequests', 'home-care-request');
    await removeIds('Appointments', Appointment, 'appointments', 'appointment');
    await removeIds('Favorites', DoctorFavorite, 'favorites', 'favorite');
    await removeIds('ChildHealthProfiles', ChildHealthProfile, 'childHealthProfiles', 'child-health-profile');
    await removeIds('Children', PatientChild, 'children', 'child');
    await removeIds('HealthProfiles', PatientHealthProfile, 'healthProfiles', 'health-profile');
    await removeIds('Suggestions', Suggestion, 'suggestions', 'suggestion');
    await removeIds('Patients', Patient, 'patients', 'patient');
    await removeIds('Availabilities', DoctorAvailability, 'availabilities', 'availability');
    await removeIds('Nurses', Nurse, 'nurses', 'nurse');
    await removeIds('Pharmacies', Pharmacy, 'pharmacies', 'pharmacy');
    await removeIds('Doctors', Doctor, 'doctors', 'doctor');
    await removeIds('HomeCareServices', HomeCareService, 'homeCareServices', 'home-care-service');
    await removeIds('HomeCareCategories', HomeCareCategory, 'homeCareCategories', 'home-care-category');
    await removeIds('Ads', Ads, 'ads', 'ad');
    await removeIds('AboutUs', AboutUs, 'aboutUs', 'about-us');
    await removeIds('Clinics', Clinic, 'clinics', 'clinic');
    await removeIds('Specialties', Specialty, 'specialties', 'specialty');
    await removeIds('DoctorUsers', User, 'doctorUsers', 'doctor-user');
    await removeIds('NurseUsers', User, 'nurseUsers', 'nurse-user');
    await removeIds('PharmacyUsers', User, 'pharmacyUsers', 'pharmacy-user');
    await removeIds('PatientUsers', User, 'patientUsers', 'patient-user');
    return removed;
}

export function resetScopeDescription() {
    return Object.entries(RESET_ENTITY_KEYS).map(([entity, keys]) => ({ entity, count: keys.length }));
}

export async function seedMobileDataset(now: Date, imageMode: SeedImageMode): Promise<SeedIds> {
    const dates = relativeDates(now);
    const passwordHash = await hashPassword(DEMO_PIN);

    const specialtyIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < SPECIALTIES.length; index++) {
        const [name, description] = SPECIALTIES[index]!;
        specialtyIds.push(await upsert(Specialty, 'specialty', `specialty-${index + 1}`, {
            name, description, icon: imageMode === 'remote' ? `https://placehold.co/256x256/0f766e/ffffff.png?text=S${index + 1}` : null,
            status: ISpecialtyStatusEnum.ACTIVE, sort_order: (index + 1) * 10, created_by: null,
        }));
    }

    const clinicIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < CLINICS.length; index++) {
        const [name, address, lat, lng] = CLINICS[index]!;
        clinicIds.push(await upsert(Clinic, 'clinic', `clinic-${index + 1}`, {
            name, description: 'منشأة صحية خيالية مخصصة لبيانات العرض والتطوير فقط.', address,
            icon: imageMode === 'remote' ? `https://placehold.co/256x256/1d4ed8/ffffff.png?text=C${index + 1}` : null,
            map_location: { lat, lng }, status: IClinicStatusEnum.ACTIVE, created_by: null,
        }));
    }

    const doctorUserIds = await seedUsers('doctor-user', DOCTOR_NAMES, '078100000', IUserRoleEnum.DOCTOR, passwordHash);
    const doctorIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < DOCTOR_NAMES.length; index++) {
        const [name, gender] = DOCTOR_NAMES[index]!;
        const specialtyIndex = index % SPECIALTIES.length;
        const secondary = (specialtyIndex + 4) % SPECIALTIES.length;
        const clinicIndex = index % clinicIds.length;
        const photoSet = gender === 'male' ? IMAGE_MANIFEST.doctorMale : IMAGE_MANIFEST.doctorFemale;
        doctorIds.push(await upsert(Doctor, 'doctor', `doctor-${index + 1}`, {
            user_id: doctorUserIds[index], full_name: `د. ${name}`, display_name: `د. ${name}`, gender,
            profile_photo: optionalImage(imageMode, photoSet, index),
            bio: `طبيب تجريبي بخبرة في ${SPECIALTIES[specialtyIndex]![0]}. هذا الملف مخصص لعرض التطبيق فقط.`,
            primary_specialty_id: specialtyIds[specialtyIndex], specialty_ids: [specialtyIds[specialtyIndex], specialtyIds[secondary]],
            languages: index % 3 === 0 ? ['العربية', 'الإنجليزية'] : ['العربية'], experience_years: 4 + (index % 17),
            license_number: `DEMO-DR-${String(index + 1).padStart(3, '0')}`, ...DOCTOR_PUBLIC_VISIBILITY,
            clinic_ids: [clinicIds[clinicIndex], clinicIds[(clinicIndex + 1) % clinicIds.length]],
            map_location: { lat: CLINICS[clinicIndex]![2], lng: CLINICS[clinicIndex]![3] },
            appointment_duration: index % 4 === 0 ? 45 : 30, slot_interval: 30,
            buffer_before: index % 5 === 0 ? 10 : 0, buffer_after: index % 4 === 0 ? 10 : 0,
            accept_auto_booking: index % 2 === 0, allow_reschedule: true, booking_lead_time_hours: 1,
            cancellation_window_hours: 12 + (index % 3) * 6, max_appointments_per_day: 30,
            consultation_fee: 25000 + (index % 8) * 5000, follow_up_fee: 15000 + (index % 5) * 3000,
            currency: 'IQD', accepting_new_patients: index % 7 !== 0, is_featured: index < 8,
            display_order: (index + 1) * 10, assistant_ids: [],
            notes_internal: null,
        }));
    }
    for (let doctor = 0; doctor < doctorIds.length; doctor++) {
        for (let day = 0; day < 7; day++) {
            const periods = AVAILABILITY_PATTERNS[doctor % 3 === 0 ? 0 : 1];
            await upsert(DoctorAvailability, 'availability', `doctor-${doctor + 1}-day-${day}`, {
                doctor_id: doctorIds[doctor], clinic_id: clinicIds[doctor % clinicIds.length], day_of_week: day,
                periods, is_active: true,
            });
        }
    }

    for (let index = 0; index < 6; index++) {
        await upsert(Ads, 'ad', `ad-${index + 1}`, {
            title: null, description: null, image: IMAGE_MANIFEST.banners[index], status: IAdsStatusEnum.ACTIVE,
            sort_order: (index + 1) * 10, start_date: dates.at(-30, '00:00'), end_date: dates.at(90, '23:59'),
        });
    }
    await seedChronicConditions();

    const categoryIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < HOME_CARE_CATEGORIES.length; index++) {
        const [name, description, seedKey] = HOME_CARE_CATEGORIES[index]!;
        const normalized = normalizeHomeCareName(name).normalizedName;
        const existing = await HomeCareCategory.findOne({ $or: [{ seed_key: seedKey }, { normalized_name: normalized }] }).select('_id').lean().exec();
        const id = existing?._id ? new mongoose.Types.ObjectId(existing._id) : deterministicObjectId('home-care-category', `category-${index + 1}`);
        await HomeCareCategory.updateOne({ _id: id }, { $set: {
            name, normalized_name: normalized, description,
            icon: imageMode === 'remote' ? `https://placehold.co/256x256/7c3aed/ffffff.png?text=HC${index + 1}` : null,
            image: optionalImage(imageMode, IMAGE_MANIFEST.catalog, index), status: IHomeCareStatusEnum.ACTIVE,
            display_order: (index + 1) * 10, seed_key: seedKey, created_by: null,
        } }, { upsert: true, runValidators: true });
        categoryIds.push(id);
    }
    const serviceIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < HOME_CARE_SERVICES.length; index++) {
        const [name, category, price, durationMin, durationMax] = HOME_CARE_SERVICES[index]!;
        serviceIds.push(await upsert(HomeCareService, 'home-care-service', `service-${index + 1}`, {
            category_id: categoryIds[category], name, short_description: `${name} في المنزل بواسطة كادر تجريبي مؤهل.`,
            description: `خدمة ${name} مخصصة لعرض تجربة كانيولا ولا تمثل عرضاً طبياً حقيقياً.`,
            image: optionalImage(imageMode, IMAGE_MANIFEST.catalog, index), duration_min: durationMin,
            duration_max: durationMax, price, status: IHomeCareStatusEnum.ACTIVE,
            display_order: (index + 1) * 10, created_by: null,
        }));
    }

    const nurseUserIds = await seedUsers('nurse-user', NURSE_NAMES, '078200000', IUserRoleEnum.NURSE, passwordHash);
    const nurseIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < NURSE_NAMES.length; index++) {
        const [name, gender] = NURSE_NAMES[index]!;
        nurseIds.push(await upsert(Nurse, 'nurse', `nurse-${index + 1}`, {
            user_id: nurseUserIds[index], full_name: name, gender,
            profile_photo: optionalImage(imageMode, gender === 'male' ? IMAGE_MANIFEST.doctorMale : IMAGE_MANIFEST.doctorFemale, index),
            specialty: index % 2 === 0 ? 'تمريض منزلي' : 'رعاية كبار السن',
            license_number: `DEMO-NURSE-${index + 1}`, license_verified: true, experience_years: 3 + index,
            qualified_service_ids: serviceIds.filter((_, serviceIndex) => serviceIndex % NURSE_NAMES.length === index || serviceIndex % 3 === index % 3),
            status: INurseStatusEnum.ACTIVE, notes_internal: null,
        }));
    }

    const pharmacyUserIds = await seedUsers('pharmacy-user', PHARMACY_NAMES, '078300000', IUserRoleEnum.PHARMACY, passwordHash);
    const pharmacyIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < PHARMACY_NAMES.length; index++) {
        pharmacyIds.push(await upsert(Pharmacy, 'pharmacy', `pharmacy-${index + 1}`, {
            user_id: pharmacyUserIds[index], name: PHARMACY_NAMES[index], display_name: PHARMACY_NAMES[index],
            logo: optionalImage(imageMode, IMAGE_MANIFEST.pharmacy, index), phone: `078300000${String(index + 1).padStart(2, '0')}`,
            license_number: `DEMO-PH-${index + 1}`, license_verified: true,
            address: { address_text: CLINICS[index]![1], lat: CLINICS[index]![2], lng: CLINICS[index]![3] },
            accepts_prescription_requests: true, status: IPharmacyStatusEnum.ACTIVE, notes_internal: null,
        }));
    }

    const demoPatientUserId = deterministicObjectId('patient-user', 'mobile-demo');
    await assertPhoneAvailable(DEMO_PHONE, demoPatientUserId);
    await upsert(User, 'patient-user', 'mobile-demo', {
        full_name: 'مريض كانيولا التجريبي', phone: DEMO_PHONE, ...credentialDocument(passwordHash),
        role: IUserRoleEnum.PATIENT, status: IUserStatusEnum.ACTIVE, is_phone_verified: true,
        is_email_verified: false, must_change_pin: false,
    });
    const demoPatientProfileId = await upsert(Patient, 'patient', 'mobile-demo', {
        user_id: demoPatientUserId, full_name: 'مريض كانيولا التجريبي', gender: 'male',
        date_of_birth: new Date('1992-04-15T00:00:00.000Z'), phone: DEMO_PHONE,
        address: 'بغداد - المنصور - عنوان تجريبي',
        profile_photo: optionalImage(imageMode, IMAGE_MANIFEST.doctorMale, 2), status: IPatientStatusEnum.ACTIVE,
        notes_internal: null,
    });
    const chronic = await ChronicCondition.find({ name: { $in: ['السكري', 'ارتفاع ضغط الدم', 'الربو'] } }).select('_id').lean().exec();
    await upsert(PatientHealthProfile, 'health-profile', 'mobile-demo', {
        patient_id: demoPatientProfileId, blood_type: BloodTypeEnum.O_POSITIVE, weight: 78, height: 176,
        allergies: ['البنسلين', 'الغبار'], chronic_condition_ids: chronic.map(item => item._id),
        current_medications: ['دواء تجريبي أ', 'دواء تجريبي ب'], medical_notes: 'بيانات صحية تجريبية غير حقيقية.',
    });
    const children = [
        { key: 'ali', full_name: 'علي التجريبي', gender: 'male', relationship: PatientChildRelationshipEnum.SON, dob: '2017-03-10' },
        { key: 'zainab', full_name: 'زينب التجريبية', gender: 'female', relationship: PatientChildRelationshipEnum.DAUGHTER, dob: '2021-08-22' },
    ] as const;
    const childIds: mongoose.Types.ObjectId[] = [];
    for (let index = 0; index < children.length; index++) {
        const child = children[index]!;
        const childId = await upsert(PatientChild, 'child', child.key, {
            patient_id: demoPatientProfileId, full_name: child.full_name, date_of_birth: new Date(`${child.dob}T00:00:00.000Z`),
            gender: child.gender, relationship: child.relationship,
            photo: optionalImage(imageMode, child.gender === 'male' ? IMAGE_MANIFEST.doctorMale : IMAGE_MANIFEST.doctorFemale, index),
            status: PatientChildStatusEnum.ACTIVE,
        });
        childIds.push(childId);
        await upsert(ChildHealthProfile, 'child-health-profile', child.key, {
            child_id: childId, blood_type: index === 0 ? BloodTypeEnum.A_POSITIVE : BloodTypeEnum.B_POSITIVE,
            allergies: index === 0 ? ['الغبار'] : [], chronic_condition_ids: [], current_medications: [], medical_notes: null,
        });
    }
    for (let index = 0; index < 5; index++) {
        await upsert(DoctorFavorite, 'favorite', `favorite-${index + 1}`, {
            patient_id: demoPatientProfileId, doctor_id: doctorIds[index],
        });
    }

    const appointmentDays = [1, 2, 4, -7, -14, -3, -2];
    for (let index = 0; index < APPOINTMENT_STATES.length; index++) {
        const status = APPOINTMENT_STATES[index]!, startsAt = dates.at(appointmentDays[index]!, index % 2 ? '17:00' : '10:00');
        const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
        const cancelled = status === IAppointmentStatusEnum.CANCELLED;
        await upsert(Appointment, 'appointment', `appointment-${index + 1}`, {
            appointment_number: `DEMO-APP-${String(index + 1).padStart(3, '0')}`,
            patient_id: demoPatientProfileId, beneficiary_type: index === 4 ? AppointmentBeneficiaryTypeEnum.CHILD : AppointmentBeneficiaryTypeEnum.SELF,
            child_id: index === 4 ? childIds[0] : null, doctor_id: doctorIds[index], clinic_id: clinicIds[index % clinicIds.length],
            specialty_id: specialtyIds[index % specialtyIds.length], local_date: dates.localDate(appointmentDays[index]!),
            starts_at: startsAt, ends_at: endsAt, blocked_starts_at: startsAt, blocked_ends_at: endsAt, status,
            booking_source: IAppointmentBookingSourceEnum.APP, booked_by_user_id: demoPatientUserId,
            reason: 'استشارة تجريبية لعرض شاشة المواعيد', notes_internal: null,
            snapshot: {
                doctor: { display_name: `د. ${DOCTOR_NAMES[index]![0]}`, profile_photo: optionalImage(imageMode, DOCTOR_NAMES[index]![1] === 'male' ? IMAGE_MANIFEST.doctorMale : IMAGE_MANIFEST.doctorFemale, index) },
                clinic: { name: CLINICS[index % CLINICS.length]![0], address: CLINICS[index % CLINICS.length]![1] },
                specialty: { name: SPECIALTIES[index % SPECIALTIES.length]![0] },
                beneficiary: { type: index === 4 ? AppointmentBeneficiaryTypeEnum.CHILD : AppointmentBeneficiaryTypeEnum.SELF, display_name: index === 4 ? children[0].full_name : 'مريض كانيولا التجريبي' },
                pricing: { fee: 25000 + index * 5000, currency: 'IQD' },
            }, payment_status: index === 3 ? IAppointmentPaymentStatusEnum.PAID : IAppointmentPaymentStatusEnum.UNPAID,
            cancellation: cancelled ? { reason: 'إلغاء تجريبي', actor_type: AppointmentActorTypeEnum.PATIENT, actor_user_id: demoPatientUserId, at: dates.at(-4, '12:00') } : null,
            rescheduled_from: null, rescheduled_to: null,
            confirmed_at: status === IAppointmentStatusEnum.PENDING ? null : dates.at(appointmentDays[index]! - 1, '12:00'),
            completed_at: status === IAppointmentStatusEnum.COMPLETED ? endsAt : null,
            no_show_at: status === IAppointmentStatusEnum.NO_SHOW ? endsAt : null,
            workflow_version: index + 1,
        });
    }

    for (let index = 0; index < HOME_CARE_STATES.length; index++) {
        const status = HOME_CARE_STATES[index]!, assigned = ![IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED].includes(status as any);
        const terminal = [IHomeCareRequestStatusEnum.COMPLETED, IHomeCareRequestStatusEnum.CANCELLED].includes(status as any);
        const serviceIndex = index % serviceIds.length;
        await upsert(HomeCareRequest, 'home-care-request', `home-care-request-${index + 1}`, {
            request_number: `DEMO-HC-${String(index + 1).padStart(3, '0')}`, patient_id: demoPatientProfileId,
            child_id: index === 2 ? childIds[1] : null, category_id: categoryIds[HOME_CARE_SERVICES[serviceIndex]![1]], service_id: serviceIds[serviceIndex],
            service_name: HOME_CARE_SERVICES[serviceIndex]![0], service_price: HOME_CARE_SERVICES[serviceIndex]![2],
            service_duration_min: HOME_CARE_SERVICES[serviceIndex]![3], service_duration_max: HOME_CARE_SERVICES[serviceIndex]![4],
            requested_date: dates.at(index < 5 ? index + 1 : index - 9, '10:00'), preferred_time: index % 2 ? '17:00' : '10:00',
            address: { address_text: 'بغداد - المنصور - عنوان تجريبي', lat: 33.3152, lng: 44.3661 },
            notes: 'طلب رعاية منزلي تجريبي', status,
            dispatch: { status: terminal ? IHomeCareDispatchStatusEnum.CLOSED : assigned ? IHomeCareDispatchStatusEnum.CLAIMED : IHomeCareDispatchStatusEnum.OPEN,
                mode: assigned ? IHomeCareDispatchModeEnum.ADMIN_DIRECT : IHomeCareDispatchModeEnum.OPEN_POOL,
                nurse_id: assigned ? nurseIds[index % nurseIds.length] : null, assigned_at: assigned ? dates.at(-1, '09:00') : null,
                assigned_by_user_id: null, version: assigned ? 1 : 0 },
            internal_notes: null, cancelled_at: status === IHomeCareRequestStatusEnum.CANCELLED ? dates.at(-1, '15:00') : null,
            cancelled_by: status === IHomeCareRequestStatusEnum.CANCELLED ? { id: demoPatientUserId, type: IHomeCareRequestCancelledByTypeEnum.PATIENT } : null,
            cancellation_reason: status === IHomeCareRequestStatusEnum.CANCELLED ? 'إلغاء تجريبي' : null,
        });
    }

    for (let index = 0; index < PHARMACY_STATES.length; index++) {
        const status = PHARMACY_STATES[index]!, pharmacyId = pharmacyIds[index % pharmacyIds.length]!;
        const hasQuote = ![PharmacyRequestStatusEnum.OPEN, PharmacyRequestStatusEnum.UNDER_REVIEW, PharmacyRequestStatusEnum.CANCELLED].includes(status as any);
        const accepted = hasQuote && status !== PharmacyRequestStatusEnum.WAITING_CUSTOMER_APPROVAL;
        const quotation = hasQuote ? { version: 1, pharmacy_id: pharmacyId,
            items: [{ name: 'دواء تجريبي للعرض', quantity: 1, unit_price: 12000, line_total: 12000, note: null }],
            unavailable_items: [], medicines_subtotal: 12000, delivery_fee: 3000, discount: 0, total_price: 15000,
            pharmacy_note: 'عرض سعر تجريبي فقط', quoted_at: dates.at(-1, '10:00'), accepted_at: accepted ? dates.at(-1, '11:00') : null } : null;
        await upsert(PharmacyTreatmentRequest, 'pharmacy-request', `pharmacy-request-${index + 1}`, {
            request_number: `DEMO-RX-${String(index + 1).padStart(3, '0')}`, patient_id: demoPatientProfileId,
            child_id: index === 1 ? childIds[0] : null, prescription_images: [],
            treatment_details: 'وصفة تجريبية تحتوي على دواء تجريبي للعرض فقط.',
            delivery_address: { address_text: 'بغداد - المنصور - عنوان تجريبي', lat: 33.3152, lng: 44.3661 },
            delivery_phone: DEMO_PHONE, notes: 'يرجى الاتصال قبل الوصول',
            preferred_payment_method: index % 3 === 0 ? PharmacyPaymentMethodEnum.CARD : PharmacyPaymentMethodEnum.CASH_ON_DELIVERY,
            status, workflowVersion: index + 1,
            dispatch: { status: status === PharmacyRequestStatusEnum.OPEN ? PharmacyDispatchStatusEnum.OPEN : status === PharmacyRequestStatusEnum.CANCELLED || status === PharmacyRequestStatusEnum.DELIVERED ? PharmacyDispatchStatusEnum.CLOSED : PharmacyDispatchStatusEnum.CLAIMED,
                mode: status === PharmacyRequestStatusEnum.OPEN ? PharmacyDispatchModeEnum.OPEN_POOL : PharmacyDispatchModeEnum.ADMIN_DIRECT,
                pharmacy_id: status === PharmacyRequestStatusEnum.OPEN ? null : pharmacyId,
                assigned_at: status === PharmacyRequestStatusEnum.OPEN ? null : dates.at(-2, '09:00'), assigned_by_user_id: null, version: status === PharmacyRequestStatusEnum.OPEN ? 0 : 1 },
            quotation, accepted_quotation: accepted ? quotation : null, excluded_pharmacy_ids: [],
            cancelled_at: status === PharmacyRequestStatusEnum.CANCELLED ? dates.at(-1, '13:00') : null,
            cancelled_by_user_id: status === PharmacyRequestStatusEnum.CANCELLED ? demoPatientUserId : null,
            cancellation_actor_type: status === PharmacyRequestStatusEnum.CANCELLED ? 'PATIENT' : null,
            cancellation_reason: status === PharmacyRequestStatusEnum.CANCELLED ? 'إلغاء طلب تجريبي' : null,
        });
    }

    for (let index = 0; index < SUGGESTIONS.length; index++) {
        const existing = await Suggestion.exists({ suggestion: SUGGESTIONS[index], is_deleted: false });
        if (existing) continue;
        await upsert(Suggestion, 'suggestion', `suggestion-${index + 1}`, {
            user_id: demoPatientUserId, suggestion: SUGGESTIONS[index], is_deleted: false, deleted_at: null, deleted_by: null,
        });
    }
    const existingAbout = await AboutUs.findOne().select('_id').lean().exec();
    if (!existingAbout) {
        await upsert(AboutUs, 'about-us', 'cannula-demo', {
            name: 'كانيولا', logo: IMAGE_MANIFEST.placeholder,
            description: 'كانيولا منصة رقمية تربط المستخدمين بخدمات صحية متنوعة. هذه البيانات مخصصة لبيئة العرض والتطوير.',
            address: 'بغداد، العراق', phone: DEMO_PHONE, website: 'https://example.com/cannula-demo',
            facebook: null, instagram: null,
        });
    }

    const expiresAt = dates.at(90, '23:59');
    for (let index = 0; index < PUBLIC_NOTIFICATIONS.length; index++) {
        const [title, body, category] = PUBLIC_NOTIFICATIONS[index]!;
        await upsert(Notification, 'notification', `public-${index + 1}`, {
            audience: INotificationAudienceEnum.PUBLIC, category, privacy: INotificationPrivacyEnum.NORMAL,
            source: null, target: null, visible_at: dates.at(-index, '09:00'), expires_at: expiresAt,
            dedupe_key: `mobile-seed:public:${index + 1}`, recipient_ids: [], recipient_model: INotificationRecipientModelEnum.ALL,
            type: INotificationTypeEnum.GENERAL, title, body, data: { demo: true }, is_read: false,
            read_at: null, status: NOTIFICATION_SEED_POLICY.status, scheduled_at: null, sent_at: dates.at(-index, '09:00'),
            failed_reason: null, appointment_id: null,
        });
    }
    for (let index = 0; index < TARGETED_NOTIFICATIONS.length; index++) {
        const [title, body, category, type] = TARGETED_NOTIFICATIONS[index]!;
        const notificationId = await upsert(Notification, 'notification', `targeted-${index + 1}`, {
            audience: INotificationAudienceEnum.TARGETED, category, privacy: INotificationPrivacyEnum.NORMAL,
            source: null, target: null, visible_at: dates.at(-index, '11:00'), expires_at: expiresAt,
            dedupe_key: `mobile-seed:targeted:${index + 1}:${demoPatientUserId}`, recipient_ids: [],
            recipient_model: INotificationRecipientModelEnum.USER, type, title, body, data: { demo: true },
            is_read: false, read_at: null, status: NOTIFICATION_SEED_POLICY.status,
            scheduled_at: null, sent_at: dates.at(-index, '11:00'), failed_reason: null, appointment_id: null,
        });
        await upsert(NotificationRecipient, 'notification-recipient', `targeted-${index + 1}`, {
            notification_id: notificationId, user_id: demoPatientUserId, expires_at: expiresAt,
        });
        if (index < 4) await upsert(NotificationRead, 'notification-read', `targeted-${index + 1}`, {
            notification_id: notificationId, reader_type: INotificationReaderTypeEnum.USER,
            user_id: demoPatientUserId, installation_key_hash: null, read_at: dates.at(-index, '12:00'), expires_at: expiresAt,
        });
    }
    await NotificationDelivery.deleteMany({ notification_id: { $in: [
        ...knownSeedIds('publicNotifications', 'notification'), ...knownSeedIds('targetedNotifications', 'notification'),
    ] } });
    return { demoPatientUserId, demoPatientProfileId, doctorIds, specialtyIds, clinicIds };
}

export async function invalidateMobileCaches(env: Record<string, string | undefined>): Promise<string> {
    if (!env.REDIS_HOST) return 'warning: REDIS_HOST is not configured; cache invalidation skipped';
    const protocol = env.REDIS_TLS === 'true' ? 'rediss:' : 'redis:';
    const url = new URL(`${protocol}//${env.REDIS_HOST}:${env.REDIS_PORT ?? '6379'}`);
    if (env.REDIS_USERNAME) url.username = env.REDIS_USERNAME;
    if (env.REDIS_PASSWORD) url.password = env.REDIS_PASSWORD;
    const client = createClient({ url: url.toString(), database: env.REDIS_DATABASE ? Number(env.REDIS_DATABASE) : undefined });
    client.on('error', () => undefined);
    try {
        await client.connect();
        let deleted = 0;
        for (const pattern of ['cache:mobile:specialties:v1:*', 'cache:mobile:doctors:available:v1:*', 'cache:mobile:home-care:*', 'cache:mobile:ads:v1:*']) {
            for await (const found of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
                const keys = Array.isArray(found) ? found : [found];
                if (keys.length) deleted += await client.del(keys);
            }
        }
        return `cleared ${deleted} cached entries`;
    } catch {
        return 'warning: Redis unavailable; Mongo seed completed but mobile caches were not cleared';
    } finally {
        if (client.isOpen) await client.disconnect().catch(() => undefined);
    }
}

export function seedSummary(ids?: SeedIds) {
    return {
        counts: FIXTURE_COUNTS,
        demoPatientUserId: ids?.demoPatientUserId.toString() ?? deterministicObjectId('patient-user', 'mobile-demo').toString(),
        demoPatientProfileId: ids?.demoPatientProfileId.toString() ?? deterministicObjectId('patient', 'mobile-demo').toString(),
        doctorIds: (ids?.doctorIds ?? knownSeedIds('doctors', 'doctor')).map(String),
        specialtyIds: (ids?.specialtyIds ?? knownSeedIds('specialties', 'specialty')).map(String),
        clinicIds: (ids?.clinicIds ?? knownSeedIds('clinics', 'clinic')).map(String),
    };
}

export async function auditMobileSeed() {
    const publicNotificationIds = knownSeedIds('publicNotifications', 'notification');
    const targetedNotificationIds = knownSeedIds('targetedNotifications', 'notification');
    const notificationIds = [...publicNotificationIds, ...targetedNotificationIds];
    const doctorIds = knownSeedIds('doctors', 'doctor');
    const counts = {
        Specialties: await Specialty.countDocuments({ _id: { $in: knownSeedIds('specialties', 'specialty') } }),
        Clinics: await Clinic.countDocuments({ _id: { $in: knownSeedIds('clinics', 'clinic') } }),
        Doctors: await Doctor.countDocuments({ _id: { $in: doctorIds } }),
        DoctorAvailabilities: await DoctorAvailability.countDocuments({ _id: { $in: knownSeedIds('availabilities', 'availability') } }),
        Ads: await Ads.countDocuments({ _id: { $in: knownSeedIds('ads', 'ad') } }),
        ChronicConditions: await ChronicCondition.countDocuments({ status: IChronicConditionStatusEnum.ACTIVE }),
        HomeCareCategories: await HomeCareCategory.countDocuments({ seed_key: { $in: HOME_CARE_CATEGORIES.map(item => item[2]) } }),
        HomeCareServices: await HomeCareService.countDocuments({ _id: { $in: knownSeedIds('homeCareServices', 'home-care-service') } }),
        Nurses: await Nurse.countDocuments({ _id: { $in: knownSeedIds('nurses', 'nurse') } }),
        Pharmacies: await Pharmacy.countDocuments({ _id: { $in: knownSeedIds('pharmacies', 'pharmacy') } }),
        Patients: await Patient.countDocuments({ _id: deterministicObjectId('patient', 'mobile-demo') }),
        Children: await PatientChild.countDocuments({ _id: { $in: knownSeedIds('children', 'child') } }),
        Favorites: await DoctorFavorite.countDocuments({ _id: { $in: knownSeedIds('favorites', 'favorite') } }),
        Appointments: await Appointment.countDocuments({ _id: { $in: knownSeedIds('appointments', 'appointment') } }),
        HomeCareRequests: await HomeCareRequest.countDocuments({ _id: { $in: knownSeedIds('homeCareRequests', 'home-care-request') } }),
        PharmacyRequests: await PharmacyTreatmentRequest.countDocuments({ _id: { $in: knownSeedIds('pharmacyRequests', 'pharmacy-request') } }),
        PublicNotifications: await Notification.countDocuments({ _id: { $in: publicNotificationIds }, audience: INotificationAudienceEnum.PUBLIC }),
        TargetedNotifications: await Notification.countDocuments({ _id: { $in: targetedNotificationIds }, audience: INotificationAudienceEnum.TARGETED }),
        NotificationReads: await NotificationRead.countDocuments({ _id: { $in: knownSeedIds('notificationReads', 'notification-read') } }),
        SharedSuggestions: await Suggestion.countDocuments({ suggestion: { $in: SUGGESTIONS }, is_deleted: false }),
    };
    const eligibleDoctors = await Doctor.countDocuments({
        _id: { $in: doctorIds }, ...DOCTOR_PUBLIC_VISIBILITY,
    });
    const doctorImages = await Doctor.countDocuments({ _id: { $in: doctorIds }, profile_photo: /^https:\/\// });
    const adImages = await Ads.countDocuments({ _id: { $in: knownSeedIds('ads', 'ad') }, image: /^https:\/\// });
    const pendingPublicPush = await NotificationDelivery.countDocuments({
        notification_id: { $in: notificationIds }, recipient_type: INotificationDeliveryRecipientTypeEnum.PUBLIC_BROADCAST,
        status: INotificationDeliveryStatusEnum.PENDING,
    });
    const pendingUserPush = await NotificationDelivery.countDocuments({
        notification_id: { $in: notificationIds }, recipient_type: INotificationDeliveryRecipientTypeEnum.USER,
        status: INotificationDeliveryStatusEnum.PENDING,
    });
    const user = await User.findById(deterministicObjectId('patient-user', 'mobile-demo')).select('+password_hash phone role status').lean().exec();
    return {
        counts, eligibleDoctors, doctorImages, adImages, pendingPublicPush, pendingUserPush,
        unreadTargeted: counts.TargetedNotifications - counts.NotificationReads,
        demoPatient: {
            exists: Boolean(user), phone: user?.phone ?? null, argon2Only: isArgon2Hash(user?.password_hash),
            pinValid: user?.password_hash ? await verifyPassword(DEMO_PIN, user.password_hash) : false,
        },
    };
}
