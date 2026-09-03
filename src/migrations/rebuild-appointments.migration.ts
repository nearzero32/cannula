import Appointment from '../models/appointments.model';
import DoctorAvailability from '../models/doctor-availability.model';
import DoctorAvailabilityException from '../models/doctor-availability-exception.model';
import AppointmentHistory from '../models/appointment-history.model';
import AppointmentCounter from '../models/appointment-counter.model';
import AppointmentDayLock from '../models/appointment-day-lock.model';

/**
 * Cannula has no production appointments. Discard records written by the
 * disposable v1 schema and reconcile only the indexes owned by the rebuilt
 * scheduling domain. The shape check makes this idempotent and preserves every
 * appointment created by the new UTC interval model.
 */
export async function rebuildAppointmentStorage(): Promise<{ discardedLegacyAppointments: number }> {
    const removed = await Appointment.collection.deleteMany({
        $or: [
            { starts_at: { $type: 'string' } },
            { ends_at: { $type: 'string' } },
            { blocked_starts_at: { $exists: false } },
            { blocked_ends_at: { $exists: false } },
        ],
    });

    await Promise.all([
        Appointment.syncIndexes(),
        DoctorAvailability.syncIndexes(),
        DoctorAvailabilityException.syncIndexes(),
        AppointmentHistory.syncIndexes(),
        AppointmentCounter.syncIndexes(),
        AppointmentDayLock.syncIndexes(),
    ]);
    console.log(`[Migration] Appointment storage rebuilt: ${removed.deletedCount} disposable legacy records discarded`);
    return { discardedLegacyAppointments: removed.deletedCount };
}
