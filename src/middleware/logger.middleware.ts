import Elysia from 'elysia';
import { resolveClientIp } from '../services/client-ip.service';

const reqStartMap = new WeakMap<Request, number>();
const reqIpMap = new WeakMap<Request, string>();

function writeMorganLine(request: Request, status: number, responseTimeMs: number, ip: string): void {
    const date = new Date().toUTCString();
    const method = request.method;
    const url = new URL(request.url).pathname;
    console.log(JSON.stringify({ timestamp: date, method, path: url, status, responseTimeMs, clientIp: ip }));
}

export const ActivityLoggerPlugin = new Elysia({ name: 'activity-logger-plugin' })
    .onRequest(({ request, server }) => {
        reqStartMap.set(request, Date.now());
        reqIpMap.set(request, resolveClientIp(request,server));
    })
    .onAfterHandle({ as: 'local' }, ({ request, set }) => {
        const reqStart = reqStartMap.get(request) ?? Date.now();
        const status = typeof set.status === 'number' ? set.status : 200;
        writeMorganLine(request, status, Date.now() - reqStart, reqIpMap.get(request) ?? '');
    })
    .onError({ as: 'local' }, ({ request, set }) => {
        const reqStart = reqStartMap.get(request) ?? Date.now();
        const status = typeof set.status === 'number' ? set.status : 500;
        writeMorganLine(request, status, Date.now() - reqStart, reqIpMap.get(request) ?? '');
    });
