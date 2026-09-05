import mongoose from 'mongoose';
import { DEMO_PHONE, DEMO_PIN, parseSeedArgs, RESET_ENTITY_KEYS, resolveConnectionPlan } from './mobile-seed/core';
import { FIXTURE_COUNTS } from './mobile-seed/fixtures';
import { invalidateMobileCaches, resetMobileSeed, resetScopeDescription, seedMobileDataset, seedSummary } from './mobile-seed/runner';

function printCounts(reset: boolean) {
    const resetEntity: Partial<Record<keyof typeof FIXTURE_COUNTS, keyof typeof RESET_ENTITY_KEYS>> = {
        Specialties: 'specialties', Clinics: 'clinics', Doctors: 'doctors', DoctorAvailabilities: 'availabilities',
        Ads: 'ads', HomeCareCategories: 'homeCareCategories', HomeCareServices: 'homeCareServices',
        Nurses: 'nurses', Pharmacies: 'pharmacies', PatientUsers: 'patientUsers', Patients: 'patients',
        Children: 'children', Appointments: 'appointments', HomeCareRequests: 'homeCareRequests',
        PharmacyRequests: 'pharmacyRequests', Favorites: 'favorites', PublicNotifications: 'publicNotifications',
        TargetedNotifications: 'targetedNotifications', NotificationReads: 'notificationReads',
        Suggestions: 'suggestions', AboutUs: 'aboutUs',
    };
    console.table(Object.entries(FIXTURE_COUNTS).map(([entity, count]) => ({
        entity, upsert: count,
        reset_candidates: reset && resetEntity[entity as keyof typeof FIXTURE_COUNTS]
            ? RESET_ENTITY_KEYS[resetEntity[entity as keyof typeof FIXTURE_COUNTS]!].length : 0,
    })));
}

export async function runMobileSeed(argv = Bun.argv.slice(2), env = process.env): Promise<void> {
    const options = parseSeedArgs(argv);
    const plan = resolveConnectionPlan(options, env);
    if (!options.json) {
        console.log('Cannula Mobile demo seed');
        console.log(`Target mode: ${plan.target}`);
        console.log(`Database host: ${plan.host}`);
        console.log(`Database name: ${plan.database}`);
        console.log(`Image mode: ${options.images}`);
    }

    if (options.dryRun) {
        const summary = seedSummary();
        if (options.json) console.log(JSON.stringify({ dryRun: true, target: plan.target, host: plan.host, database: plan.database, imageMode: options.images, ...summary }, null, 2));
        else {
            console.log('DRY RUN: zero database writes and zero password hashing were performed.');
            printCounts(options.reset);
            console.log(`Reset scope: ${options.reset ? resetScopeDescription().reduce((sum, item) => sum + item.count, 0) : 0} known deterministic IDs`);
            console.log(`DEMO MOBILE ACCOUNT\nPhone: ${DEMO_PHONE}\nPIN: ${DEMO_PIN}`);
        }
        return;
    }

    let ids: Awaited<ReturnType<typeof seedMobileDataset>> | undefined;
    try {
        await mongoose.connect(plan.uri, { serverSelectionTimeoutMS: 8_000, maxPoolSize: 5 });
        if (!options.json) console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
        const resetResult = options.reset ? await resetMobileSeed() : null;
        ids = await seedMobileDataset(new Date(), options.images);
        const cache = await invalidateMobileCaches(env);
        const summary = seedSummary(ids);
        if (options.json) {
            console.log(JSON.stringify({ dryRun: false, target: plan.target, host: plan.host, database: plan.database, imageMode: options.images, reset: resetResult, cache, ...summary }, null, 2));
        } else {
            if (resetResult) console.log(`Safe reset removed ${Object.values(resetResult).reduce((sum, count) => sum + count, 0)} known seed/dependent records.`);
            printCounts(false);
            console.log(`Cache invalidation: ${cache}`);
            console.log(`DEMO MOBILE ACCOUNT\nPhone: ${DEMO_PHONE}\nPIN: ${DEMO_PIN}`);
            console.log(`Demo Patient User ID: ${summary.demoPatientUserId}`);
            console.log('Mobile demo seed complete. Re-running this command converges on the same deterministic records.');
        }
    } finally {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
}

if (import.meta.main) {
    runMobileSeed().catch(error => {
        console.error(`Mobile seed failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
