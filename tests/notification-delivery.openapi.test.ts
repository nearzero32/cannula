import {describe,expect,test} from 'bun:test';
import Elysia from 'elysia';
import {openapi} from '@elysia/openapi';
import {swaggerConfig} from '../src/constants/swagger.config';
import {dashboardController} from '../src/controller/dash';
describe('Phase 8B delivery OpenAPI contract',()=>{test('documents summary, list, retry, and safe retry semantics',async()=>{const app=new Elysia({prefix:'/api'}).use(openapi(swaggerConfig)).use(dashboardController),doc:any=await (await app.handle(new Request('http://localhost/api/swagger/json'))).json();expect(doc.paths['/api/dash/admin/notifications/{id}/delivery']?.get).toBeDefined();expect(doc.paths['/api/dash/admin/notifications/{id}/deliveries']?.get).toBeDefined();const retry=doc.paths['/api/dash/admin/notifications/{notificationId}/deliveries/{deliveryId}/retry']?.post;expect(retry).toBeDefined();expect(retry.responses['409']).toBeDefined();const text=JSON.stringify(doc.paths['/api/dash/admin/notifications/{id}/deliveries']);expect(text).not.toContain('claim_token');expect(text).not.toContain('lease_expires_at')})});
