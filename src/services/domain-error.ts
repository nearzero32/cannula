export class DomainError extends Error {
    constructor(
        message: string,
        public readonly status: 400 | 403 | 404 | 409 | 422,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'DomainError';
    }
}
