export class DomainError extends Error {
    constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 422) {
        super(message);
        this.name = 'DomainError';
    }
}
