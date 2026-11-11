// 前端纯函数单元测试：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { linearToMulaw, mulawToLinear, encodeFloat32, decodeToFloat32, createDownsampler, createFramer, packFrame, unpackFrame } from '../src/realtime/codec.js';
import { wgs84ToGcj02, gcj02ToWgs84, outOfChina } from '../src/utils/coords.js';

test('μ-law 编解码往返误差在 G.711 量化范围内', () => {
  for (const x of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000]) {
    const y = mulawToLinear(linearToMulaw(x));
    assert.ok(Math.abs(y - x) <= Math.max(8, Math.abs(x) * 0.07), `${x} -> ${y}`);
  }
  // 标准值：0 → 0xFF，正满幅 → 0x80
  assert.equal(linearToMulaw(0), 0xff);
  assert.equal(linearToMulaw(32767), 0x80);
});

test('Float32 编解码保持波形', () => {
  const n = 320, f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 8000);
  const back = decodeToFloat32(encodeFloat32(f));
  let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(back[i] - f[i]));
  assert.ok(err < 0.03, `max err ${err}`);
});

test('48k → 8k 降采样长度正确（流式跨块）', () => {
  const d = createDownsampler(48000, 8000);
  let total = 0;
  for (let k = 0; k < 10; k++) total += d(new Float32Array(1024).fill(0.1)).length;
  assert.equal(total, Math.floor(10240 / 6));
  const d2 = createDownsampler(44100, 8000);
  let t2 = 0; for (let k = 0; k < 43; k++) t2 += d2(new Float32Array(1024)).length;
  assert.ok(Math.abs(t2 - (43 * 1024 * 8000) / 44100) <= 1);
});

test('切帧：每 320 样本一帧，余数保留', () => {
  const frames = [];
  const fr = createFramer(320, (f) => frames.push(f.length));
  fr.push(new Float32Array(500)); fr.push(new Float32Array(500));
  assert.deepEqual(frames, [320, 320, 320]);
});

test('帧格式与后端一致：codec=1，序号 BE，streamId 由服务端写', () => {
  const ab = packFrame(258, new Uint8Array([1, 2, 3]));
  const u = new Uint8Array(ab);
  assert.deepEqual([...u], [1, 1, 2, 0, 1, 2, 3]);
  u[3] = 7;
  const f = unpackFrame(ab);
  assert.equal(f.seq, 258); assert.equal(f.streamId, 7); assert.equal(f.payload.length, 3);
});

test('WGS-84 → GCJ-02：北京偏移约 600 米，境外不偏移，可反解', () => {
  const [lng, lat] = wgs84ToGcj02(116.391234, 39.906543);
  assert.ok(lng - 116.391234 > 0.005 && lng - 116.391234 < 0.0075);
  assert.ok(outOfChina(-122.4, 37.7));
  assert.deepEqual(wgs84ToGcj02(-122.4, 37.7), [-122.4, 37.7]);
  const [w1, w2] = gcj02ToWgs84(lng, lat);
  assert.ok(Math.abs(w1 - 116.391234) < 1e-6 && Math.abs(w2 - 39.906543) < 1e-6);
});
