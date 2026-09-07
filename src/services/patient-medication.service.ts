import mongoose from 'mongoose';
import PatientMedication from '../models/patient-medication.model';
import MedicationDose from '../models/medication-dose.model';
import { DomainError } from './domain-error';
import medicationReminderService from './medication-reminder.service';
import { normalizeSchedule, scheduleChanged } from './medication-schedule.service';
import { MedicationDoseStatusEnum } from '../interfaces/medication-dose.interface';
import { PATIENT_MEDICATION_MAX_ACTIVE, PatientMedicationStatusEnum, type PatientMedicationSchedule } from '../interfaces/patient-medication.interface';

type CreateInput = { name: string; strength_text?: string | null; dose_instructions?: string | null; notes?: string | null; schedule: Partial<PatientMedicationSchedule>; reminders_enabled?: boolean };
type UpdateInput = Partial<Omit<CreateInput, 'schedule'>> & { schedule?: Partial<PatientMedicationSchedule> };

function ownedFilter(patientId: unknown, id: string) {
    return mongoose.Types.ObjectId.isValid(id) ? { _id: id, patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE } : { _id: new mongoose.Types.ObjectId(), patient_id: patientId };
}

export function formatMedication(medication: any, nextDoseAt?: Date | null) {
    return {
        id: String(medication._id), name: medication.name, strength_text: medication.strength_text ?? null,
        dose_instructions: medication.dose_instructions ?? null, notes: medication.notes ?? null,
        schedule: medication.schedule, reminders_enabled: medication.reminders_enabled,
        schedule_version: medication.schedule_version, next_dose_at: nextDoseAt ?? null,
        status: medication.status, createdAt: medication.createdAt, updatedAt: medication.updatedAt,
    };
}

export class PatientMedicationService {
    async create(patientId: unknown, input: CreateInput, now = new Date()) {
        if (await PatientMedication.countDocuments({ patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE }) >= PATIENT_MEDICATION_MAX_ACTIVE) throw new DomainError('تم بلوغ الحد الأقصى للأدوية النشطة', 409, 'ACTIVE_MEDICATION_LIMIT');
        const medication = await PatientMedication.create({ ...input, patient_id: patientId, schedule: normalizeSchedule(input.schedule), schedule_version: 1, status: PatientMedicationStatusEnum.ACTIVE });
        await medicationReminderService.generateForMedication(medication, now);
        return medication;
    }

    async list(patientId: unknown, now = new Date()) {
        await medicationReminderService.generateForPatient(patientId, now);
        const medications = await PatientMedication.find({ patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE }).sort({ createdAt: -1 }).lean().exec();
        const next = await MedicationDose.aggregate([
            { $match: { patient_id: new mongoose.Types.ObjectId(String(patientId)), status: MedicationDoseStatusEnum.PENDING, scheduled_at: { $gt: now } } },
            { $sort: { scheduled_at: 1 } }, { $group: { _id: '$medication_id', next_dose_at: { $first: '$scheduled_at' } } },
        ]).exec();
        const map = new Map(next.map(row => [String(row._id), row.next_dose_at as Date]));
        return medications.map(medication => formatMedication(medication, map.get(String(medication._id)) ?? null));
    }

    async requireOwned(patientId: unknown, id: string) {
        const medication = await PatientMedication.findOne(ownedFilter(patientId, id)).exec();
        if (!medication) throw new DomainError('الدواء غير موجود', 404, 'MEDICATION_NOT_FOUND');
        return medication;
    }

    async get(patientId: unknown, id: string, now = new Date()) {
        const medication = await this.requireOwned(patientId, id);
        await medicationReminderService.generateForMedication(medication, now);
        const next = await MedicationDose.findOne({ medication_id: medication._id, schedule_version: medication.schedule_version, status: MedicationDoseStatusEnum.PENDING, scheduled_at: { $gt: now } }).sort({ scheduled_at: 1 }).select('scheduled_at').lean().exec();
        return formatMedication(medication, next?.scheduled_at ?? null);
    }

    async update(patientId: unknown, id: string, input: UpdateInput, now = new Date()) {
        const existing = await this.requireOwned(patientId, id);
        const schedule = input.schedule ? normalizeSchedule(input.schedule, existing.schedule) : existing.schedule;
        const reminderChanged = input.reminders_enabled !== undefined && input.reminders_enabled !== existing.reminders_enabled;
        const versionChanged = scheduleChanged(existing.schedule, schedule) || reminderChanged;
        const nextVersion = existing.schedule_version + (versionChanged ? 1 : 0);
        const medication = await PatientMedication.findOneAndUpdate(
            { _id: existing._id, patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE, schedule_version: existing.schedule_version },
            { $set: { ...input, schedule, schedule_version: nextVersion } },
            { new: true, runValidators: true },
        ).exec();
        if (!medication) throw new DomainError('تم تعديل جدول الدواء من طلب آخر', 409, 'STALE_SCHEDULE_VERSION');
        if (versionChanged) await medicationReminderService.invalidateFuture(medication._id, now, nextVersion);
        else if (input.name !== undefined || input.strength_text !== undefined || input.dose_instructions !== undefined) {
            await MedicationDose.updateMany({ medication_id: medication._id, schedule_version: medication.schedule_version, status: MedicationDoseStatusEnum.PENDING, scheduled_at: { $gt: now } }, { $set: { medication_snapshot: { name: medication.name, strength_text: medication.strength_text ?? null, dose_instructions: medication.dose_instructions ?? null } } }).exec();
        }
        await medicationReminderService.generateForMedication(medication, now);
        return this.get(patientId, id, now);
    }

    async archive(patientId: unknown, id: string, now = new Date()) {
        const existing = await this.requireOwned(patientId, id);
        const medication = await PatientMedication.findOneAndUpdate({ _id: existing._id, patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE }, { $set: { status: PatientMedicationStatusEnum.ARCHIVED, reminders_enabled: false }, $inc: { schedule_version: 1 } }, { new: true }).exec();
        if (!medication) throw new DomainError('الدواء غير موجود', 404, 'MEDICATION_NOT_FOUND');
        await medicationReminderService.invalidateFuture(medication._id, now);
        return formatMedication(medication, null);
    }
}

export default new PatientMedicationService();

