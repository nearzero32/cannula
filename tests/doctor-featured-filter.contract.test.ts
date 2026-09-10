import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { Value } from '@sinclair/typebox/value';
import { mobileDoctorsController } from '../src/controller/mobile/doctors.controller';
import doctorService from '../src/services/doctor.service';
import availableDoctorsService from '../src/services/available-doctors.service';
import RedisClient from '../src/databases/redis';

afterEach(() => mock.restore());

describe('Mobile Doctor featured filter contract', () => {
    test('both query schemas accept omitted/true/false and reject arbitrary strings', () => {
        for (const path of ['/doctors/', '/doctors/available']) {
            const route = mobileDoctorsController.routes.find(item => item.path === path);
            const schema = route?.hooks.query;
            expect(schema, path).toBeDefined();
            expect(Value.Check(schema as never, {}), path).toBe(true);
            expect(Value.Check(schema as never, { is_featured: 'true' }), path).toBe(true);
            expect(Value.Check(schema as never, { is_featured: 'false' }), path).toBe(true);
            expect(Value.Check(schema as never, { is_featured: 'featured' }), path).toBe(false);
        }
    });

    test('list applies featured-only for true and identical no-filter semantics for false/omitted', async () => {
        const matches: Array<Record<string, unknown>> = [];
        spyOn(doctorService, 'getPaginated').mockImplementation(async ({ main_match }: any) => {
            matches.push(main_match);
            return { data: [], count: 0 } as never;
        });
        const app = new Elysia().use(mobileDoctorsController);
        for (const suffix of ['', '?is_featured=false', '?is_featured=true']) {
            expect((await app.handle(new Request(`http://localhost/doctors/${suffix}`))).status).toBe(200);
        }
        expect(matches[0]).toEqual(matches[1]);
        expect(matches[0]).not.toHaveProperty('is_featured');
        expect(matches[2]).toMatchObject({ is_featured: true });
    });

    test('available discovery applies the same three-state semantics and shared cache normalization', async () => {
        const filters: Array<Record<string, unknown>> = [];
        spyOn(RedisClient.getInstance(), 'get').mockResolvedValue(null);
        spyOn(RedisClient.getInstance(), 'set').mockResolvedValue();
        spyOn(availableDoctorsService, 'discover').mockImplementation(async (value: any) => {
            filters.push(value);
            return [];
        });
        const app = new Elysia().use(mobileDoctorsController);
        for (const suffix of ['', '?is_featured=false', '?is_featured=true']) {
            expect((await app.handle(new Request(`http://localhost/doctors/available${suffix}`))).status).toBe(200);
        }
        expect(filters[0]).toEqual(filters[1]);
        expect(filters[0]?.is_featured).toBeUndefined();
        expect(filters[2]?.is_featured).toBe(true);
    });
});
