import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import homeCarePolicyService from '../../../services/home-care-policy.service';
import homeCareCategoryService from '../../../services/home-care-category.service';
import homeCareServiceService from '../../../services/home-care-service.service';
import { HomeCareValidationError } from '../../../services/home-care.validation';
import { IHomeCareStatusEnum } from '../../../interfaces/home-care.interface';

const ObjectId = mongoose.Types.ObjectId;

const optionalCategoryFields = {
    description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
    icon: t.Optional(t.Nullable(t.String())),
    image: t.Optional(t.Nullable(t.String())),
    displayOrder: t.Optional(t.Integer({ minimum: 0 })),
};

const categoryCreateSchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    ...optionalCategoryFields,
    status: t.Optional(t.Enum(IHomeCareStatusEnum)),
});

const categoryUpdateSchema = t.Partial(t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    ...optionalCategoryFields,
}));

const optionalServiceFields = {
    shortDescription: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
    description: t.Optional(t.Nullable(t.String({ maxLength: 3000 }))),
    image: t.Optional(t.Nullable(t.String())),
    durationMin: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
    durationMax: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
    displayOrder: t.Optional(t.Integer({ minimum: 0 })),
};

const serviceCreateSchema = t.Object({
    categoryId: t.String(),
    name: t.String({ minLength: 1, maxLength: 160 }),
    ...optionalServiceFields,
    price: t.Integer({ minimum: 1 }),
    status: t.Optional(t.Enum(IHomeCareStatusEnum)),
});

const serviceUpdateSchema = t.Partial(t.Object({
    categoryId: t.String(),
    name: t.String({ minLength: 1, maxLength: 160 }),
    ...optionalServiceFields,
    price: t.Integer({ minimum: 1 }),
}));

async function hasAccess(userId: string, role: 'admin' | 'doctor' | 'patient', required: 'read' | 'manage') {
    const access = await homeCarePolicyService.getAccess(userId, role);
    return access === 'manage' || (required === 'read' && access === 'read');
}

function pagination(page: number, limit: number, total: number) {
    const pages = Math.ceil(total / limit);
    return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

const categoriesController = new Elysia({ prefix: '/categories', detail: { tags: ['Dash'] } })
    .use(AuthPlugin())
    .onError(({ error, set }) => {
        if (error instanceof HomeCareValidationError) {
            set.status = error.statusCode;
            return { error: true, message: error.message };
        }
    })
    .get('/', async ({ query, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'read')) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بعرض أنواع الرعاية المنزلية' };
        }
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const { data, count } = await homeCareCategoryService.list({
            page, limit, status: query.status, search: query.search,
        });
        return {
            error: false,
            message: 'تم جلب أنواع الرعاية المنزلية بنجاح',
            data,
            pagination: pagination(page, limit, count),
        };
    }, { query: t.Object({
        page: t.Optional(t.String()), limit: t.Optional(t.String()),
        status: t.Optional(t.Enum(IHomeCareStatusEnum)), search: t.Optional(t.String()),
    }) })
    .get('/:id', async ({ params, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'read')) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بعرض أنواع الرعاية المنزلية' };
        }
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const category = await homeCareCategoryService.getById(params.id);
        if (!category) {
            set.status = 404;
            return { error: true, message: 'نوع الرعاية المنزلية غير موجود' };
        }
        return { error: false, message: 'تم جلب نوع الرعاية المنزلية بنجاح', data: category };
    }, { params: t.Object({ id: t.String() }) })
    .post('/', async ({ body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'إدارة الرعاية المنزلية متاحة للمشرف الرئيسي فقط' };
        }
        const category = await homeCareCategoryService.create({ ...body, createdBy: phrase._id });
        set.status = 201;
        return { error: false, message: 'تم إنشاء نوع الرعاية المنزلية بنجاح', data: category };
    }, { body: categoryCreateSchema })
    .patch('/:id', async ({ params, body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'إدارة الرعاية المنزلية متاحة للمشرف الرئيسي فقط' };
        }
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const category = await homeCareCategoryService.update(params.id, body);
        return { error: false, message: 'تم تحديث نوع الرعاية المنزلية بنجاح', data: category };
    }, { params: t.Object({ id: t.String() }), body: categoryUpdateSchema })
    .patch('/:id/status', async ({ params, body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'إدارة الرعاية المنزلية متاحة للمشرف الرئيسي فقط' };
        }
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const category = await homeCareCategoryService.updateStatus(params.id, body.status);
        return { error: false, message: 'تم تحديث حالة نوع الرعاية المنزلية بنجاح', data: category };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ status: t.Enum(IHomeCareStatusEnum) }) });

const servicesController = new Elysia({ prefix: '/services', detail: { tags: ['Dash'] } })
    .use(AuthPlugin())
    .onError(({ error, set }) => {
        if (error instanceof HomeCareValidationError) {
            set.status = error.statusCode;
            return { error: true, message: error.message };
        }
    })
    .get('/', async ({ query, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'read')) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بعرض خدمات الرعاية المنزلية' };
        }
        if (query.categoryId && !ObjectId.isValid(query.categoryId)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const { data, count } = await homeCareServiceService.list({
            page, limit, categoryId: query.categoryId, status: query.status, search: query.search,
        });
        return {
            error: false,
            message: 'تم جلب خدمات الرعاية المنزلية بنجاح',
            data,
            pagination: pagination(page, limit, count),
        };
    }, { query: t.Object({
        page: t.Optional(t.String()), limit: t.Optional(t.String()), categoryId: t.Optional(t.String()),
        status: t.Optional(t.Enum(IHomeCareStatusEnum)), search: t.Optional(t.String()),
    }) })
    .get('/:id', async ({ params, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'read')) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بعرض خدمات الرعاية المنزلية' };
        }
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الخدمة غير صالح' };
        }
        const service = await homeCareServiceService.getById(params.id);
        if (!service) {
            set.status = 404;
            return { error: true, message: 'الخدمة غير موجودة' };
        }
        return { error: false, message: 'تم جلب الخدمة بنجاح', data: service };
    }, { params: t.Object({ id: t.String() }) })
    .post('/', async ({ body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'تحديد أسعار الرعاية المنزلية متاح للمشرف الرئيسي فقط' };
        }
        if (!ObjectId.isValid(body.categoryId)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const service = await homeCareServiceService.create({ ...body, createdBy: phrase._id });
        set.status = 201;
        return { error: false, message: 'تم إنشاء خدمة الرعاية المنزلية بنجاح', data: service };
    }, { body: serviceCreateSchema })
    .patch('/:id', async ({ params, body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'تعديل أسعار الرعاية المنزلية متاح للمشرف الرئيسي فقط' };
        }
        if (!ObjectId.isValid(params.id) || (body.categoryId !== undefined && !ObjectId.isValid(body.categoryId))) {
            set.status = 400;
            return { error: true, message: 'المعرف غير صالح' };
        }
        const service = await homeCareServiceService.update(params.id, body);
        return { error: false, message: 'تم تحديث الخدمة بنجاح', data: service };
    }, { params: t.Object({ id: t.String() }), body: serviceUpdateSchema })
    .patch('/:id/status', async ({ params, body, phrase, set }) => {
        if (!await hasAccess(phrase._id, phrase.role, 'manage')) {
            set.status = 403;
            return { error: true, message: 'إدارة الرعاية المنزلية متاحة للمشرف الرئيسي فقط' };
        }
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الخدمة غير صالح' };
        }
        const service = await homeCareServiceService.updateStatus(params.id, body.status);
        return { error: false, message: 'تم تحديث حالة الخدمة بنجاح', data: service };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ status: t.Enum(IHomeCareStatusEnum) }) });

export const homeCareAdminController = new Elysia({ prefix: '/home-care' })
    .use(categoriesController)
    .use(servicesController);
