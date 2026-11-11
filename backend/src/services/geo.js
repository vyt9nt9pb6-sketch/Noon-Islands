/**
 * 午间岛 - 坐标转换：WGS-84（GPS / 浏览器定位）⇄ GCJ-02（高德 / 腾讯 / 中国大陆地图）
 *
 * 公开标准算法（Krasovsky 1940 椭球参数），与 World Map 项目 public/js/lib/coords.js
 * 以及业界常用的 wandergis/coordtransform（MIT）采用同一套公式；此处为 CommonJS 重写版。
 * 中国大陆矩形框外不做偏移（香港、澳门、台湾在框内，V1 与 World Map 保持一致）。
 */
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new TypeError('invalid coordinate');
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371008.8;
  const toRad = (d) => (d * PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** GCJ-02 → WGS-84（迭代反解，误差约 1 厘米） */
function gcj02ToWgs84(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new TypeError('invalid coordinate');
  if (outOfChina(lng, lat)) return [lng, lat];
  let wLng = lng, wLat = lat;
  for (let i = 0; i < 10; i++) {
    const [gLng, gLat] = wgs84ToGcj02(wLng, wLat);
    const eLng = gLng - lng, eLat = gLat - lat;
    wLng -= eLng; wLat -= eLat;
    if (Math.abs(eLng) < 1e-9 && Math.abs(eLat) < 1e-9) break;
  }
  return [wLng, wLat];
}

/**
 * V1.2：实时位置统一用 WGS-84 转发（OpenStreetMap 底图是 WGS-84，与 GPS 原始坐标一致）。
 * 只有微信小程序上报的是 GCJ-02（腾讯 <map>），在这里反解回 WGS-84；
 * 小程序显示时再在客户端转回 GCJ-02。
 */
function toWgs84(lng, lat, coord) {
  if (coord === 'gcj02') return gcj02ToWgs84(lng, lat);
  return [lng, lat];
}

module.exports = { outOfChina, wgs84ToGcj02, gcj02ToWgs84, toWgs84, haversine };
