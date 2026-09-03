import Elysia from 'elysia';
import { timingSafeEqual } from 'node:crypto';
import { isSwaggerEnabled } from '../config/production.config';

const requestIds = new WeakMap<Request, string>();
const requestStarts = new WeakMap<Request, number>();

export function requestIdFor(request: Request): string {
    let value = requestIds.get(request);
    if (!value) { value = crypto.randomUUID(); requestIds.set(request, value); }
    return value;
}

function swaggerAuthorized(request: Request): boolean {
    const expected = process.env.SWAGGER_ADMIN_TOKEN ?? '';
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function applyHeaders(headers: Record<string, string | number>, swaggerPath: boolean): void {
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = 'no-referrer';
    headers['X-Frame-Options'] = 'DENY';
    headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';
    headers['Content-Security-Policy'] = swaggerPath
        ? "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_HTTPS === 'true') headers['Strict-Transport-Security'] = 'max-age=31536000';
}

export const HttpSecurityPlugin = new Elysia({ name: 'http-security-plugin' })
    .onRequest(({ request, set }) => {
        const url = new URL(request.url);
        const requestId = requestIdFor(request);
        requestStarts.set(request, Date.now());
        set.headers['X-Request-Id'] = requestId;
        if (url.search.length > 8192) return new Response(JSON.stringify({ error: true, message: 'عنوان الطلب طويل جدًا', requestId }), { status: 414, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
        if (process.env.NODE_ENV === 'production' && url.pathname.startsWith('/api/swagger') && (!isSwaggerEnabled() || !swaggerAuthorized(request))) {
            return new Response(JSON.stringify({ error: true, message: 'المسار غير موجود', requestId }), { status: 404, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
        }
    })
    .onAfterHandle({ as: 'global' }, ({ request, set }) => applyHeaders(set.headers, new URL(request.url).pathname.startsWith('/api/swagger')))
    .onError({ as: 'global' }, ({ request, set }) => applyHeaders(set.headers, new URL(request.url).pathname.startsWith('/api/swagger')))
    .onAfterResponse({ as: 'global' }, ({ request, set }) => {
        const status = typeof set.status === 'number' ? set.status : 200;
        const record = { level: 'info', requestId: requestIdFor(request), method: request.method, path: new URL(request.url).pathname, status, durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()) };
        console.log(JSON.stringify(record));
    });
