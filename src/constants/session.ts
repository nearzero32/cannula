export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const USED_REFRESH_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SessionModeEnum = {
    PERSISTENT: 'PERSISTENT',
    EXPIRING: 'EXPIRING',
} as const;
export type SessionMode = (typeof SessionModeEnum)[keyof typeof SessionModeEnum];

export const MAX_PATIENT_SESSIONS = 5;
export const MAX_DASHBOARD_SESSIONS = 3;
