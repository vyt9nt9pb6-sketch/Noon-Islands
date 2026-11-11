// V1.2：OSM 底图（WGS-84）坐标、Protomaps 图层、位置隐私提示文案
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../src/utils/coords.js';
import { LOCATION_NOTICE_POINTS, noticePlainText } from '../src/realtime/privacy-notice.js';

const require = createRequire(import.meta.url);

test('GCJ-02 → WGS-84 反解与正向转换互逆（误差 < 0.5 米）', () => {
  const w = [116.391234, 39.906543];
  const g = wgs84ToGcj02(...w);
  const back = gcj02ToWgs84(...g);
  assert.ok(Math.abs(back[0] - w[0]) < 5e-6 && Math.abs(back[1] - w[1]) < 5e-6, JSON.stringify(back));
});

test('境外坐标不做偏移', () => {
  assert.deepEqual(gcj02ToWgs84(-122.4, 37.8), [-122.4, 37.8]);
});

test('Protomaps 图层：不依赖图标精灵图，字体都在本服务提供的字形里', () => {
  execVendor();
  const src = fs.readFileSync(new URL('../src/static/h5/map/protomaps-layers.js', import.meta.url), 'utf-8');
  const layers = JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;$/, ''));
  assert.ok(layers.length > 40);
  assert.ok(!layers.some(l => l.layout && l.layout['icon-image']), '存在 icon-image 图层');
  const fonts = new Set();
  JSON.stringify(layers).replace(/Noto Sans (Regular|Medium|Italic)/g, (m) => fonts.add(m)); // 其他文种（如 Devanagari）字形缺失时 MapLibre 只跳过该标注，国内用不到
  const shipped = fs.readdirSync(new URL('../../backend/tiles/fonts/', import.meta.url));
  for (const f of fonts) assert.ok(shipped.includes(f), `缺少字形 ${f}`);
  assert.ok(/name:zh-Hans|pgf:name:zh-Hans|name:zh/.test(src), '应有中文标注');
});

test('隐私提示写明：位置不保存、退出即删除、可撤回、仅对方可见', () => {
  const t = noticePlainText();
  for (const kw of ['不保存', '退出即删除', '撤回', '只有当前单聊的对方']) assert.ok(t.includes(kw), kw);
  assert.ok(LOCATION_NOTICE_POINTS.length >= 5);
});

function execVendor() {
  if (fs.existsSync(new URL('../src/static/h5/map/protomaps-layers.js', import.meta.url))) return;
  require('node:child_process').execFileSync(process.execPath, [new URL('../scripts/vendor-map.mjs', import.meta.url).pathname]);
}
