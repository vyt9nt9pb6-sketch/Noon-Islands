/**
 * 把地图引擎拷进各端 static 目录（App / 鸿蒙 / H5 的 renderjs 运行时用 <script> 加载）
 *
 * 为什么不直接 import：App 端 renderjs 由 esbuild 以 es2015 目标单独打包，不支持 ?inline / ?worker&url，
 * 且 MapLibre v6 只有 ESM + 独立 worker（maplibre-gl-js #8168 / #8188），App WebView 从 file:// 加载 ES module worker 不可靠。
 * 所以用 MapLibre GL JS v5 的 UMD 包（worker 以内联 blob 方式创建，WebGL1/2 均可）+ pmtiles 的 IIFE 包。
 *
 * 同时用 @protomaps/basemaps 在构建时生成“早期微信风格”的浅色底图图层（中文标注），输出为 protomaps-layers.js。
 * 只拷到 app / h5 的平台专属 static 子目录（鸿蒙构建同样拷贝 app 目录），微信小程序包里不会带上（小程序用原生 <map>）。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { layers, namedFlavor } = require('@protomaps/basemaps');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nm = (p) => path.join(root, 'node_modules', p);
const PLATFORMS = ['h5', 'app']; // app 目录同时被 App 与鸿蒙构建拷贝

// 早期微信风格的浅色配色（在 Protomaps light 基础上调整，全部为原创配色值）
const flavor = {
  ...namedFlavor('light'),
  background: '#f2efe9', earth: '#f2efe9', park_a: '#d8e8c8', park_b: '#d8e8c8', wood_a: '#d3e3c3', wood_b: '#d3e3c3',
  water: '#a9cbe6', highway: '#ffffff', major: '#ffffff', highway_casing_late: '#d9d3c7', major_casing_late: '#d9d3c7',
  buildings: '#e6e1d8'
};
// 不带图标精灵图（sprite 的许可未单独声明）：去掉依赖图标的图层，文字标注保留
const ls = layers('protomaps', flavor, { lang: 'zh-Hans' }).filter(l => !(l.layout && l.layout['icon-image']));

const files = [
  [nm('maplibre-gl/dist/maplibre-gl.js'), 'maplibre-gl.js'],
  [nm('maplibre-gl/dist/maplibre-gl.css'), 'maplibre-gl.css'],
  [nm('maplibre-gl/LICENSE.txt'), 'LICENSE-maplibre-gl.txt'],
  [nm('pmtiles/dist/pmtiles.js'), 'pmtiles.js']
];
const pmLicense = fs.existsSync(nm('pmtiles/LICENSE')) ? nm('pmtiles/LICENSE') : null;
const version = require(nm('maplibre-gl/package.json')).version;

for (const p of PLATFORMS) {
  const out = path.join(root, 'src', 'static', p, 'map');
  fs.mkdirSync(out, { recursive: true });
  for (const [from, to] of files) fs.copyFileSync(from, path.join(out, to));
  if (pmLicense) fs.copyFileSync(pmLicense, path.join(out, 'LICENSE-pmtiles.txt'));
  fs.writeFileSync(path.join(out, 'protomaps-layers.js'),
    '/* 由 scripts/vendor-map.mjs 生成：@protomaps/basemaps（BSD-3，样式 CC0）light 配色调整 + 中文标注 */\n' +
    'window.__wjdProtomapsLayers = ' + JSON.stringify(ls) + ';\n');
}
console.log(`[vendor-map] MapLibre GL JS ${version} + pmtiles + ${ls.length} 个底图图层 → src/static/{${PLATFORMS.join(',')}}/map/`);
