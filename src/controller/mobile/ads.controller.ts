import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import adsService from '../../services/ads.service';
import { IAdsStatusEnum } from '../../interfaces/ads.interface';

const ObjectId = mongoose.Types.ObjectId;

export const mobileAdsController = new Elysia({ prefix: '/ads' })

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                status: IAdsStatusEnum.ACTIVE,
                $or: [{ endDate: null }, { endDate: { $gte: new Date() } }],
            };

            if (query.clinicId && ObjectId.isValid(query.clinicId)) {
                main_match.clinicId = new ObjectId(query.clinicId);
            }

            const { data, count } = await adsService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الإعلانات بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                clinicId: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الإعلان غير صالح' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad || ad.status !== IAdsStatusEnum.ACTIVE) {
                set.status = 404;
                return { error: true, message: 'الإعلان غير موجود' };
            }

            return { error: false, message: 'تم جلب الإعلان بنجاح', data: ad };
        },
        { params: t.Object({ id: t.String() }) }
    );
