/** Route-level overrides for the global Bearer requirement in Swagger. */
export const PUBLIC_OPENAPI_SECURITY: Record<string, string[]>[] = [];

/** Missing credentials are allowed; presented credentials use the Mobile Bearer scheme. */
export const OPTIONAL_MOBILE_OPENAPI_SECURITY: Record<string, string[]>[] = [
    {},
    { bearerAuth: [] },
];
