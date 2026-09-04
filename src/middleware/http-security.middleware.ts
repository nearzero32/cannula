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

export function isSwaggerPath(pathname: string): boolean {
    return pathname.startsWith('/api/swagger');
}

function parseBasicAuthorization(request: Request): { username: string; password: string } | null {
    const match = request.headers.get('authorization')?.match(/^Basic\s+([A-Za-z0-9+/]*={0,2})$/i);
    if (!match || !match[1]) return null;
    const token = match[1];
    try {
        const decoded = Buffer.from(token, 'base64');
        if (!decoded.length || decoded.toString('base64').replace(/=+$/, '') !== token.replace(/=+$/, '')) return null;
        const value = decoded.toString('utf8'), separator = value.indexOf(':');
        if (separator < 0) return null;
        return { username: value.slice(0, separator), password: value.slice(separator + 1) };
    } catch { return null; }
}

function safeEqual(left: string, right: string): boolean {
    const expected = Buffer.from(left), supplied = Buffer.from(right);
    return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function swaggerBasicAuthorized(request: Request): boolean {
    const credentials = parseBasicAuthorization(request);
    const username = process.env.SWAGGER_BASIC_USERNAME?.trim() ?? '';
    const password = process.env.SWAGGER_BASIC_PASSWORD ?? '';
    return Boolean(credentials) && safeEqual(username, credentials.username) && safeEqual(password, credentials.password);
}

function applyHeaders(headers: Record<string, string | number>, swaggerPath: boolean): void {
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = 'no-referrer';
    headers['X-Frame-Options'] = 'DENY';
    headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';
    headers['Content-Security-Policy'] = swaggerPath
        ? "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'none'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_HTTPS === 'true') headers['Strict-Transport-Security'] = 'max-age=31536000';
}

function swaggerResponse(status: 401 | 404, requestId: string): Response {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
    if (status === 401) headers['WWW-Authenticate'] = 'Basic realm="Cannula Swagger", charset="UTF-8"';
    applyHeaders(headers, true);
    return new Response(JSON.stringify({ error: true, message: status === 401 ? 'المصادقة مطلوبة' : 'المسار غير موجود', requestId }), { status, headers });
}

export const HttpSecurityPlugin = new Elysia({ name: 'http-security-plugin' })
    .onRequest(({ request, set }) => {
        const url = new URL(request.url);
        const requestId = requestIdFor(request);
        requestStarts.set(request, Date.now());
        set.headers['X-Request-Id'] = requestId;
        if (url.search.length > 8192) return new Response(JSON.stringify({ error: true, message: 'عنوان الطلب طويل جدًا', requestId }), { status: 414, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
        if (process.env.NODE_ENV === 'production' && isSwaggerPath(url.pathname)) {
            if (!isSwaggerEnabled()) return swaggerResponse(404, requestId);
            if (!swaggerBasicAuthorized(request)) return swaggerResponse(401, requestId);
        }
    })
    .onAfterHandle({ as: 'global' }, ({ request, set }) => { const swaggerPath = isSwaggerPath(new URL(request.url).pathname); applyHeaders(set.headers, swaggerPath); if (swaggerPath) set.headers['Cache-Control'] = 'no-store'; })
    .onError({ as: 'global' }, ({ request, set }) => { const swaggerPath = isSwaggerPath(new URL(request.url).pathname); applyHeaders(set.headers, swaggerPath); if (swaggerPath) set.headers['Cache-Control'] = 'no-store'; })
    .onAfterResponse({ as: 'global' }, ({ request, set }) => {
        const status = typeof set.status === 'number' ? set.status : 200;
        const record = { level: 'info', requestId: requestIdFor(request), method: request.method, path: new URL(request.url).pathname, status, durationMs: Date.now() - (requestStarts.get(request) ?? Date.now()) };
        console.log(JSON.stringify(record));
    });
