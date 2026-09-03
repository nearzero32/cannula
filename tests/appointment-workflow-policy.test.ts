import { describe, expect, test } from 'bun:test';
import { IAppointmentStatusEnum as S } from '../src/interfaces/appointment.interface';
import { appointmentTransition, initialAppointmentStatus } from '../src/services/appointment-workflow.service';
import { DomainError } from '../src/services/domain-error';

describe('Appointment workflow policy', () => {
    test.each([
        ['confirm', S.PENDING, S.CONFIRMED],
        ['checkIn', S.CONFIRMED, S.CHECKED_IN],
        ['start', S.CHECKED_IN, S.IN_PROGRESS],
        ['complete', S.IN_PROGRESS, S.COMPLETED],
        ['noShow', S.CONFIRMED, S.NO_SHOW],
    ] as const)('%s allows %s -> %s', (action, from, to) => expect(appointmentTransition(action, from).to).toBe(to));

    test.each([
        ['confirm', S.COMPLETED], ['confirm', S.CANCELLED], ['checkIn', S.CANCELLED],
        ['complete', S.NO_SHOW], ['noShow', S.CHECKED_IN], ['start', S.PENDING],
    ] as const)('%s rejects illegal source %s', (action, from) => {
        try { appointmentTransition(action, from); throw new Error('expected rejection'); }
        catch (error) { expect(error).toBeInstanceOf(DomainError); expect((error as DomainError).code).toBe('APPOINTMENT_INVALID_TRANSITION'); expect((error as DomainError).status).toBe(409); }
    });

    test('auto-confirm policy and explicit Admin initial state are deterministic', () => {
        expect(initialAppointmentStatus(false)).toBe(S.PENDING);
        expect(initialAppointmentStatus(true)).toBe(S.CONFIRMED);
        expect(initialAppointmentStatus(true, S.PENDING)).toBe(S.PENDING);
        expect(initialAppointmentStatus(false, S.CONFIRMED)).toBe(S.CONFIRMED);
    });
});
