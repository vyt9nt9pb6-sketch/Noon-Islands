/**
 * 位置提供者（可插拔）。统一接口：
 *   const stop = provider.watch(onFix, onError)
 *   fix = { lng, lat, coord: 'wgs84' | 'gcj02', accuracy, heading, speed, ts }
 *
 * 平台实现：
 *   H5        navigator.geolocation.watchPosition（WGS-84）
 *   微信小程序  uni.startLocationUpdate + uni.onLocationChange（type: gcj02，仅前台）
 *   App       plus.geolocation.watchPosition（系统定位，WGS-84）
 *   鸿蒙      uni.getLocation 轮询（WGS-84）
 * V1.2：坐标统一为 WGS-84（OpenStreetMap 底图）。只有小程序拿到的是 GCJ-02，服务端反解（backend/src/services/geo.js）；
 * 小程序原生 <map>（腾讯底图，GCJ-02）显示前在 live-map 组件里转回 GCJ-02。
 * 原生实现可通过 registerLocationProvider() 注入。
 */
let injected = null;
export function registerLocationProvider(p) { injected = p; }

function normalize(c, coord) {
  return {
    lng: Number(c.longitude), lat: Number(c.latitude), coord,
    accuracy: c.accuracy != null ? Number(c.accuracy) : null,
    heading: c.heading != null && !Number.isNaN(Number(c.heading)) ? Number(c.heading) : null,
    speed: c.speed != null && Number(c.speed) >= 0 ? Number(c.speed) : null,
    ts: Date.now()
  };
}

function pollingProvider(type) {
  return {
    name: `poll-${type}`,
    watch(onFix, onError) {
      let alive = true;
      const tick = () => {
        if (!alive) return;
        uni.getLocation({
          type, isHighAccuracy: true,
          success: (r) => alive && onFix(normalize(r, type)),
          fail: (e) => alive && onError && onError(new Error((e && e.errMsg) || '定位失败')),
          complete: () => { if (alive) timer = setTimeout(tick, 3000); }
        });
      };
      let timer = null;
      tick();
      return () => { alive = false; clearTimeout(timer); };
    }
  };
}

export function getLocationProvider() {
  if (injected) return injected;
  // #ifdef H5
  return {
    name: 'h5-geolocation',
    watch(onFix, onError) {
      if (!navigator.geolocation) { onError && onError(new Error('此浏览器不支持定位')); return () => {}; }
      const id = navigator.geolocation.watchPosition(
        (p) => onFix(normalize(p.coords, 'wgs84')),
        (e) => onError && onError(new Error(e.code === 1 ? '定位权限被拒绝，请在浏览器设置中允许' : '定位失败')),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      );
      return () => navigator.geolocation.clearWatch(id);
    }
  };
  // #endif
  // #ifdef MP-WEIXIN
  return {
    name: 'mp-location-update',
    watch(onFix, onError) {
      const handler = (r) => onFix(normalize(r, 'gcj02'));
      uni.startLocationUpdate({
        type: 'gcj02',
        success: () => uni.onLocationChange(handler),
        fail: (e) => onError && onError(new Error(/auth/.test((e && e.errMsg) || '') ? '位置权限被拒绝，请在小程序设置中允许' : '无法开始定位'))
      });
      return () => { try { uni.offLocationChange(handler); uni.stopLocationUpdate({}); } catch (e) { /* */ } };
    }
  };
  // #endif
  // #ifdef APP-PLUS
  return {
    name: 'app-plus-geolocation',
    watch(onFix, onError) {
      const id = plus.geolocation.watchPosition(
        (p) => onFix(normalize(p.coords, 'wgs84')),
        (e) => onError && onError(new Error((e && e.message) || '定位失败')),
        { enableHighAccuracy: true, provider: 'system', coordsType: 'wgs84', maximumAge: 2000 }
      );
      return () => plus.geolocation.clearWatch(id);
    }
  };
  // #endif
  // #ifdef APP-HARMONY
  return pollingProvider('wgs84');
  // #endif
  return pollingProvider('wgs84');
}

/** 发送策略：首个点立即发；之后移动 ≥5 米或距上次 ≥10 秒才发；最快 2 秒一次 */
export function createSendGate({ minIntervalMs = 2000, maxIntervalMs = 10000, minMoveM = 5 } = {}) {
  let last = null;
  const dist = (a, b) => {
    const R = 6371008.8, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  return (fix) => {
    const now = fix.ts != null ? fix.ts : Date.now();
    if (!last) { last = { ...fix, ts: now }; return true; }
    const dt = now - last.ts;
    if (dt < minIntervalMs) return false;
    if (dt >= maxIntervalMs || dist(last, fix) >= minMoveM) { last = { ...fix, ts: now }; return true; }
    return false;
  };
}
