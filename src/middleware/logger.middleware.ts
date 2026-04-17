import Elysia from 'elysia';
import fs from 'fs';
import path from 'path';

const logStream = fs.createWriteStream(path.resolve('logs.txt'), { flags: 'a' });

function writeMorganLine(request: Request, status: number, responseTimeMs: number): void {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '-';
    const date = new Date().toUTCString();
    const method = request.method;
    const url = new URL(request.url).pathname;
    const userAgent = request.headers.get('user-agent') ?? '-';
    const referrer = request.headers.get('referer') ?? '-';

    // morgan combined format
    const line = `${ip} - - [${date}] "${method} ${url}" ${status} - "${referrer}" "${userAgent}"\n`;
    logStream.write(line);
}

export const ActivityLoggerPlugin = new Elysia({ name: 'activity-logger-plugin' })
    .derive({ as: 'local' }, () => ({ _reqStart: Date.now() }))
    .onAfterHandle({ as: 'local' }, ({ request, set, _reqStart }) => {
        const status = typeof set.status === 'number' ? set.status : 200;
        writeMorganLine(request, status, Date.now() - _reqStart);
    })
    .onError({ as: 'local' }, ({ request, set, _reqStart }) => {
        const status = typeof set.status === 'number' ? set.status : 500;
        writeMorganLine(request, status, Date.now() - _reqStart);
    });
