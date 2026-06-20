import Appointment, { AppointmentDocument } from '../models/appointments.model';
import type { IAppointment } from '../interfaces/appointment.interface';
import { IAppointmentStatusEnum, IAppointmentCancelledByModelEnum } from '../interfaces/appointment.interface';
import type { PipelineStage } from 'mongoose';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

type Meta = {
    user_id?: string;
    user_name?: string;
    user_type?: string;
    endpoint?: string;
    source?: string;
};

class AppointmentService {
    private model = Appointment;
    private activityLog = ActivityLogService;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection,
        page = 1,
        limit = 10,
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
    }): Promise<{ data: AppointmentDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, limit);
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: { date: -1, start_time: 1, createdAt: -1 } },
                        { $skip: skip },
                        { $limit: safeLimit },
                        ...additional_pipeline,
                        ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
                    ],
                    count: [{ $count: 'count' }],
                },
            },
        ];

        const [agg] = await this.model.aggregate(pipeline).exec();
        return {
            data: (agg?.data ?? []) as AppointmentDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getOneBy({
        main_match = { $match: {} },
        additional_pipeline = [],
        projection = null,
    }: {
        main_match?: PipelineStage.FacetPipelineStage;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
    }): Promise<AppointmentDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as AppointmentDocument) ?? null;
    }

    public async getById(id: string): Promise<AppointmentDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async isSlotTaken(
        doctor_id: string,
        date: Date,
        start_time: string,
        exclude_id?: string
    ): Promise<boolean> {
        const query: Record<string, unknown> = {
            doctor_id,
            date,
            start_time,
            status: {
                $nin: [
                    IAppointmentStatusEnum.CANCELLED,
                    IAppointmentStatusEnum.NO_SHOW,
                    IAppointmentStatusEnum.RESCHEDULED,
                ],
            },
        };
        if (exclude_id) query._id = { $ne: exclude_id };
        const existing = await this.model.findOne(query).exec();
        return existing !== null;
    }

    private async generateAppointmentNumber(): Promise<string> {
        const year = new Date().getFullYear();
        const count = await this.model.countDocuments({}).exec();
        const padded = String(count + 1).padStart(6, '0');
        return `APP-${year}-${padded}`;
    }

    public async create(payload: Partial<IAppointment>, meta?: Meta): Promise<AppointmentDocument> {
        const finalPayload = {
            ...payload,
            appointment_number:
                payload.appointment_number ?? (await this.generateAppointmentNumber()),
        };
        const doc = await this.model.create(finalPayload);
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/appointments',
                action: IActivityLogActionEnum.CREATE,
                collection_name: 'appointments',
                document_id: (doc._id as any).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
        return doc;
    }

    public async update(
        id: string,
        payload: Partial<IAppointment>,
        meta?: Meta
    ): Promise<AppointmentDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        const doc = await this.model
            .findByIdAndUpdate(id, payload, { returnDocument: 'after' })
            .exec();
        if (doc && oldDoc) {
            try {
                const changed_fields = Object.keys(payload).filter(
                    k =>
                        JSON.stringify((oldDoc as any)[k]) !==
                        JSON.stringify((doc as any)[k])
                );
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/appointments/${id}`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'appointments',
                    document_id: id,
                    old_data: oldDoc.toObject(),
                    new_data: doc.toObject(),
                    changed_fields,
                    request_body: payload,
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }
        return doc;
    }

    public async cancel(
        id: string,
        {
            cancel_reason,
            cancelled_by,
            cancelled_by_model,
        }: {
            cancel_reason?: string | null;
            cancelled_by: string;
            cancelled_by_model: (typeof IAppointmentCancelledByModelEnum)[keyof typeof IAppointmentCancelledByModelEnum];
        },
        meta?: Meta
    ): Promise<AppointmentDocument | null> {
        return this.update(
            id,
            {
                status: IAppointmentStatusEnum.CANCELLED,
                cancel_reason: cancel_reason ?? null,
                cancelled_by: cancelled_by as any,
                cancelled_by_model,
                cancelled_at: new Date() as any,
            },
            meta
        );
    }

    public async checkIn(id: string, meta?: Meta): Promise<AppointmentDocument | null> {
        return this.update(
            id,
            { status: IAppointmentStatusEnum.CHECKED_IN, checked_in_at: new Date() as any },
            meta
        );
    }

    public async complete(id: string, meta?: Meta): Promise<AppointmentDocument | null> {
        return this.update(
            id,
            { status: IAppointmentStatusEnum.COMPLETED, completed_at: new Date() as any },
            meta
        );
    }

    public async noShow(id: string, meta?: Meta): Promise<AppointmentDocument | null> {
        return this.update(id, { status: IAppointmentStatusEnum.NO_SHOW }, meta);
    }
}

export default new AppointmentService();
