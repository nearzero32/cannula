import PatientMedication from '../models/patient-medication.model';
import { PatientMedicationStatusEnum } from '../interfaces/patient-medication.interface';
import medicationReminderService from './medication-reminder.service';

export type MedicationReminderWorkerConfig = { enabled: boolean; pollIntervalMs: number; batchSize: number };
export function medicationReminderWorkerConfig(env: NodeJS.ProcessEnv = process.env): MedicationReminderWorkerConfig {
    const interval = Number(env.MEDICATION_REMINDER_POLL_INTERVAL_MS ?? 900_000);
    const batch = Number(env.MEDICATION_REMINDER_BATCH_SIZE ?? 100);
    if (!Number.isSafeInteger(interval) || interval < 60_000) throw new Error('Invalid MEDICATION_REMINDER_POLL_INTERVAL_MS');
    if (!Number.isSafeInteger(batch) || batch < 1 || batch > 500) throw new Error('Invalid MEDICATION_REMINDER_BATCH_SIZE');
    return { enabled: env.MEDICATION_REMINDER_WORKER_ENABLED !== 'false', pollIntervalMs: interval, batchSize: batch };
}

export class MedicationReminderWorker {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private started = false;
    constructor(private readonly config = medicationReminderWorkerConfig()) {}
    async runOnce(now = new Date()) {
        if (this.running) return 0;
        this.running = true;
        let processed = 0;
        try {
            let afterId: unknown = null;
            while (true) {
                const rows = await PatientMedication.find({
                    ...(afterId ? { _id: { $gt: afterId } } : {}),
                    status: PatientMedicationStatusEnum.ACTIVE,
                    reminders_enabled: true,
                }).sort({ _id: 1 }).limit(this.config.batchSize).exec();
                if (!rows.length) break;
                for (const medication of rows) { await medicationReminderService.generateForMedication(medication, now); processed++; }
                afterId = rows[rows.length - 1]!._id;
                if (rows.length < this.config.batchSize) break;
            }
            return processed;
        } finally { this.running = false; }
    }
    private schedule() {
        if (!this.started) return;
        this.timer = setTimeout(async () => { await this.runOnce().catch(() => undefined); this.schedule(); }, this.config.pollIntervalMs);
        this.timer.unref?.();
    }
    start() { if (this.started || !this.config.enabled) return; this.started = true; void this.runOnce().catch(() => undefined); this.schedule(); }
    async stop() { this.started = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } while (this.running) await new Promise(resolve => setTimeout(resolve, 10)); }
}
export default new MedicationReminderWorker();
