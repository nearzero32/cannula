import type { ClientSession } from 'mongoose';
import Patient from '../models/patients.model';
import PatientMedication, { type PatientMedicationDocument } from '../models/patient-medication.model';
import MedicationDose from '../models/medication-dose.model';
import Notification from '../models/notifications.model';
import domainNotificationService from './domain-notification.service';
import { MedicationDoseStatusEnum } from '../interfaces/medication-dose.interface';
import { PatientMedicationStatusEnum } from '../interfaces/patient-medication.interface';
import { INotificationCategoryEnum, INotificationPrivacyEnum, INotificationStatusEnum, INotificationTypeEnum } from '../interfaces/notification.interface';
import { scheduledInstants } from './medication-schedule.service';

export const MEDICATION_GENERATION_WINDOW_DAYS = 7;
export const MEDICATION_REMINDER_TITLE = 'تذكير بموعد الدواء';
export const MEDICATION_REMINDER_BODY = 'لديك موعد دواء مسجل';

export function medicationReminderDedupeKey(medicationId: unknown, scheduleVersion: number, doseId: unknown, patientUserId: unknown) {
    return `medication:${medicationId}:${scheduleVersion}:dose:${doseId}:${patientUserId}`;
}

export class MedicationReminderService {
    async generateForMedication(medication: PatientMedicationDocument | any, now = new Date(), session?: ClientSession) {
        if (medication.status !== PatientMedicationStatusEnum.ACTIVE || !medication.reminders_enabled) return [];
        const until = new Date(now.getTime() + MEDICATION_GENERATION_WINDOW_DAYS * 86_400_000);
        const instants = scheduledInstants(medication.schedule, now, until);
        if (instants.length) {
            try { await MedicationDose.bulkWrite(instants.map(scheduled_at => ({ updateOne: {
                filter: { medication_id: medication._id, schedule_version: medication.schedule_version, scheduled_at },
                update: { $setOnInsert: {
                    medication_id: medication._id,
                    patient_id: medication.patient_id,
                    schedule_version: medication.schedule_version,
                    scheduled_at,
                    medication_snapshot: { name: medication.name, strength_text: medication.strength_text ?? null, dose_instructions: medication.dose_instructions ?? null },
                    status: MedicationDoseStatusEnum.PENDING,
                } },
                upsert: true,
            } })), { ordered: false, session }); } catch (error: any) {
                // Concurrent workers can race between an upsert match and insert. The unique
                // occurrence index is authoritative; duplicate-key means the desired row exists.
                if (error?.code !== 11000 && !error?.writeErrors?.every((item: any) => item?.code === 11000)) throw error;
            }
        }
        const doses = await MedicationDose.find({
            medication_id: medication._id,
            schedule_version: medication.schedule_version,
            status: MedicationDoseStatusEnum.PENDING,
            scheduled_at: { $gt: now, $lte: until },
        }).sort({ scheduled_at: 1 }).session(session ?? null).exec();
        if (!doses.length) return doses;
        const patient = await Patient.findById(medication.patient_id).select('user_id').session(session ?? null).lean().exec();
        if (!patient?.user_id) throw new Error('MEDICATION_REMINDER_IDENTITY_MISSING');
        for (const dose of doses) {
            await domainNotificationService.inAppOnly({
                userIds: [patient.user_id],
                session,
                dedupeKey: medicationReminderDedupeKey(medication._id, medication.schedule_version, dose._id, patient.user_id),
                payload: {
                    category: INotificationCategoryEnum.MEDICATIONS,
                    type: INotificationTypeEnum.MEDICATION_REMINDER,
                    privacy: INotificationPrivacyEnum.SENSITIVE,
                    title: MEDICATION_REMINDER_TITLE,
                    body: MEDICATION_REMINDER_BODY,
                    source: { domain: 'patient_medication', id: medication._id },
                    target: { type: 'medication_dose', id: dose._id as any },
                    visible_at: dose.scheduled_at,
                },
            });
        }
        // Close the archive/schedule-change race: whichever operation observes the
        // other last performs the cancellation, so stale future rows cannot survive.
        const current = await PatientMedication.findById(medication._id).select('status reminders_enabled schedule_version').lean().exec();
        if (!current || current.status !== PatientMedicationStatusEnum.ACTIVE || !current.reminders_enabled || current.schedule_version !== medication.schedule_version) {
            await this.invalidateFuture(
                medication._id,
                now,
                current?.status === PatientMedicationStatusEnum.ACTIVE && current.reminders_enabled ? current.schedule_version : undefined,
            );
            return [];
        }
        return doses;
    }

    async generateForPatient(patientId: unknown, now = new Date()) {
        const medications = await PatientMedication.find({ patient_id: patientId, status: PatientMedicationStatusEnum.ACTIVE, reminders_enabled: true }).exec();
        for (const medication of medications) await this.generateForMedication(medication, now);
    }

    async invalidateFuture(medicationId: unknown, now = new Date(), keepScheduleVersion?: number) {
        const doseFilter: Record<string, unknown> = { medication_id: medicationId, scheduled_at: { $gt: now }, status: MedicationDoseStatusEnum.PENDING };
        if (keepScheduleVersion !== undefined) doseFilter.schedule_version = { $ne: keepScheduleVersion };
        const doses = await MedicationDose.find(doseFilter).select('_id').lean().exec();
        if (!doses.length) return 0;
        const doseIds = doses.map(dose => dose._id);
        await MedicationDose.updateMany({ _id: { $in: doseIds }, status: MedicationDoseStatusEnum.PENDING }, { $set: { status: MedicationDoseStatusEnum.CANCELLED, recorded_at: now } }).exec();
        await Notification.updateMany({
            type: INotificationTypeEnum.MEDICATION_REMINDER,
            'target.type': 'medication_dose',
            'target.id': { $in: doseIds },
            visible_at: { $gt: now },
            status: { $ne: INotificationStatusEnum.CANCELLED },
        }, { $set: { status: INotificationStatusEnum.CANCELLED } }).exec();
        return doseIds.length;
    }
}

export default new MedicationReminderService();
