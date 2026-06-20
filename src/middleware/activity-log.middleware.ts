import Elysia, { type Context } from 'elysia';
import ActivityLogService from '../services/activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import type { IUserRole } from '../interfaces/user.interface';

function getSource(path: string): string {
    if (path.startsWith('/dash') || path.startsWith('/auth')) return IActivityLogSourceEnum.DASHBOARD;
    if (path.startsWith('/mobile')) return IActivityLogSourceEnum.MOBILE;
    if (path.startsWith('/admin')) return IActivityLogSourceEnum.ADMIN;
    return IActivityLogSourceEnum.DASHBOARD;
}

function getAction(method: string): string {
    switch (method.toUpperCase()) {
        case 'POST':
            return IActivityLogActionEnum.CREATE;
        case 'PUT':
        case 'PATCH':
            return IActivityLogActionEnum.UPDATE;
        case 'DELETE':
            return IActivityLogActionEnum.OTHER;
        default:
            return IActivityLogActionEnum.OTHER;
    }
}

function getCollectionName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    const collectionPart = parts[0] === 'dash' || parts[0] === 'mobile' || parts[0] === 'auth' ? parts[1] : parts[0];
    return collectionPart || '';
}

function getDocumentId(path: string): string | null {
    const parts = path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'status' && i > 0) return parts[i - 1];
        if (i > 0 && /^[0-9a-fA-F]{24}$/.test(parts[i])) return parts[i];
    }
    return null;
}

function getIpAddress(headers: Record<string, string | undefined>): string {
    return headers['x-forwarded-for']?.split(',')[0]?.trim()
        || headers['x-real-ip']
        || headers['cf-connecting-ip']
        || '';
}

export const ActivityLogPlugin = new Elysia({ name: 'activity-log-plugin' })
    .derive({ as: 'global' }, ({ request, headers }) => {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const ip = getIpAddress(headers as Record<string, string | undefined>);

        return {
            _activityMeta: {
                path,
                method,
                ip,
                start_time: Date.now(),
            },
        };
    })
    .onAfterResponse({ as: 'global' }, async (ctx) => {
        try {
            const { _activityMeta, request, body, response, set } = ctx;
            if (!_activityMeta) return;

            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method;
            const source = getSource(path);
            const action = getAction(method);
            const collection_name = getCollectionName(path);
            const document_id = getDocumentId(path);
            const status = set.status || (response && typeof response === 'object' && 'status' in response ? (response as any).status : 200);

            let user_id = null;
            let user_name = 'anonymous';
            let user_type = '';
            const phrase = (ctx as { phrase?: { _id?: string; role?: IUserRole } }).phrase;

            if (phrase?._id) {
                user_id = phrase._id;
                user_type = phrase.role || '';
                user_name = `${user_type}_${phrase._id}`;
            }

            const request_body = method !== 'GET' ? body : {};

            await ActivityLogService.create({
                user_id: user_id ? (user_id as any) : undefined,
                user_name,
                user_type,
                method,
                endpoint: path,
                action: action as any,
                collection_name,
                document_id: document_id ? (document_id as any) : null,
                old_data: null,
                new_data: null,
                changed_fields: [],
                request_body,
                response_status: typeof status === 'number' ? status : 200,
                ip_address: _activityMeta.ip,
                source: source as any,
            });
        } catch (err) {
            // Silently fail - don't break request flow
        }
    });
