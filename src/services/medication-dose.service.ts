import mongoose from 'mongoose';
import MedicationDose from '../models/medication-dose.model';
import PatientMedication from '../models/patient-medication.model';
import medicationReminderService, { MEDICATION_GENERATION_WINDOW_DAYS, MEDICATION_REMINDER_BODY, MEDICATION_REMINDER_TITLE } from './medication-reminder.service';
import { DomainError } from './domain-error';
import { MedicationDoseStatusEnum } from '../interfaces/medication-dose.interface';
import { PATIENT_MEDICATION_DEFAULT_TIMEZONE, PatientMedicationStatusEnum } from '../interfaces/patient-medication.interface';
import { addLocalDays, dateOnlyInTimezone, zonedLocalToUtc } from './medication-schedule.service';

function validOwnedId(patientId: unknown, id: string) {
    return mongoose.Types.ObjectId.isValid(id) ? { _id: id, patient_id: patientId } : { _id: new mongoose.Types.ObjectId(), patient_id: patientId };
}

export function formatDose(dose: any) {
    return { id: String(dose._id), medication_id: String(dose.medication_id), medication: dose.medication_snapshot, scheduled_at: dose.scheduled_at, schedule_version: dose.schedule_version, status: dose.status, taken_at: dose.taken_at ?? null, recorded_at: dose.recorded_at ?? null };
}

export class MedicationDoseService {
    async today(patientId: unknown, now = new Date()) {
        await medicationReminderService.generateForPatient(patientId, now);
        const today = dateOnlyInTimezone(now, PATIENT_MEDICATION_DEFAULT_TIMEZONE);
        const from = zonedLocalToUtc(today, '00:00', PATIENT_MEDICATION_DEFAULT_TIMEZONE);
        const to = zonedLocalToUtc(addLocalDays(today, 1), '00:00', PATIENT_MEDICATION_DEFAULT_TIMEZONE);
        return (await MedicationDose.find({ patient_id: patientId, scheduled_at: { $gte: from, $lt: to }, status: { $ne: MedicationDoseStatusEnum.CANCELLED } }).sort({ scheduled_at: 1 }).lean().exec()).map(formatDose);
    }

    async record(patientId: unknown, id: string, status: typeof MedicationDoseStatusEnum.TAKEN | typeof MedicationDoseStatusEnum.NOT_TAKEN, now = new Date()) {
        const ownership = validOwnedId(patientId, id);
        const dose = await MedicationDose.findOneAndUpdate(
            { ...ownership, status: MedicationDoseStatusEnum.PENDING },
            { $set: { status, recorded_at: now, taken_at: status === MedicationDoseStatusEnum.TAKEN ? now : null } },
            { new: true },
        ).exec();
        if (dose) return formatDose(dose);
        const current = await MedicationDose.findOne(ownership).exec();
        if (!current || current.status === MedicationDoseStatusEnum.CANCELLED) throw new DomainError('جرعة الدواء غير موجودة', 404, 'MEDICATION_DOSE_NOT_FOUND');
        if (current.status === status) return formatDose(current);
        throw new DomainError('لا يمكن تغيير حالة جرعة مسجلة', 409, 'MEDICATION_DOSE_FINALIZED');
    }

    async upcoming(patientId: unknown, now = new Date()) {
        await medicationReminderService.generateForPatient(patientId, now);
        const until = new Date(now.getTime() + MEDICATION_GENERATION_WINDOW_DAYS * 86_400_000);
        const medications = await PatientMedication.find({ patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE, reminders_enabled: true }).select('_id schedule.timezone schedule_version').lean().exec();
        const medicationMap = new Map(medications.map(m => [String(m._id), m]));
        const doses = await MedicationDose.find({ patient_id: patientId, medication_id: { $in: medications.map(m => m._id) }, status: MedicationDoseStatusEnum.PENDING, scheduled_at: { $gt: now, $lte: until } }).sort({ scheduled_at: 1 }).lean().exec();
        return {
            generated_at: now,
            window_ends_at: until,
            schedules: medications.map(m => ({ medication_id: String(m._id), schedule_version: m.schedule_version, timezone: m.schedule.timezone })),
            reminders: doses.filter(d => medicationMap.get(String(d.medication_id))?.schedule_version === d.schedule_version).map(d => ({
                dose_id: String(d._id), medication_id: String(d.medication_id), scheduled_at: d.scheduled_at,
                timezone: medicationMap.get(String(d.medication_id))!.schedule.timezone,
                schedule_version: d.schedule_version, title: MEDICATION_REMINDER_TITLE, body: MEDICATION_REMINDER_BODY,
            })),
        };
    }
}

export default new MedicationDoseService();
