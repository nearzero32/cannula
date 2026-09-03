import Doctor from '../models/doctors.model';
import Specialty from '../models/specialties.model';
import { DEFAULT_MAX_APPOINTMENTS_PER_DAY } from '../interfaces/doctor.interface';

/** One-time/idempotent development cleanup. Runtime booking never depends on legacy labels. */
export async function normalizeDoctorBookingSettings() {
    await Doctor.collection.updateMany(
        { max_appointments_per_day: { $exists: false } },
        { $set: { max_appointments_per_day: DEFAULT_MAX_APPOINTMENTS_PER_DAY } },
    );
    const legacyDoctors = await Doctor.collection.find({ primary_specialty_id: { $exists: false }, specialty: { $type: 'string' } }).toArray();
    for (const doctor of legacyDoctors) {
        const labels = [doctor.specialty, ...(Array.isArray(doctor.sub_specialties) ? doctor.sub_specialties : [])].filter((value): value is string => typeof value === 'string');
        const specialties = await Specialty.find({ name: { $in: labels } }).select('_id name').lean().exec();
        const primary = specialties.find(item => item.name === doctor.specialty);
        if (!primary) continue;
        const ids = [...new Map([primary, ...specialties].map(item => [String(item._id), item._id])).values()];
        await Doctor.collection.updateOne({ _id: doctor._id }, { $set: { primary_specialty_id: primary._id, specialty_ids: ids }, $unset: { specialty: '', sub_specialties: '' } });
    }
}
