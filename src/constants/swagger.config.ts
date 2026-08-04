export const swaggerConfig = {
    documentation: {
        info: {
            title: 'Kanona API',
            version: '1.0.0',
            description: 'REST API لحجز المواعيد الطبية — مرضى، أطباء، عيادات، وإدارة',
        },
        tags: [
            { name: 'Dash', description: 'لوحة التحكم' },
            { name: 'Mobile', description: 'تطبيق الموبايل' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http' as const,
                    scheme: 'bearer' as const,
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [{ bearerAuth: [] }],
    },
};
