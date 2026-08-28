import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import homeCareCategoryService from '../../services/home-care-category.service';
import homeCareServiceService from '../../services/home-care-service.service';
import type { HomeCareCategoryDocument } from '../../models/home-care-category.model';
import type { HomeCareServiceDocument } from '../../models/home-care-service.model';

const ObjectId = mongoose.Types.ObjectId;

export function formatHomeCareCategory(category: HomeCareCategoryDocument) {
    return {
        _id: category._id,
        name: category.name,
        description: category.description,
        icon: category.icon,
        image: category.image,
        display_order: category.display_order,
    };
}

export function formatHomeCareService(service: HomeCareServiceDocument) {
    return {
        _id: service._id,
        category_id: service.category_id,
        name: service.name,
        short_description: service.short_description,
        description: service.description,
        image: service.image,
        duration_min: service.duration_min,
        duration_max: service.duration_max,
        price: service.price,
        display_order: service.display_order,
    };
}

export const mobileHomeCareController = new Elysia({ prefix: '/home-care', detail: { tags: ['Mobile'] } })
    .get('/categories', async () => {
        const categories = await homeCareCategoryService.listActive();
        return {
            error: false,
            message: 'تم جلب أنواع الرعاية المنزلية بنجاح',
            data: categories.map(formatHomeCareCategory),
        };
    })
    .get('/services', async ({ query, set }) => {
        if (query.categoryId && !ObjectId.isValid(query.categoryId)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const services = await homeCareServiceService.listActive(query.categoryId);
        return {
            error: false,
            message: 'تم جلب خدمات الرعاية المنزلية بنجاح',
            data: services.map(formatHomeCareService),
        };
    }, { query: t.Object({ categoryId: t.Optional(t.String()) }) })
    .get('/services/:id', async ({ params, set }) => {
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الخدمة غير صالح' };
        }
        const service = await homeCareServiceService.getActiveById(params.id);
        if (!service) {
            set.status = 404;
            return { error: true, message: 'الخدمة غير موجودة' };
        }
        return { error: false, message: 'تم جلب الخدمة بنجاح', data: formatHomeCareService(service) };
    }, { params: t.Object({ id: t.String() }) });
