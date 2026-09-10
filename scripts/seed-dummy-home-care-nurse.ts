import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Nurse from '../src/models/nurse.model';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import { hashPassword } from '../src/constants/hashing';
import { IUserRoleEnum, IUserStatusEnum } from '../src/interfaces/user.interface';
import { INurseGenderEnum, INurseStatusEnum } from '../src/interfaces/nurse.interface';
import {
    HOME_CARE_WEEKDAYS,
    HomeCareWeekdayEnum,
    IHomeCareStatusEnum,
} from '../src/interfaces/home-care.interface';
import homeCareDispatchService from '../src/services/home-care-dispatch.service';
import { migrateHomeCareWeeklyAvailability } from '../src/migrations/home-care-weekly-availability.migration';

export const DUMMY_HOME_CARE_NURSE_COMMAND = 'bun run seed:dummy-home-care-nurse';
export const DUMMY_HOME_CARE_NURSE_NAME = 'محمد تقي';
export const DUMMY_HOME_CARE_NURSE_PHONE = '+9647700000999';
export const DUMMY_HOME_CARE_NURSE_PASSWORD = 'DummyNurse!2026';

const LICENSE_NUMBER = 'DUMMY-HC-NURSE-001';
const CATEGORY_NAME = 'تمريض';
const SERVICE_NAME = 'حقن عضلية';
const OPEN_DAYS = HOME_CARE_WEEKDAYS.filter(day => day !== HomeCareWeekdayEnum.FRIDAY);
const SLOT_STARTS = Array.from(
    { length: 24 },
    (_, hour) => `${String(hour).padStart(2, '0')}:00`,
).filter(time => time !== '13:00');

function configuredDevelopmentUri(env: Record<string, string | undefined>): {
    uri: string;
    host: string;
    database: string;
} {
    const raw = env.MONGODB_URI?.trim();
    if (!raw) throw new Error('MONGODB_URI is not configured.');

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('MONGODB_URI is invalid.');
    }
    if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
        throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.');
    }
    if (!parsed.username && env.MONGODB_USER && env.MONGODB_PASSWORD) {
        parsed.username = env.MONGODB_USER;
        parsed.password = env.MONGODB_PASSWORD;
    }

    const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '(default)';
    const productionLike = env.NODE_ENV === 'production' ||
        /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(`${parsed.host} ${database}`);
    if (productionLike) {
        throw new Error('Refusing to insert dummy Home Care data into a production-like target.');
    }
    return { uri: parsed.toString(), host: parsed.host, database };
}

export async function runDummyHomeCareNurseSeed(
    env: Record<string, string | undefined> = process.env,
): Promise<void> {
    const target = configuredDevelopmentUri(env);
    await mongoose.connect(target.uri, { serverSelectionTimeoutMS: 8_000, maxPoolSize: 5 });

    try {
        await migrateHomeCareWeeklyAvailability();

        const category = await HomeCareCategory.findOne({
            name: CATEGORY_NAME,
            status: IHomeCareStatusEnum.ACTIVE,
        }).exec();
        if (!category) throw new Error(`Active Home Care category not found: ${CATEGORY_NAME}`);

        const service = await HomeCareService.findOne({
            category_id: category._id,
            name: SERVICE_NAME,
            status: IHomeCareStatusEnum.ACTIVE,
        }).exec();
        if (!service) throw new Error(`Active Home Care service not found: ${SERVICE_NAME}`);

        const conflictingUser = await User.findOne({
            phone: DUMMY_HOME_CARE_NURSE_PHONE,
            role: { $ne: IUserRoleEnum.NURSE },
        }).select('_id role').lean();
        if (conflictingUser) {
            throw new Error(`Dummy phone is already used by role ${conflictingUser.role}.`);
        }

        const passwordHash = await hashPassword(DUMMY_HOME_CARE_NURSE_PASSWORD);
        const session = await mongoose.startSession();
        let userId = '';
        let nurseId = '';
        try {
            await session.withTransaction(async () => {
                const user = await User.findOneAndUpdate(
                    { phone: DUMMY_HOME_CARE_NURSE_PHONE, role: IUserRoleEnum.NURSE },
                    {
                        $set: {
                            full_name: DUMMY_HOME_CARE_NURSE_NAME,
                            phone: DUMMY_HOME_CARE_NURSE_PHONE,
                            password_hash: passwordHash,
                            role: IUserRoleEnum.NURSE,
                            status: IUserStatusEnum.ACTIVE,
                            is_phone_verified: true,
                            is_email_verified: false,
                            must_change_pin: false,
                        },
                    },
                    { upsert: true, returnDocument: 'after', runValidators: true, session },
                ).exec();
                if (!user) throw new Error('User upsert failed.');
                userId = String(user._id);

                const nurse = await Nurse.findOneAndUpdate(
                    { user_id: user._id },
                    {
                        $set: {
                            user_id: user._id,
                            full_name: DUMMY_HOME_CARE_NURSE_NAME,
                            gender: INurseGenderEnum.MALE,
                            profile_photo: null,
                            specialty: 'تمريض الرعاية المنزلية',
                            license_number: LICENSE_NUMBER,
                            license_verified: true,
                            experience_years: 5,
                            qualified_service_ids: [service._id],
                            status: INurseStatusEnum.ACTIVE,
                            notes_internal: 'DUMMY HOME CARE NURSE - DEVELOPMENT TEST DATA',
                        },
                    },
                    { upsert: true, returnDocument: 'after', runValidators: true, session },
                ).exec();
                if (!nurse) throw new Error('Nurse upsert failed.');
                nurseId = String(nurse._id);

                await HomeCareAvailabilitySlot.updateMany(
                    {
                        service_id: service._id,
                        day_of_week: { $in: HOME_CARE_WEEKDAYS },
                        status: IHomeCareStatusEnum.ACTIVE,
                    },
                    { $set: { status: IHomeCareStatusEnum.INACTIVE } },
                    { session },
                );

                const desired = OPEN_DAYS.flatMap(day => SLOT_STARTS.map((time, index) => ({
                    day,
                    time,
                    displayOrder: (index + 1) * 10,
                })));
                await HomeCareAvailabilitySlot.bulkWrite(desired.map(item => ({
                    updateOne: {
                        filter: {
                            service_id: service._id,
                            day_of_week: item.day,
                            time: item.time,
                        },
                        update: {
                            $set: {
                                status: IHomeCareStatusEnum.ACTIVE,
                                display_order: item.displayOrder,
                            },
                        },
                        upsert: true,
                    },
                })), { ordered: true, session });
            });
        } finally {
            await session.endSession();
        }

        const [user, nurse, activeSlots, dispatch, matchingUsers, matchingNurses] = await Promise.all([
            User.findById(userId).select('full_name phone role status').lean(),
            Nurse.findById(nurseId).populate({
                path: 'qualified_service_ids',
                select: 'name status category_id',
            }).lean(),
            HomeCareAvailabilitySlot.find({
                service_id: service._id,
                status: IHomeCareStatusEnum.ACTIVE,
            }).sort({ display_order: 1, time: 1 }).lean(),
            homeCareDispatchService.listAvailable(userId, { page: 1, limit: 1 }),
            User.countDocuments({ phone: DUMMY_HOME_CARE_NURSE_PHONE, role: IUserRoleEnum.NURSE }),
            Nurse.countDocuments({ user_id: new mongoose.Types.ObjectId(userId) }),
        ]);
        if (!user || !nurse) throw new Error('Verification read failed.');

        const weeklyAvailability = HOME_CARE_WEEKDAYS.map(day => ({
            day,
            status: day === HomeCareWeekdayEnum.FRIDAY ? 'CLOSED' : 'OPEN',
            periods: day === HomeCareWeekdayEnum.FRIDAY
                ? []
                : ['00:00 -> 13:00', '14:00 -> end of day'],
            exactSlotStarts: activeSlots
                .filter(slot => slot.day_of_week === day)
                .map(slot => slot.time),
        }));
        const eligible = user.role === IUserRoleEnum.NURSE &&
            user.status === IUserStatusEnum.ACTIVE &&
            nurse.status === INurseStatusEnum.ACTIVE &&
            nurse.qualified_service_ids.length > 0;

        console.log(JSON.stringify({
            exactCommandExecuted: DUMMY_HOME_CARE_NURSE_COMMAND,
            target: {
                nodeEnv: env.NODE_ENV ?? null,
                host: target.host,
                database: target.database,
                timezone: 'Asia/Baghdad',
            },
            userId: String(user._id),
            nurseId: String(nurse._id),
            nurseName: nurse.full_name,
            status: { user: user.status, nurse: nurse.status },
            credentials: {
                phone: DUMMY_HOME_CARE_NURSE_PHONE,
                password: DUMMY_HOME_CARE_NURSE_PASSWORD,
            },
            idempotency: { matchingUsers, matchingNurses },
            homeCare: {
                eligible,
                currentlyConsideredAvailableByDispatchLogic: eligible,
                currentlyVisibleOpenRequestCount: dispatch.count,
                availabilityArchitecture: 'service-level weekly discrete start slots; no nurse-specific schedule or online-state field exists',
                breakPeriod: '13:00 -> 14:00 Asia/Baghdad',
                assignments: [{
                    categoryId: String(category._id),
                    categoryName: category.name,
                    serviceId: String(service._id),
                    serviceName: service.name,
                }],
                weeklyAvailability,
            },
        }, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

if (import.meta.main) {
    runDummyHomeCareNurseSeed().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
