import { describe, expect, test } from 'bun:test';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { DASHBOARD_ROLES } from '../src/controller/dash/auth.controller';
import { IHomeCareDispatchModeEnum, IHomeCareDispatchStatusEnum, IHomeCareRequestStatusEnum } from '../src/interfaces/home-care-request.interface';
import Nurse from '../src/models/nurse.model';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import { SWAGGER_TAG_GROUPS, SWAGGER_TAGS } from '../src/constants/swagger-tags';

describe('Nurse identity and dispatch persistence', () => {
    test('supports Nurse dashboard identity without changing token role architecture', () => {
        expect(IUserRoleEnum.NURSE).toBe('nurse');
        expect(DASHBOARD_ROLES).toContain(IUserRoleEnum.NURSE);
        expect(DASHBOARD_ROLES).toEqual(['admin', 'doctor', 'nurse', 'pharmacy']);
    });

    test('defines the complete backward-compatible Home Care lifecycle and dispatch enums', () => {
        expect(Object.values(IHomeCareRequestStatusEnum)).toEqual([
            'pending', 'confirmed', 'assigned', 'on_the_way', 'arrived',
            'in_progress', 'completed', 'cancelled', 'rejected',
        ]);
        expect(Object.values(IHomeCareDispatchStatusEnum)).toEqual(['OPEN', 'CLAIMED', 'CLOSED']);
        expect(Object.values(IHomeCareDispatchModeEnum)).toEqual(['OPEN_POOL', 'ADMIN_DIRECT', 'ADMIN_REASSIGN']);
    });

    test('creates practical unique, pool, ownership, and history indexes', () => {
        const nurseIndexes = Nurse.schema.indexes();
        expect(nurseIndexes.some(([keys, options]) => keys.user_id === 1 && options.unique === true)).toBe(true);
        expect(nurseIndexes.some(([keys]) => keys.qualified_service_ids === 1 && keys.status === 1)).toBe(true);
        const requestIndexes = HomeCareRequest.schema.indexes();
        expect(requestIndexes.some(([keys]) => keys['dispatch.status'] === 1 && keys.service_id === 1)).toBe(true);
        expect(requestIndexes.some(([keys]) => keys['dispatch.nurse_id'] === 1 && keys.status === 1)).toBe(true);
        expect(HomeCareRequestHistory.schema.indexes().some(([keys]) => keys.request_id === 1 && keys.createdAt === 1)).toBe(true);
        expect(HomeCareRequestHistory.schema.path('updatedAt')).toBeUndefined();
    });

    test('registers Nurse and Admin Nurses in Scalar without regressing existing groups', () => {
        const groups = new Map(SWAGGER_TAG_GROUPS.map(group => [group.name, group.tags]));
        expect(groups.get('Nurse')).toEqual([SWAGGER_TAGS.NURSE.PROFILE, SWAGGER_TAGS.NURSE.HOME_CARE]);
        expect(groups.get('Admin')).toContain(SWAGGER_TAGS.ADMIN.NURSES);
        expect([...groups.keys()]).toEqual(['Dashboard', 'Admin', 'Doctor', 'Nurse', 'Pharmacy', 'Mobile']);
    });
});
