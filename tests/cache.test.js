import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedSource } from '../src/services/cache.js';
import { fakeStorage } from './helpers.js';

test('cache: 成功したら保存し、次回の失敗時に前回値を error:true で返す', async () => {
  const storage = fakeStorage(); let t = 1000; let fail = false;
  const load = async () => { if (fail) throw new Error('offline'); return { temp: 12 }; };
  const src = createCachedSource({ key: 'desk.cache.weather', load, storage, now: () => t });
  assert.deepEqual(await src.refresh(), { data: { temp: 12 }, updatedAt: 1000, error: false });
  fail = true; t = 5000;
  assert.deepEqual(await src.refresh(), { data: { temp: 12 }, updatedAt: 1000, error: true });
  // 別インスタンス（再読み込み後）でも前回値が読める
  const again = createCachedSource({ key: 'desk.cache.weather', load, storage, now: () => t });
  assert.deepEqual(again.current(), { data: { temp: 12 }, updatedAt: 1000, error: false });
});

test('cache: 保存がなく失敗したら data:null', async () => {
  const src = createCachedSource({ key: 'k', load: async () => { throw new Error('x'); }, storage: fakeStorage(), now: () => 0 });
  assert.deepEqual(await src.refresh(), { data: null, updatedAt: null, error: true });
});

test('cache: current() は取得せず保存済みの値を返す', () => {
  let calls = 0;
  const src = createCachedSource({ key: 'k', load: async () => { calls++; return 1; }, storage: fakeStorage(), now: () => 0 });
  assert.deepEqual(src.current(), { data: null, updatedAt: null, error: false });
  assert.equal(calls, 0);
});

test('cache: 壊れた保存データは未取得として扱う', () => {
  const src = createCachedSource({ key: 'k', load: async () => 1, storage: fakeStorage({ k: '<html>' }), now: () => 0 });
  assert.deepEqual(src.current(), { data: null, updatedAt: null, error: false });
});

test('cache: 失敗後に成功すれば error が消える', async () => {
  let fail = true;
  const src = createCachedSource({ key: 'k', load: async () => { if (fail) throw new Error('x'); return 7; }, storage: fakeStorage(), now: () => 9 });
  await src.refresh(); fail = false;
  assert.deepEqual(await src.refresh(), { data: 7, updatedAt: 9, error: false });
  assert.deepEqual(src.current(), { data: 7, updatedAt: 9, error: false });
});

test('cache: validate に通らない保存データは未取得として扱う', () => {
  const storage = fakeStorage({ k: JSON.stringify({ data: { not: 'array' }, updatedAt: 5 }) });
  const src = createCachedSource({ key: 'k', load: async () => [], storage, now: () => 0, validate: Array.isArray });
  assert.deepEqual(src.current(), { data: null, updatedAt: null, error: false });
});

test('cache: validate に通らない取得結果は失敗として扱い、前回値を保つ', async () => {
  const storage = fakeStorage({ k: JSON.stringify({ data: [1], updatedAt: 5 }) });
  const src = createCachedSource({ key: 'k', load: async () => 'oops', storage, now: () => 9, validate: Array.isArray });
  assert.deepEqual(await src.refresh(), { data: [1], updatedAt: 5, error: true });
});
