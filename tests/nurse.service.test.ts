import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Nurse from '../src/models/nurse.model';
import User from '../src/models/users.model';
import HomeCareService from '../src/models/home-care-service.model';
import ActivityLogService from '../src/services/activity-log.service';
import { NurseService } from '../src/services/nurse.service';
import { INurseStatusEnum } from '../src/interfaces/nurse.interface';

afterEach(() => mock.restore());
const userId = '507f191e810c19729de86201', serviceId = '507f191e810c19729de86202';
function query<T>(result: T) { return { exec: async () => result } as any; }
function actor() { return { user_id: '507f191e810c19729de86203', endpoint: '/dash/admin/nurses' }; }

describe('Nurse profile management', () => {
    test('Admin creates one Nurse profile only for a Nurse-role User with valid services', async () => {
        const service = new NurseService();
        spyOn(User, 'findById').mockReturnValue(query({ _id: userId, role: 'nurse' }));
        spyOn(Nurse, 'findOne').mockReturnValue(query(null));
        spyOn(HomeCareService, 'countDocuments').mockReturnValue(query(1));
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        const created = { _id: new mongoose.Types.ObjectId(), user_id: new mongoose.Types.ObjectId(userId), full_name: 'سارة', qualified_service_ids: [new mongoose.Types.ObjectId(serviceId)], status: INurseStatusEnum.ACTIVE, toObject: () => ({}) };
        const create = spyOn(Nurse, 'create').mockResolvedValue(created as never);
        const result = await service.create({ user_id: userId, full_name: 'سارة', qualified_service_ids: [serviceId], status: INurseStatusEnum.ACTIVE }, actor());
        expect(result).toBe(created as never);
        expect(String((create.mock.calls[0][0] as any).qualified_service_ids[0])).toBe(serviceId);
    });

    test('rejects duplicate Nurse profile and non-Nurse User role', async () => {
        const service = new NurseService();
        spyOn(User, 'findById').mockReturnValue(query({ _id: userId, role: 'doctor' })); spyOn(Nurse, 'findOne').mockReturnValue(query(null));
        await expect(service.create({ user_id: userId, full_name: 'سارة', qualified_service_ids: [] }, actor())).rejects.toThrow('دور المستخدم');
        mock.restore();
        spyOn(User, 'findById').mockReturnValue(query({ _id: userId, role: 'nurse' })); spyOn(Nurse, 'findOne').mockReturnValue(query({ _id: 'duplicate' }));
        await expect(service.create({ user_id: userId, full_name: 'سارة', qualified_service_ids: [] }, actor())).rejects.toMatchObject({ status: 409 });
    });

    test('rejects missing qualified Home Care service ids', async () => {
        const service = new NurseService();
        spyOn(User, 'findById').mockReturnValue(query({ _id: userId, role: 'nurse' })); spyOn(Nurse, 'findOne').mockReturnValue(query(null));
        spyOn(HomeCareService, 'countDocuments').mockReturnValue(query(0));
        await expect(service.create({ user_id: userId, full_name: 'سارة', qualified_service_ids: [serviceId] }, actor())).rejects.toThrow('غير موجودة');
    });

    test('inactive and suspended Nurses cannot perform operational actions', async () => {
        const service = new NurseService();
        for (const status of [INurseStatusEnum.INACTIVE, INurseStatusEnum.SUSPENDED]) {
            spyOn(service, 'getByUserId').mockResolvedValue({ status } as never);
            await expect(service.requireActiveByUserId(userId)).rejects.toMatchObject({ status: 403 });
            mock.restore();
        }
    });
});
