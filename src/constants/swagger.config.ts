import { SWAGGER_TAG_DEFINITIONS, SWAGGER_TAG_GROUPS } from './swagger-tags';

export const swaggerConfig = {
  documentation: {
    info: {
      title: "Canona API",
      version: "1.0.0",
      description:
        "REST API لحجز المواعيد الطبية — مرضى، أطباء، عيادات، وإدارة",
    },
    tags: SWAGGER_TAG_DEFINITIONS,
    'x-tagGroups': SWAGGER_TAG_GROUPS,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http" as const,
          scheme: "bearer" as const,
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
};
