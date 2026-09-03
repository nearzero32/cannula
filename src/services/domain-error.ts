export class DomainError extends Error {
    constructor(
        message: string,
        public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
        public readonly code?: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'DomainError';
    }
}
