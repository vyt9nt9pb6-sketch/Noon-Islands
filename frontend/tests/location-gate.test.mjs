import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendGate } from '../src/realtime/location.js';

test('发送节流：首点立即发、2 秒内不发、移动 ≥5 米或 10 秒才发', () => {
  const g = createSendGate();
  const p = (lng, ts) => ({ lng, lat: 39.9, ts });
  assert.equal(g(p(116.4, 0)), true);
  assert.equal(g(p(116.41, 1000)), false);          // < 2s
  assert.equal(g(p(116.40001, 3000)), false);       // 不到 5 米
  assert.equal(g(p(116.4001, 4000)), true);         // ≈ 8.5 米
  assert.equal(g(p(116.4001, 15000)), true);        // 10 秒保活
});
