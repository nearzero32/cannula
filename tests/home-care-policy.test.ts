import { describe, expect, test } from 'bun:test';
import { canModifyHomeCarePrice, resolveHomeCareAccess } from '../src/services/home-care-policy.service';
import { IUserRoleEnum } from '../src/interfaces/user.interface';

describe('Home Care authorization', () => {
    test('Super Admin can create a service with price and update price', () => {
        const access = resolveHomeCareAccess(IUserRoleEnum.ADMIN, { is_active: true, super_admin: true });
        expect(access).toBe('manage');
        expect(canModifyHomeCarePrice(access)).toBe(true);
    });

    test('normal admin can read but cannot modify price', () => {
        const access = resolveHomeCareAccess(IUserRoleEnum.ADMIN, { is_active: true, super_admin: false });
        expect(access).toBe('read');
        expect(canModifyHomeCarePrice(access)).toBe(false);
    });

    test('doctor cannot modify price', () => {
        expect(canModifyHomeCarePrice(resolveHomeCareAccess(IUserRoleEnum.DOCTOR, null))).toBe(false);
    });

    test('patient cannot modify price', () => {
        expect(canModifyHomeCarePrice(resolveHomeCareAccess(IUserRoleEnum.PATIENT, null))).toBe(false);
    });

    test('unauthenticated caller and inactive admin cannot modify price', () => {
        expect(canModifyHomeCarePrice(undefined)).toBe(false);
        expect(canModifyHomeCarePrice(
            resolveHomeCareAccess(IUserRoleEnum.ADMIN, { is_active: false, super_admin: true })
        )).toBe(false);
    });
});

