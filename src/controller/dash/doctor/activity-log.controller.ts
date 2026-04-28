import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import activityLogService from '../../../services/activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

export const doctorActivityLogController = new Elysia({ prefix: '/activity-logs' })
    .use(AuthPlugin)

    .get(
        '/',
        async ({ query, phrase }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

            const main_match: Record<string, unknown> = {
                user_id: new ObjectId(phrase._id),
            };

            if (query.action) main_match.action = query.action;
            if (query.source) main_match.source = query.source;
            if (query.collectionName) main_match.collection_name = query.collectionName;

            if (query.dateFrom || query.dateTo) {
                const createdAt: Record<string, Date> = {};
                if (query.dateFrom) createdAt.$gte = new Date(query.dateFrom);
                if (query.dateTo) createdAt.$lte = new Date(query.dateTo);
                main_match.createdAt = createdAt;
            }

            if (query.search) {
                main_match.$or = [
                    { endpoint: { $regex: query.search, $options: 'i' } },
                    { collection_name: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await activityLogService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب سجلات النشاط بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                action: t.Optional(t.Enum(IActivityLogActionEnum)),
                source: t.Optional(t.Enum(IActivityLogSourceEnum)),
                collectionName: t.Optional(t.String()),
                dateFrom: t.Optional(t.String()),
                dateTo: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف سجل النشاط غير صالح' };
            }

            const log = await activityLogService.getById(params.id);
            if (!log) {
                set.status = 404;
                return { error: true, message: 'سجل النشاط غير موجود' };
            }

            if (log.user_id.toString() !== phrase._id) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بعرض هذا السجل' };
            }

            return { error: false, message: 'تم جلب سجل النشاط بنجاح', data: log };
        },
        { params: t.Object({ id: t.String() }) }
    );
