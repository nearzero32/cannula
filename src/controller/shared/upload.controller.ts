import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { UploadFolderEnum } from '../../constants/r2.config';
import storageService from '../../services/storage.service';

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

export const uploadController = new Elysia({ prefix: '/upload' })
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
        { body: presignBodySchema }
    );
