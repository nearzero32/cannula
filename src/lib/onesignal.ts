const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OneSignalPushPayload {
    /** OneSignal external_user_id values — typically the recipient's MongoDB _id */
    external_ids: string[];
    /** Send to every subscribed user instead of targeting external IDs. */
    send_to_all?: boolean;
    title: string;
    body: string;
    /** Arbitrary key-value data passed to the app on notification tap */
    data?: Record<string, unknown> | null;
}

export interface OneSignalResult {
    success: boolean;
    /** Number of devices the notification was queued for */
    recipients: number;
    /** Raw error message if the request failed */
    error?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

async function sendPush(payload: OneSignalPushPayload): Promise<OneSignalResult> {
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_API_KEY;

    if (!appId || !apiKey) {
        return { success: false, recipients: 0, error: 'OneSignal credentials not configured' };
    }

    if (!payload.send_to_all && payload.external_ids.length === 0) {
        return { success: false, recipients: 0, error: 'No recipients provided' };
    }

    let res: Response;
    try {
        res = await fetch(ONESIGNAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Key ${apiKey}`,
            },
            body: JSON.stringify({
                app_id: appId,
                ...(payload.send_to_all
                    ? { included_segments: ['All'] }
                    : { include_external_user_ids: payload.external_ids }),
                headings: { en: payload.title },
                contents: { en: payload.body },
                data: payload.data ?? undefined,
            }),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Network error';
        return { success: false, recipients: 0, error: message };
    }

    const json = (await res.json()) as {
        id?: string;
        recipients?: number;
        errors?: unknown;
    };

    if (!res.ok || json.errors) {
        return {
            success: false,
            recipients: 0,
            error: typeof json.errors === 'string'
                ? json.errors
                : JSON.stringify(json.errors ?? json),
        };
    }

    return { success: true, recipients: json.recipients ?? 0 };
}

export const oneSignal = { sendPush };
