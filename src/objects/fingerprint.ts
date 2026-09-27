import type { ObjectWrite } from './model.js';

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function fingerprint(input: ObjectWrite): string {
  return new Bun.CryptoHasher('sha256').update(canonical({ typeId: input.typeId, title: input.title, properties: input.properties, body: input.body })).digest('hex');
}
