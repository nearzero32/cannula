import Elysia from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import { IUserRoleEnum } from '../../../interfaces/user.interface';
import nurseService from '../../../services/nurse.service';
import { formatNurse } from '../../../services/nurse.formatter';
import { DomainError } from '../../../services/domain-error';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses } from '../../../schemas/api-response.schema';
import { NurseResponseSchema } from '../../../schemas/nurse-response.schema';

export const nurseProfileController = new Elysia({ detail: { tags: [SWAGGER_TAGS.NURSE.PROFILE] } })
    .use(AuthPlugin()).onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message }; } })
    .get('/profile', async ({ phrase }) => {
        if (phrase.role !== IUserRoleEnum.NURSE) throw new DomainError('غير مصرح لك بالوصول', 403);
        const nurse = await nurseService.getByUserId(phrase._id);
        if (!nurse) throw new DomainError('الملف الشخصي للممرض غير موجود', 404);
        return { error: false, message: 'تم جلب بيانات الممرض بنجاح', data: formatNurse(nurse) };
    }, { response: { 200: NurseResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses } });
