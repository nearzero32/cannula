export class HomeCareValidationError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
    }
}

export function normalizeHomeCareName(value: string): { name: string; normalizedName: string } {
    const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name) throw new HomeCareValidationError('الاسم مطلوب');
    return { name, normalizedName: name.toLocaleLowerCase('ar') };
}

export function validateDisplayOrder(value: number): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new HomeCareValidationError('ترتيب العرض غير صالح');
    }
}

export function validateHomeCareServiceNumbers(input: {
    price: number;
    durationMin?: number | null;
    durationMax?: number | null;
    displayOrder: number;
}): void {
    if (!Number.isSafeInteger(input.price) || input.price <= 0) {
        throw new HomeCareValidationError('السعر يجب أن يكون عدداً صحيحاً أكبر من صفر');
    }
    if (input.durationMin !== undefined && input.durationMin !== null &&
        (!Number.isInteger(input.durationMin) || input.durationMin < 0)) {
        throw new HomeCareValidationError('الحد الأدنى للمدة غير صالح');
    }
    if (input.durationMax !== undefined && input.durationMax !== null &&
        (!Number.isInteger(input.durationMax) || input.durationMax < 0)) {
        throw new HomeCareValidationError('الحد الأعلى للمدة غير صالح');
    }
    if (input.durationMin !== undefined && input.durationMin !== null &&
        input.durationMax !== undefined && input.durationMax !== null && input.durationMax < input.durationMin) {
        throw new HomeCareValidationError('الحد الأعلى للمدة يجب أن يساوي أو يتجاوز الحد الأدنى');
    }
    validateDisplayOrder(input.displayOrder);
}

