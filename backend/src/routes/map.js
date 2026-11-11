/**
 * 地图接口（V1.2：OpenStreetMap 数据 + MapLibre GL，不再使用高德）
 *
 * GET /api/map/config  → 告诉前端用哪套底图。优先级：
 *   1. MAP_STYLE_URL        自定义 MapLibre 样式（例如 OpenFreeMap / 自建 OpenMapTiles 的 style.json）
 *   2. MAP_PMTILES_URL      自建 Protomaps PMTiles 文件（国内对象存储 / 本服务 /tiles）
 *   3. backend/tiles/*.pmtiles 存在 → 本服务自带的 PMTiles（scripts/fetch-tiles.sh 下载的演示范围）
 *   4. 都没有 → OpenFreeMap 公共实例（positron 浅色样式，海外服务器，国内可能慢）
 *   所有来源都失败时，前端退回“相对位置视图”（不加载任何底图）
 *
 * GET /tiles/*         → 静态提供 PMTiles（支持 HTTP Range）与字形 PBF（Noto Sans，OFL）
 *
 * 地图请求不需要也不包含任何 key。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');

const env = (k) => (process.env[k] || '').trim();
const TILES_DIR = process.env.TILES_DIR || path.join(__dirname, '..', '..', 'tiles');

const OSM_ATTR = '© OpenStreetMap contributors';
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

function localPmtiles() {
  try {
    const f = fs.readdirSync(TILES_DIR).filter(n => n.endsWith('.pmtiles')).sort()[0];
    return f ? `/tiles/${encodeURIComponent(f)}` : null;
  } catch { return null; }
}

function mapConfig() {
  const glyphs = env('MAP_GLYPHS_URL') || '/tiles/fonts/{fontstack}/{range}.pbf';
  if (env('MAP_STYLE_URL')) {
    return { source: 'style', styleUrl: env('MAP_STYLE_URL'), attribution: env('MAP_ATTRIBUTION') || OSM_ATTR };
  }
  const pm = env('MAP_PMTILES_URL') || localPmtiles();
  if (pm) {
    return {
      source: 'pmtiles', pmtilesUrl: pm, glyphs, flavor: 'light', lang: 'zh-Hans',
      attribution: '<a href="https://protomaps.com" target="_blank">Protomaps</a> © <a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      fallbackStyleUrl: OPENFREEMAP_STYLE
    };
  }
  return { source: 'style', styleUrl: OPENFREEMAP_STYLE, attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' };
}

const apiRouter = express.Router();
apiRouter.get('/map/config', authRequired, (req, res) => {
  res.set('Cache-Control', 'no-store');
  // coord: 实时位置统一 WGS-84；小程序 <map>（腾讯底图）在客户端转 GCJ-02 显示
  res.json({ code: 0, data: { ...mapConfig(), coord: 'wgs84', miniProgram: { engine: 'native-map', coord: 'gcj02' } } });
});

const tilesStatic = express.static(TILES_DIR, {
  maxAge: '7d', acceptRanges: true, fallthrough: false, dotfiles: 'deny'
});

/** /tiles 的 CORS：底图是公开数据（不含用户信息），允许任意来源读取，含 App WebView（file:// / null 来源）的 Range 预检 */
function tilesCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Match');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

module.exports = { apiRouter, tilesStatic, tilesCors, mapConfig, TILES_DIR };
