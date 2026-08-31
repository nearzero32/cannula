import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { UploadFolderEnum } from '../../constants/r2.config';
import storageService from '../../services/storage.service';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { BadRequestResponseSchema, GenericDataResponseSchema, ProtectedApiErrorResponses, ServiceUnavailableResponseSchema, ValidationErrorResponseSchema } from '../../schemas/api-response.schema';

const presignBodySchema = t.Object({
    folder: t.Enum(UploadFolderEnum),
    contentType: t.Union([
        t.Literal('image/jpeg'),
        t.Literal('image/png'),
        t.Literal('image/webp'),
        t.Literal('image/gif'),
    ]),
    fileName: t.Optional(t.String({ maxLength: 120 })),
});

export function createUploadController(tag: string) {
    return new Elysia({ prefix: '/upload', detail: { tags: [tag] } })
    .use(AuthPlugin())

    .post(
        '/presign',
        async ({ body, set }) => {
            if (!storageService.isConfigured()) {
                set.status = 503;
                return { error: true, message: 'خدمة التخزين غير مهيأة' };
            }

            const result = await storageService.createPresignedUpload({
                folder: body.folder,
                contentType: body.contentType,
                fileName: body.fileName,
            });

            if ('error' in result) {
                set.status = 400;
                return { error: true, message: result.error };
            }

            return {
                error: false,
                message: 'تم إنشاء رابط الرفع بنجاح',
                data: result,
            };
        },
        {
            body: presignBodySchema,
            response: {
                200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema,
                503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses,
            },
        }
    );
}

export const uploadController = createUploadController(SWAGGER_TAGS.DASHBOARD.SHARED);
