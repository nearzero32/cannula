import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { openapi } from '@elysia/openapi';
import { swaggerConfig } from '../src/constants/swagger.config';
import { dashboardController } from '../src/controller/dash/index';

describe('Phase 8A2 generated OpenAPI contract', () => {
  test('documents analytics and drilldown paths with public 409 semantics', async () => {
    const app=new Elysia({prefix:'/api'}).use(openapi(swaggerConfig)).use(dashboardController);
    const doc:any=await (await app.handle(new Request('http://localhost/api/swagger/json'))).json();
    for(const suffix of ['analytics','readers','recipients','unread-recipients']) expect(doc.paths[`/api/dash/admin/notifications/{id}/${suffix}`]?.get).toBeDefined();
    expect(doc.paths['/api/dash/admin/notifications/{id}/recipients'].get.responses['409']).toBeDefined();
    expect(doc.paths['/api/dash/admin/notifications/{id}/unread-recipients'].get.responses['409']).toBeDefined();
    expect(JSON.stringify(doc.paths['/api/dash/admin/notifications/{id}/readers'])).not.toContain('installation_key_hash');
  });
});
