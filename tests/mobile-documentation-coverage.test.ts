import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const mobileControllerDir = join(root, 'src', 'controller', 'mobile');
const referencePath = join(root, 'src', 'docs', 'mobile', 'mobile-api-reference.md');

const normalize = (path: string) => path.length > 1 ? path.replace(/\/+$/, '') : path;

function controllerRoutes(): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(mobileControllerDir).filter(name => name.endsWith('.controller.ts'))) {
    const source = readFileSync(join(mobileControllerDir, name), 'utf8');
    const prefix = source.match(/prefix:\s*['"]([^'"]+)['"]/)?.[1];
    if (!prefix) throw new Error(`No controller prefix found in ${name}`);
    for (const match of source.matchAll(/^\s*\.(get|post|patch|put|delete)\s*\(\s*['"]([^'"]+)['"]/gmi)) {
      routes.push(`${match[1]!.toUpperCase()} ${normalize(`/mobile${prefix}${match[2]}`)}`);
    }
  }

  const uploadSource = readFileSync(join(root, 'src', 'controller', 'shared', 'upload.controller.ts'), 'utf8');
  const uploadPrefix = uploadSource.match(/prefix:\s*['"]([^'"]+)['"]/)?.[1];
  if (!uploadPrefix) throw new Error('No shared upload prefix found');
  for (const match of uploadSource.matchAll(/^\s*\.(get|post|patch|put|delete)\s*\(\s*['"]([^'"]+)['"]/gmi)) {
    routes.push(`${match[1]!.toUpperCase()} ${normalize(`/mobile${uploadPrefix}${match[2]}`)}`);
  }
  return [...new Set(routes)].sort();
}

function documentedRoutes(): string[] {
  const markdown = readFileSync(referencePath, 'utf8');
  return [...new Set([...markdown.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/mobile\/[^`? ]+)/g)]
    .map(match => `${match[1]} ${normalize(match[2]!)}`))].sort();
}

function postmanRequests(): string[] {
  const collection = JSON.parse(readFileSync(join(root, 'src', 'docs', 'mobile', 'cannula-mobile.postman_collection.json'), 'utf8'));
  const requests: string[] = [];
  const walk = (items: any[]) => items.forEach(item => {
    if (item.item) return walk(item.item);
    const raw = typeof item.request?.url === 'string' ? item.request.url : item.request?.url?.raw;
    if (!raw) return;
    const path = raw.replace('{{baseUrl}}', '').split('?')[0];
    requests.push(`${String(item.request.method).toUpperCase()} ${normalize(path)}`);
  });
  walk(collection.item ?? []);
  return [...new Set(requests)].sort();
}

describe('Mobile documentation route coverage', () => {
  test('compact reference covers every registered Mobile and shared upload route', () => {
    const executable = controllerRoutes();
    expect(executable).toHaveLength(66);
    expect(documentedRoutes()).toEqual(executable);
  });

  test('Postman collection covers the same route inventory', () => {
    const canonical = (route: string) => route
      .replace(/\{\{[^}]+\}\}/g, ':param')
      .replace(/:[^/]+/g, ':param');
    expect(postmanRequests().map(canonical).sort()).toEqual(controllerRoutes().map(canonical).sort());
  });
});
