<template>
  <view class="live-map">
    <!-- 微信小程序：原生 <map>（腾讯底图，坐标系 GCJ-02）。小程序不能加载自定义瓦片 WebGL 引擎，
         所以这里仍用平台自带地图；实时位置统一是 WGS-84，显示前转 GCJ-02。 -->
    <!-- #ifdef MP-WEIXIN -->
    <map
      class="lm-native"
      :latitude="center.lat" :longitude="center.lng" :scale="15"
      :markers="mpMarkers" :include-points="includePoints" :circles="mpCircles"
      :show-location="false" :enable-3D="false" :show-compass="false"
    ></map>
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <!-- H5 / App：MapLibre GL JS（BSD-3）+ OpenStreetMap 矢量瓦片（Protomaps PMTiles 或 OpenFreeMap），renderjs 在 WebView 里运行 -->
    <view class="lm-web" :id="domId" :prop="mapData" :change:prop="lm.update"></view>
    <!-- #endif -->
  </view>
</template>

<script>
import { wgs84ToGcj02 } from '@/utils/coords';

let seq = 0;
export default {
  name: 'LiveMap',
  props: {
    markers: { type: Array, default: () => [] }, // [{ id, lng, lat, label, color, self, accuracy }]（WGS-84）
    mapCfg: { type: Object, default: null },      // 来自 /api/map/config（URL 已转绝对地址）；{ source:'none' } → 相对位置视图
    focusSeq: { type: Number, default: 0 },
    focus: { type: String, default: 'both' }      // both | me | peer
  },
  data() { return { domId: `lm_${Date.now().toString(36)}_${seq++}` }; },
  computed: {
    mapData() {
      return { domId: this.domId, markers: this.markers, cfg: this.mapCfg, focusSeq: this.focusSeq, focus: this.focus };
    },
    // 小程序 <map> 用 GCJ-02
    gcjMarkers() {
      return this.markers.map(m => { const [lng, lat] = wgs84ToGcj02(m.lng, m.lat); return { ...m, lng, lat }; });
    },
    center() {
      const ms = this.gcjMarkers;
      const m = ms.find(x => (this.focus === 'me' ? x.self : this.focus === 'peer' ? !x.self : true)) || ms[0];
      return m ? { lng: m.lng, lat: m.lat } : { lng: 116.397428, lat: 39.90923 };
    },
    includePoints() { return this.focus === 'both' && this.gcjMarkers.length > 1 ? this.gcjMarkers.map(m => ({ latitude: m.lat, longitude: m.lng })) : []; },
    mpMarkers() {
      return this.gcjMarkers.map((m, i) => ({
        id: i + 1, latitude: m.lat, longitude: m.lng, width: 30, height: 30, anchor: { x: 0.5, y: 0.5 },
        iconPath: m.self ? '/static/marker-me.png' : '/static/marker-peer.png',
        callout: { content: m.label, display: 'ALWAYS', padding: 6, borderRadius: 4, fontSize: 12, bgColor: '#ffffffee', color: '#000000' }
      }));
    },
    mpCircles() {
      return this.gcjMarkers.filter(m => m.accuracy).map(m => ({
        latitude: m.lat, longitude: m.lng, radius: Math.min(m.accuracy, 500),
        color: m.self ? '#09BB0733' : '#576B9533', fillColor: m.self ? '#09BB071a' : '#576B951a', strokeWidth: 1
      }));
    }
  }
};
</script>

<!-- #ifndef MP-WEIXIN -->
<script module="lm" lang="renderjs">
/*
 * 运行在 WebView（H5 页面 / App 的 renderjs 层）。
 * 底图：OpenStreetMap 数据（ODbL），不使用高德 / World Map 的任何数据、样式或 key。
 *  - source = 'pmtiles'：Protomaps 单文件矢量瓦片（自建，HTTP Range 读取），样式由 @protomaps/basemaps 生成
 *  - source = 'style'  ：任意 MapLibre 样式 URL（默认 OpenFreeMap positron）
 *  - 都加载失败 → 相对位置视图（不依赖任何在线服务）
 * 中文：优先显示 name:zh-Hans / name:zh；汉字由本机字体渲染（localIdeographFontFamily，不下载 CJK 字形）。
 */
/*
 * 引擎文件由 scripts/vendor-map.mjs 拷到平台专属 static 目录，运行时用 <script> 加载（App 端 renderjs 不能打包 ESM worker）。
 * MapLibre GL JS v5 UMD（BSD-3）+ pmtiles IIFE（BSD-3）+ 构建时生成的 Protomaps 图层（@protomaps/basemaps，BSD-3 / CC0）。
 */
// #ifdef H5
const VENDOR = 'static/h5/map/';
// #endif
// #ifdef APP
const VENDOR = 'static/app/map/'; // App（Android/iOS）与鸿蒙共用 static/app（鸿蒙构建也会拷贝 app 目录）
// #endif

const CJK_FONTS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "HarmonyOS Sans SC", sans-serif';
const ZH_NAME = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']];
let protocolAdded = false;
// MapLibre 实例不能放进 Vue 响应式 data（会被 Proxy 包装，身份比较失效且拖慢渲染），按 domId 存在模块级表里
const INST = {};
const inst = (id) => (INST[id] || (INST[id] = { map: null, markers: {} }));

function vendorUrl(f) {
  // H5 部署在子路径时也能找到：相对当前页面目录
  return new URL(VENDOR + f, document.baseURI).href;
}
function loadScript(f, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = vendorUrl(f);
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(globalName + ' missing')));
    s.onerror = () => reject(new Error('load ' + f + ' failed'));
    document.head.appendChild(s);
  });
}
let engine = null;
function loadEngine() {
  if (engine) return engine;
  if (!document.getElementById('wjd-maplibre-css')) {
    const l = document.createElement('link');
    l.id = 'wjd-maplibre-css'; l.rel = 'stylesheet'; l.href = vendorUrl('maplibre-gl.css');
    document.head.appendChild(l);
  }
  engine = Promise.all([loadScript('maplibre-gl.js', 'maplibregl'), loadScript('pmtiles.js', 'pmtiles'), loadScript('protomaps-layers.js', '__wjdProtomapsLayers')])
    .then(([gl]) => gl)
    .catch((e) => { engine = null; throw e; });
  return engine;
}

function pmtilesStyle(cfg) {
  const maplibregl = window.maplibregl;
  if (!protocolAdded) { maplibregl.addProtocol('pmtiles', new window.pmtiles.Protocol().tile); protocolAdded = true; }
  return {
    version: 8,
    glyphs: cfg.glyphs,
    sources: { protomaps: { type: 'vector', url: 'pmtiles://' + cfg.pmtilesUrl, attribution: cfg.attribution } },
    layers: window.__wjdProtomapsLayers
  };
}

/* OpenMapTiles 样式（OpenFreeMap 等）：标注改成中文优先 */
function chineseLabels(map) {
  const style = map.getStyle();
  for (const l of (style && style.layers) || []) {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
    if (/housenumber|shield|ref/.test(l.id)) continue;
    try { map.setLayoutProperty(l.id, 'text-field', ZH_NAME); } catch (e) { /* 忽略 */ }
  }
}

/* 标注与降级视图的样式：Marker 元素和 innerHTML 不受组件样式作用域影响，所以注入到 <head> */
const MAP_CSS = `
.lmk { position: relative; display: flex; flex-direction: column; align-items: center; }
.lmk-dot { width: 36px; height: 36px; border-radius: 10px; border: 2px solid #fff; color: #fff; font-weight: 600; font-size: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3); position: relative; z-index: 2; }
.lmk-arrow { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid #fff; margin-top: -1px; position: relative; z-index: 2; }
.lmk-pulse { position: absolute; top: 18px; left: 50%; margin-left: -30px; margin-top: -30px; width: 60px; height: 60px; border-radius: 50%; background: rgba(87, 107, 149, 0.28); animation: lmkpulse 2s ease-out infinite; z-index: 1; }
.lmk.me .lmk-pulse { background: rgba(9, 187, 7, 0.25); }
.lmk-name { margin-top: 2px; padding: 1px 6px; border-radius: 8px; font-size: 12px; color: #000; background: rgba(255, 255, 255, 0.92); border: 1px solid #d9d9d9; white-space: nowrap; }
@keyframes lmkpulse { 0% { transform: scale(0.5); opacity: 0.9; } 100% { transform: scale(1.6); opacity: 0; } }
.lm-gl, .lm-gl.maplibregl-map { position: absolute !important; left: 0; top: 0; width: 100%; height: 100%; }
.lmf { position: absolute; inset: 0; overflow: hidden; background: #f2efe9; }
.lmf-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, 0.8) 2px, transparent 2px), linear-gradient(90deg, rgba(255, 255, 255, 0.8) 2px, transparent 2px), linear-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.4) 1px, transparent 1px); background-size: 160px 160px, 160px 160px, 40px 40px, 40px 40px; }
.lmf-pin { position: absolute; transform: translate(-50%, -18px); }
.lmf-acc { position: absolute; border-radius: 50%; border: 1px solid; }
.lmf-line { position: absolute; left: 0; top: 0; pointer-events: none; }
.lmf-empty { position: absolute; top: 40%; width: 100%; text-align: center; color: #888; font-size: 15px; }
.lmf-scale { position: absolute; left: 12px; top: 150px; font-size: 11px; color: #555; display: flex; align-items: center; gap: 6px; }
.lmf-scale .bar { height: 4px; border: 2px solid #555; border-top: none; }
.lmf-note { position: absolute; left: 12px; top: 172px; font-size: 11px; color: #888; background: rgba(255, 255, 255, 0.8); padding: 2px 8px; border-radius: 3px; }`;
function injectCss() {
  if (document.getElementById('wjd-live-map-css')) return;
  const st = document.createElement('style');
  st.id = 'wjd-live-map-css';
  st.textContent = MAP_CSS;
  document.head.appendChild(st);
}

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pinHtml(m) {
  return `<div class="lmk ${m.self ? 'me' : 'peer'}"><div class="lmk-pulse"></div><div class="lmk-dot" style="background:${esc(m.color)}">${esc((m.initial || m.label || '?').slice(0, 1))}</div><div class="lmk-arrow"></div><div class="lmk-name">${esc(m.label)}</div></div>`;
}
/* 定位精度圈（GeoJSON 多边形，单位米） */
function circlePolygon(lng, lat, r) {
  const pts = [];
  const dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return pts;
}

export default {
  data() { return { mode: null, last: null, fitted: false, lastFocusSeq: -1, triedFallbackStyle: false }; },
  methods: {
    update(val) {
      if (!val) return;
      this.last = val;
      const el = document.getElementById(val.domId);
      if (!el) { setTimeout(() => this.update(this.last), 50); return; }
      if (!this.mode && val.cfg) {
        injectCss();
        if (val.cfg.source === 'pmtiles' || val.cfg.source === 'style') {
          this.mode = 'loading';
          loadEngine().then(() => this.startGl(el, val.cfg, false)).catch(() => { this.mode = 'fallback'; this.renderFallback(this.last); });
        } else this.mode = 'fallback';
      }
      if (this.mode === 'gl') this.renderGl(val);
      else if (this.mode === 'fallback') this.renderFallback(val);
    },
    startGl(el, cfg, useFallbackStyle) {
      const maplibregl = window.maplibregl;
      this.mode = 'loading';
      let style;
      try {
        style = useFallbackStyle ? cfg.fallbackStyleUrl : cfg.source === 'pmtiles' ? pmtilesStyle(cfg) : cfg.styleUrl;
      } catch (e) { this.mode = 'fallback'; this.renderFallback(this.last); return; }
      el.innerHTML = '<div class="lm-gl"></div>';
      const box = el.firstChild;
      let map;
      try {
        map = new maplibregl.Map({
          container: box, style, center: this.centerOf(this.last) || [116.397428, 39.90923], zoom: 15,
          attributionControl: false, localIdeographFontFamily: CJK_FONTS, dragRotate: false, pitchWithRotate: false,
          fadeDuration: 0
        });
      } catch (e) { // 没有 WebGL 等
        this.mode = 'fallback'; this.renderFallback(this.last); return;
      }
      map.touchZoomRotate.disableRotation();
      const I = inst(this.last.domId);
      // 署名（ODbL 要求 © OpenStreetMap contributors）由页面在底部面板上方显示，避免被面板遮住
      I.map = map;
      window.__wjdMap = map; // 调试 / e2e 用
      const fail = () => {
        if (this.mode !== 'loading' || I.map !== map) return;
        try { map.remove(); } catch (e) { /* */ }
        I.map = null; I.markers = {};
        if (!useFallbackStyle && cfg.fallbackStyleUrl && !this.triedFallbackStyle) { this.triedFallbackStyle = true; this.startGl(el, cfg, true); return; }
        this.mode = 'fallback'; this.renderFallback(this.last);
      };
      const timer = setTimeout(fail, 12000);
      map.on('error', (e) => {
        // 缺少某个字形分段等非致命错误会继续渲染；样式本身加载失败才降级
        if (this.mode === 'loading' && e && e.error && /style|pmtiles|Failed to fetch|NetworkError/i.test(String(e.error.message || ''))) { clearTimeout(timer); fail(); }
      });
      map.on('load', () => { try { onLoaded(); } catch (e) { console.error('[live-map] 初始化标注失败', e); } });
      const onLoaded = () => {
        clearTimeout(timer);
        if (I.map !== map) return;
        if (cfg.source !== 'pmtiles' || useFallbackStyle) chineseLabels(map);
        map.addSource('lm-acc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'lm-acc-fill', type: 'fill', source: 'lm-acc', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'lm-acc-line', type: 'line', source: 'lm-acc', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.4, 'line-width': 1 } });
        this.mode = 'gl';
        window.__wjdMapMode = useFallbackStyle ? 'fallback-style' : cfg.source; // 调试 / e2e 用
        this.renderGl(this.last);
      };
    },
    centerOf(val) {
      const ms = (val && val.markers) || [];
      const m = ms.find(x => (val.focus === 'me' ? x.self : val.focus === 'peer' ? !x.self : true)) || ms[0];
      return m ? [m.lng, m.lat] : null;
    },
    renderGl(val) {
      const maplibregl = window.maplibregl;
      const I = inst(val.domId);
      const map = I.map;
      if (!map) return;
      const ms = val.markers || [];
      const seen = {};
      for (const m of ms) {
        seen[m.id] = true;
        if (!I.markers[m.id]) {
          const div = document.createElement('div');
          div.innerHTML = pinHtml(m);
          I.markers[m.id] = new maplibregl.Marker({ element: div.firstChild, anchor: 'top', offset: [0, -18] }).setLngLat([m.lng, m.lat]).addTo(map);
        } else I.markers[m.id].setLngLat([m.lng, m.lat]);
      }
      for (const id of Object.keys(I.markers)) if (!seen[id]) { I.markers[id].remove(); delete I.markers[id]; }
      const src = map.getSource('lm-acc');
      if (src) src.setData({ type: 'FeatureCollection', features: ms.filter(m => m.accuracy).map(m => ({ type: 'Feature', properties: { color: m.color }, geometry: { type: 'Polygon', coordinates: [circlePolygon(m.lng, m.lat, Math.min(m.accuracy, 500))] } })) });
      const refocus = val.focusSeq !== this.lastFocusSeq;
      if (ms.length && (refocus || !this.fitted)) {
        this.lastFocusSeq = val.focusSeq;
        if (val.focus === 'both' && ms.length > 1) {
          const b = new maplibregl.LngLatBounds();
          ms.forEach(m => b.extend([m.lng, m.lat]));
          map.fitBounds(b, { padding: { top: 170, bottom: 300, left: 80, right: 110 }, maxZoom: 16, duration: 0 });
        } else map.jumpTo({ center: this.centerOf(val), zoom: 16 });
        this.fitted = ms.length > 1 || refocus;
      }
    },
    /* 底图不可用时：相对位置视图（不依赖任何在线服务） */
    renderFallback(val) {
      const el = document.getElementById(val.domId);
      if (!el) return;
      window.__wjdMapMode = 'relative';
      const ms = val.markers || [];
      const W = el.clientWidth || 390, H = el.clientHeight || 700;
      let html = '<div class="lmf"><div class="lmf-grid"></div>';
      if (!ms.length) {
        html += '<div class="lmf-empty">等待位置…</div>';
      } else {
        const cx = ms.reduce((a, m) => a + m.lng, 0) / ms.length;
        const cy = ms.reduce((a, m) => a + m.lat, 0) / ms.length;
        const mPerLat = 111320, mPerLng = 111320 * Math.cos(cy * Math.PI / 180);
        const pts = ms.map(m => ({ m, x: (m.lng - cx) * mPerLng, y: (m.lat - cy) * mPerLat }));
        const span = Math.max(200, ...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)) * 2.6));
        const scale = Math.min(W, H * 0.6) / span;
        for (const p of pts) {
          const left = W / 2 + p.x * scale, top = H * 0.42 - p.y * scale;
          if (p.m.accuracy) {
            const r = Math.max(10, Math.min(p.m.accuracy, 500) * scale);
            html += `<div class="lmf-acc" style="left:${left - r}px;top:${top - r}px;width:${r * 2}px;height:${r * 2}px;background:${esc(p.m.color)}22;border-color:${esc(p.m.color)}55"></div>`;
          }
          html += `<div class="lmf-pin" style="left:${left}px;top:${top}px">${pinHtml(p.m)}</div>`;
        }
        if (pts.length === 2) {
          const [a, b] = pts;
          html += `<svg class="lmf-line" width="${W}" height="${H}"><line x1="${W / 2 + a.x * scale}" y1="${H * 0.42 - a.y * scale}" x2="${W / 2 + b.x * scale}" y2="${H * 0.42 - b.y * scale}" stroke="#576B95" stroke-width="2" stroke-dasharray="6 6" opacity="0.55"/></svg>`;
        }
        const nice = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find(v => v * scale >= 60) || 50000;
        html += `<div class="lmf-scale"><div class="bar" style="width:${nice * scale}px"></div><span>${nice >= 1000 ? nice / 1000 + ' 公里' : nice + ' 米'}</span></div>`;
      }
      html += '<div class="lmf-note">地图未加载 · 显示相对位置</div></div>';
      el.innerHTML = html;
    }
  }
};
</script>
<!-- #endif -->

<style>
.live-map { position: absolute; left: 0; top: 0; right: 0; bottom: 0; }
.lm-native, .lm-web { width: 100%; height: 100%; position: relative; }
</style>
