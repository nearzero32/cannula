import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import HomeCareRequestCounter from '../src/models/home-care-request-counter.model';
import { HomeCareAvailabilityService } from '../src/services/home-care-availability.service';
import { HomeCareRequestService } from '../src/services/home-care-request.service';

const uri = process.env.MONGODB_TEST_URI;
const run = uri ? describe : describe.skip;
run('Home Care availability against MongoDB replica set', () => {
    const dbName = `cannula_home_care_availability_${Date.now()}`;
    let user: any, patient: any, category: any, serviceA: any, serviceB: any;
    const availability = new HomeCareAvailabilityService();
    const requests = new HomeCareRequestService({ homeCare: async () => null });
    const actor = () => ({ user_id: String(user._id), user_type: 'admin', source: 'dashboard' });
    beforeAll(async () => { await mongoose.connect(uri!, { dbName }); await Promise.all([User.syncIndexes(), Patient.syncIndexes(), HomeCareCategory.syncIndexes(), HomeCareService.syncIndexes(), HomeCareAvailabilitySlot.syncIndexes(), HomeCareRequest.syncIndexes(), HomeCareRequestHistory.syncIndexes(), HomeCareRequestCounter.syncIndexes()]); });
    beforeEach(async () => {
        await mongoose.connection.dropDatabase(); await Promise.all([User.syncIndexes(), Patient.syncIndexes(), HomeCareCategory.syncIndexes(), HomeCareService.syncIndexes(), HomeCareAvailabilitySlot.syncIndexes(), HomeCareRequest.syncIndexes(), HomeCareRequestHistory.syncIndexes(), HomeCareRequestCounter.syncIndexes()]);
        user = await User.create({ full_name: 'Patient', phone: `077${Date.now()}`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true });
        patient = await Patient.create({ user_id: user._id, full_name: 'Patient', status: 'active' });
        category = await HomeCareCategory.create({ name: 'Category', normalized_name: 'category', status: 'active' });
        [serviceA, serviceB] = await HomeCareService.create([{ category_id: category._id, name: 'A', price: 10000, status: 'active' }, { category_id: category._id, name: 'B', price: 12000, status: 'active' }]);
    });
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('unique time is per service and bulk replacement safely reuses/deactivates', async () => {
        await availability.create(String(serviceA._id), { time: '09:00' }, actor());
        await availability.create(String(serviceB._id), { time: '09:00' }, actor());
        await expect(availability.create(String(serviceA._id), { time: '09:00' }, actor())).rejects.toMatchObject({ status: 409 });
        const slots = await availability.replace(String(serviceA._id), ['11:00', '14:00'], actor());
        expect(slots.filter(x => x.status === 'active').map(x => x.time)).toEqual(['11:00', '14:00']);
        expect(await HomeCareAvailabilitySlot.countDocuments({ service_id: serviceA._id, time: '09:00', status: 'inactive' })).toBe(1);
    });

    test('request stores slot relationship and immutable time across edit/deactivation', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const request = await requests.createForPatient(patient._id, { service_id: String(serviceA._id), availability_slot_id: String(slot._id), requested_date: '2099-09-07', address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 } }, { user_id: String(user._id), user_type: 'patient', endpoint: '/mobile/home-care/requests', source: 'mobile' });
        expect(String(request.availability_slot_id)).toBe(String(slot._id));
        expect(request.preferred_time).toBe('11:00');
        await availability.update(String(serviceA._id), String(slot._id), { time: '12:00' }, actor());
        await availability.archive(String(serviceA._id), String(slot._id), actor());
        const historical = await HomeCareRequest.findById(request._id).lean();
        expect(historical?.preferred_time).toBe('11:00');
        expect(String(historical?.availability_slot_id)).toBe(String(slot._id));
        await expect(availability.requireAvailableForRequest(String(serviceA._id), String(slot._id))).rejects.toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE' });
    });

    test('service/category inactivity hides mobile availability', async () => {
        await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        expect(await availability.listForMobile(String(serviceA._id), '2099-09-07')).toHaveLength(1);
        await HomeCareCategory.updateOne({ _id: category._id }, { $set: { status: 'inactive' } });
        await expect(availability.listForMobile(String(serviceA._id), '2099-09-07')).rejects.toMatchObject({ status: 404 });
        await HomeCareCategory.updateOne({ _id: category._id }, { $set: { status: 'active' } });
        await HomeCareService.updateOne({ _id: serviceA._id }, { $set: { status: 'inactive' } });
        await expect(availability.listForMobile(String(serviceA._id), '2099-09-07')).rejects.toMatchObject({ status: 404 });
    });
});
