import { describe, expect, test } from 'bun:test';
import { IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';
import Appointment, {
    APPOINTMENT_BLOCKING_STATUSES,
    APPOINTMENT_SLOT_INDEX_NAME,
} from '../src/models/appointments.model';

describe('Appointment slot index definition', () => {
    test('uses the exact four blocking lifecycle statuses in a positive partial filter', () => {
        expect(APPOINTMENT_BLOCKING_STATUSES).toEqual([
            IAppointmentStatusEnum.PENDING,
            IAppointmentStatusEnum.CONFIRMED,
            IAppointmentStatusEnum.CHECKED_IN,
            IAppointmentStatusEnum.IN_PROGRESS,
        ]);
        expect(APPOINTMENT_BLOCKING_STATUSES).not.toContain(IAppointmentStatusEnum.CANCELLED);
        expect(APPOINTMENT_BLOCKING_STATUSES).not.toContain(IAppointmentStatusEnum.NO_SHOW);
        expect(APPOINTMENT_BLOCKING_STATUSES).not.toContain(IAppointmentStatusEnum.RESCHEDULED);
        expect(APPOINTMENT_BLOCKING_STATUSES).not.toContain(IAppointmentStatusEnum.COMPLETED);

        const [key, options] = Appointment.schema.indexes().find(
            ([, candidate]) => candidate.name === APPOINTMENT_SLOT_INDEX_NAME
        )!;
        expect(key).toEqual({ doctor_id: 1, date: 1, starts_at: 1 });
        expect(options.unique).toBe(true);
        expect(options.partialFilterExpression).toEqual({
            status: { $in: [...APPOINTMENT_BLOCKING_STATUSES] },
        });
        expect(JSON.stringify(options.partialFilterExpression)).not.toContain('$nin');
    });
});
