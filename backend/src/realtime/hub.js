/**
 * 午间岛 - 实时通道（WebSocket）：按住说话对讲机 + 实时位置共享
 *
 * 设计说明见 docs/对讲与位置共享设计.md。要点：
 * - 单一 WebSocket 连接（/ws），首条消息鉴权（不把 token 放 URL，避免进访问日志）
 * - 文本帧 = JSON 信令；二进制帧 = 音频分片（服务端只转发，不落盘、不解码）
 * - 对讲：每个会话一个“话权”（floor），同一时刻只有一人可讲；
 *   对方离线拒绝、对方在讲返回 busy；超时 / 无音频 / 断线自动释放
 * - 位置：统一 WGS-84 转发（V1.2 起底图为 OpenStreetMap）；隐私提示仅首次同意（services/consent.js）；仅转发给会话对方；服务端只在内存保留“最后一个点”供对方进入页面时显示，
 *   会话结束（手动停止 / 退出共享页 / 断线超时 / 权限失效 / 撤回同意）立即删除，不写数据库；共享没有时间限制
 * - 心跳：服务端 ping/pong（参考 websockets/ws README “How to detect and close broken connections”）
 *
 * 音频二进制帧格式（4 字节头 + 负载）：
 *   byte0 codec（1 = G.711 μ-law 8kHz 单声道）
 *   byte1-2 序号 uint16 BE（客户端递增，用于丢包/乱序检测）
 *   byte3 streamId（客户端发 0；服务端改写为本次话权的 streamId 再转发）
 */
const { WebSocketServer } = require('ws');
const { load, save, id } = require('../db');
const { getUser } = require('../services/permissions');
const { canUseRealtime, findChat } = require('../services/realtime-permissions');
const { toWgs84 } = require('../services/geo');
const { getLocationConsent, acceptLocationConsent } = require('../services/consent');
const { normalizePlatform } = require('../services/flags');

// 时间参数。测试可用环境变量缩短：RT_LOC_TIME_SCALE（位置相关计时倍率）、RT_PTT_MAX_MS、RT_PTT_IDLE_MS。生产不要设置。
const SCALE = Math.max(0.0001, Number(process.env.RT_LOC_TIME_SCALE || 1));
const T = (ms) => Math.max(20, Math.round(ms * SCALE));
const envMs = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const CFG = {
  authTimeoutMs: 5000,
  heartbeatMs: 25000,
  pttMaxMs: envMs('RT_PTT_MAX_MS', 60000),   // 单次按住最长 60 秒，自动松开（防止卡键占用话权）
  pttIdleMs: envMs('RT_PTT_IDLE_MS', 3000),  // 3 秒没收到音频分片 → 视为松开（网络中断 / 客户端崩溃）
  locMinIntervalMs: T(1000),   // 位置更新最快 1 次/秒，超出直接丢弃
  locDisconnectGraceMs: T(60000), // 共享者断线 60 秒内重连则继续，否则结束共享
  maxAudioFrameBytes: 4096,
  peerHighWaterBytes: 64 * 1024 // 对方发送缓冲超过 64KB → 丢弃音频分片（实时语音宁丢不堆）
};
const CODECS = { 1: 'mulaw8k' };

function nowIso() { return new Date().toISOString(); }

function sysMessage(chatId, content) {
  const db = load();
  db.messages.push({ id: id('msg'), chatId, fromUserId: 'system', type: 'system', content, createdAt: nowIso() });
  save();
}

function createHub() {
  const sockets = new Map();   // userId -> Set<ws>
  const floors = new Map();    // chatId -> { holderId, ws, streamId, startedAt, lastFrameAt, maxTimer, idleTimer }
  const shares = new Map();    // `${chatId}:${userId}` -> { chatId, userId, startedAt, last, lastAt, graceTimer }
  let streamSeq = 0;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, clientTracking: true });

  /* ---------------- 工具 ---------------- */
  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function sendToUser(userId, obj) {
    const set = sockets.get(userId);
    if (set) for (const ws of set) send(ws, obj);
  }
  function isOnline(userId) {
    const set = sockets.get(userId);
    return !!set && set.size > 0;
  }
  function peerOf(chatId, userId) {
    const chat = findChat(chatId, userId);
    return chat ? chat.memberIds.find(m => m !== userId) : null;
  }
  function chatsOf(userId) {
    return load().chats.filter(c => c.memberIds.includes(userId));
  }
  function err(ws, code, message, extra = {}) {
    send(ws, { t: 'error', code, message, ...extra });
  }

  /* ---------------- 对讲：话权控制 ---------------- */
  function floorState(chatId) {
    const f = floors.get(chatId);
    return f ? { holderId: f.holderId, streamId: f.streamId, since: f.startedAt } : null;
  }

  function releaseFloor(chatId, reason) {
    const f = floors.get(chatId);
    if (!f) return;
    clearTimeout(f.maxTimer); clearTimeout(f.idleTimer);
    floors.delete(chatId);
    const peerId = peerOf(chatId, f.holderId);
    sendToUser(f.holderId, { t: 'ptt.released', chatId, reason });
    if (peerId) sendToUser(peerId, { t: 'ptt.peer_stop', chatId, from: f.holderId, streamId: f.streamId, reason });
  }

  function armIdle(chatId) {
    const f = floors.get(chatId);
    if (!f) return;
    clearTimeout(f.idleTimer);
    f.idleTimer = setTimeout(() => releaseFloor(chatId, 'idle'), CFG.pttIdleMs);
  }

  function onPttStart(ws, msg) {
    const { chatId } = msg;
    const perm = canUseRealtime(chatId, ws.userId, 'walkieTalkie', ws.platform);
    if (!perm.allowed) return send(ws, { t: 'ptt.denied', chatId, code: perm.code, message: perm.reason });
    const peerId = perm.peerId;
    if (!isOnline(peerId)) return send(ws, { t: 'ptt.denied', chatId, code: 'peer_offline', message: '对方不在线，暂时无法对讲' });
    const cur = floors.get(chatId);
    if (cur && cur.holderId !== ws.userId) {
      return send(ws, { t: 'ptt.denied', chatId, code: 'busy', message: '对方正在讲话，请稍候', holderId: cur.holderId });
    }
    if (cur && cur.holderId === ws.userId) {
      cur.ws = ws; // 同一用户换设备/重复按下：沿用话权
      armIdle(chatId);
      return send(ws, { t: 'ptt.granted', chatId, streamId: cur.streamId, maxMs: CFG.pttMaxMs, codec: 1 });
    }
    // 同一用户同时只能在一个会话里讲话
    for (const [cid, f] of floors) if (f.holderId === ws.userId) releaseFloor(cid, 'switched');
    streamSeq = (streamSeq % 255) + 1;
    const f = { holderId: ws.userId, ws, streamId: streamSeq, startedAt: Date.now(), lastFrameAt: 0, frames: 0 };
    floors.set(chatId, f);
    f.maxTimer = setTimeout(() => releaseFloor(chatId, 'max_duration'), CFG.pttMaxMs);
    armIdle(chatId);
    send(ws, { t: 'ptt.granted', chatId, streamId: f.streamId, maxMs: CFG.pttMaxMs, codec: 1 });
    sendToUser(peerId, { t: 'ptt.peer_start', chatId, from: ws.userId, streamId: f.streamId, codec: 1 });
  }

  function onPttStop(ws, msg) {
    const f = floors.get(msg.chatId);
    if (f && f.holderId === ws.userId) releaseFloor(msg.chatId, 'released');
  }

  function onAudio(ws, buf) {
    // 找到该连接持有话权的会话
    let chatId = null, f = null;
    for (const [cid, fl] of floors) if (fl.ws === ws) { chatId = cid; f = fl; break; }
    if (!f) {
      if (!ws.warnedNoFloor) { ws.warnedNoFloor = true; err(ws, 'no_floor', '未持有话权，音频已丢弃'); }
      return;
    }
    if (buf.length < 5 || buf.length > CFG.maxAudioFrameBytes || !CODECS[buf[0]]) return err(ws, 'bad_frame', '音频分片格式不正确');
    f.lastFrameAt = Date.now(); f.frames++;
    armIdle(chatId);
    const out = Buffer.from(buf); // 复制后改写 streamId
    out[3] = f.streamId;
    const peerId = peerOf(chatId, ws.userId);
    const set = peerId && sockets.get(peerId);
    if (!set || set.size === 0) return releaseFloor(chatId, 'peer_offline');
    for (const p of set) {
      if (p.readyState !== 1) continue;
      if (p.bufferedAmount > CFG.peerHighWaterBytes) { p.droppedFrames = (p.droppedFrames || 0) + 1; continue; }
      p.send(out, { binary: true });
    }
  }

  /* ---------------- 位置共享 ---------------- */
  const key = (chatId, userId) => `${chatId}:${userId}`;

  function shareView(s, withLast = true) {
    return {
      chatId: s.chatId, userId: s.userId,
      startedAt: new Date(s.startedAt).toISOString(),
      last: withLast ? s.last : undefined
    };
  }

  function stopShare(chatId, userId, reason) {
    const k = key(chatId, userId);
    const s = shares.get(k);
    if (!s) return false;
    clearTimeout(s.graceTimer);
    shares.delete(k); // 最后位置随会话一并删除（不留历史）
    const peerId = peerOf(chatId, userId);
    sendToUser(userId, { t: 'loc.stopped', chatId, reason });
    if (peerId) sendToUser(peerId, { t: 'loc.peer_stopped', chatId, from: userId, reason });
    const u = getUser(userId);
    const why = { user: '', disconnected: '（连接中断）', permission: '（权限变化）', logout: '' }[reason] ?? '';
    if (findChat(chatId, userId)) sysMessage(chatId, `${u ? u.displayName : '对方'} 已结束共享实时位置${why}`);
    return true;
  }

  function onLocStart(ws, msg) {
    const { chatId, consent } = msg;
    const perm = canUseRealtime(chatId, ws.userId, 'locationShare', ws.platform);
    if (!perm.allowed) return send(ws, { t: 'loc.denied', chatId, code: perm.code, message: perm.reason });
    // 隐私提示只在第一次使用时出现：带 consent:true（用户在首次提示上点了确认）即记录同意；之后无需再带
    // V1.2 追加：共享没有时间限制，一直持续到停止 / 退出共享页 / 断线超时；客户端若仍带 duration 字段会被忽略
    let consentState = getLocationConsent(ws.userId);
    if (!consentState.accepted) {
      if (consent !== true) {
        return send(ws, { t: 'loc.denied', chatId, code: 'consent_required', message: '首次使用位置共享需要先阅读并确认隐私提示', consent: consentState });
      }
      consentState = acceptLocationConsent(ws.userId, ws.platform);
    }
    const k = key(chatId, ws.userId);
    const existing = shares.get(k);
    if (existing) { clearTimeout(existing.graceTimer); }
    const now = Date.now();
    const s = {
      chatId, userId: ws.userId, startedAt: now,
      last: existing ? existing.last : null, lastAt: 0
    };
    shares.set(k, s);
    send(ws, { t: 'loc.started', ...shareView(s, false), consent: consentState });
    sendToUser(perm.peerId, { t: 'loc.peer_started', ...shareView(s), from: ws.userId });
    if (!existing) {
      sysMessage(chatId, `${getUser(ws.userId).displayName} 开始共享实时位置`);
    }
  }

  function onLocUpdate(ws, msg) {
    const { chatId } = msg;
    const s = shares.get(key(chatId, ws.userId));
    if (!s) return err(ws, 'not_sharing', '当前未在共享位置', { chatId });
    const perm = canUseRealtime(chatId, ws.userId, 'locationShare', ws.platform);
    if (!perm.allowed) return stopShare(chatId, ws.userId, 'permission');
    const now = Date.now();
    if (now - s.lastAt < CFG.locMinIntervalMs) return; // 节流：静默丢弃
    const lng = Number(msg.lng), lat = Number(msg.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      return err(ws, 'bad_location', '坐标不正确', { chatId });
    }
    const coord = msg.coord === 'gcj02' ? 'gcj02' : 'wgs84';
    const [wLng, wLat] = toWgs84(lng, lat, coord);
    const num = (v, max) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Math.round(Number(v) * 10) / 10 : null);
    s.lastAt = now;
    s.last = {
      lng: Math.round(wLng * 1e6) / 1e6, lat: Math.round(wLat * 1e6) / 1e6, coord: 'wgs84',
      accuracy: num(msg.accuracy, 100000), heading: num(msg.heading, 360), speed: num(msg.speed, 1000),
      ts: new Date(now).toISOString()
    };
    sendToUser(perm.peerId, { t: 'loc.peer_update', chatId, from: ws.userId, ...s.last });
    send(ws, { t: 'loc.ack', chatId, ts: s.last.ts });
  }

  function onLocStop(ws, msg) {
    stopShare(msg.chatId, ws.userId, 'user');
  }

  /* ---------------- 会话订阅 / 状态 ---------------- */
  function chatState(chatId, userId, platform) {
    const peerId = peerOf(chatId, userId);
    const walkie = canUseRealtime(chatId, userId, 'walkieTalkie', platform);
    const location = canUseRealtime(chatId, userId, 'locationShare', platform);
    const mine = shares.get(key(chatId, userId));
    const peers = peerId && shares.get(key(chatId, peerId));
    return {
      t: 'chat.state', chatId, peerId, peerOnline: !!peerId && isOnline(peerId),
      floor: floorState(chatId),
      myShare: mine ? shareView(mine, false) : null,
      peerShare: peers ? shareView(peers) : null,
      locationConsent: getLocationConsent(userId),
      permissions: {
        walkieTalkie: { allowed: walkie.allowed, code: walkie.code || null, reason: walkie.reason || null },
        locationShare: { allowed: location.allowed, code: location.code || null, reason: location.reason || null }
      },
      limits: { pttMaxMs: CFG.pttMaxMs, pttIdleMs: CFG.pttIdleMs, locMinIntervalMs: CFG.locMinIntervalMs, locDisconnectGraceMs: CFG.locDisconnectGraceMs }
    };
  }

  function onJoin(ws, msg) {
    if (!findChat(msg.chatId, ws.userId)) return err(ws, 'not_member', '会话不存在', { chatId: msg.chatId });
    ws.chats.add(msg.chatId);
    send(ws, chatState(msg.chatId, ws.userId, ws.platform));
  }

  function notifyPresence(userId, online) {
    for (const c of chatsOf(userId)) {
      const peerId = c.memberIds.find(m => m !== userId);
      if (peerId) sendToUser(peerId, { t: 'presence', chatId: c.id, userId, online });
    }
  }

  /* ---------------- 连接生命周期 ---------------- */
  function authenticate(ws, msg) {
    const db = load();
    const rec = msg && typeof msg.token === 'string' && db.tokens.find(t => t.token === msg.token);
    const user = rec && getUser(rec.userId);
    if (!user) { send(ws, { t: 'auth.fail', message: '登录已失效' }); return ws.close(4401, 'unauthorized'); }
    clearTimeout(ws.authTimer);
    ws.userId = user.id;
    ws.token = msg.token;
    ws.platform = normalizePlatform(msg.platform) || msg.platform || null;
    const wasOnline = isOnline(user.id);
    if (!sockets.has(user.id)) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    // 共享者重连：取消断线结束计时
    for (const s of shares.values()) if (s.userId === user.id && s.graceTimer) { clearTimeout(s.graceTimer); s.graceTimer = null; }
    send(ws, { t: 'auth.ok', userId: user.id, heartbeatMs: CFG.heartbeatMs });
    if (!wasOnline) notifyPresence(user.id, true);
  }

  function onClose(ws) {
    clearTimeout(ws.authTimer);
    if (!ws.userId) return;
    const set = sockets.get(ws.userId);
    if (set) { set.delete(ws); if (set.size === 0) sockets.delete(ws.userId); }
    // 话权：讲话的连接断开 → 释放
    for (const [cid, f] of floors) if (f.ws === ws) releaseFloor(cid, 'disconnected');
    if (!isOnline(ws.userId)) {
      // 对方离线 → 对方正在对我讲话的话权也释放
      for (const [cid, f] of floors) {
        if (peerOf(cid, f.holderId) === ws.userId) releaseFloor(cid, 'peer_offline');
      }
      for (const s of shares.values()) {
        if (s.userId === ws.userId && !s.graceTimer) {
          s.graceTimer = setTimeout(() => stopShare(s.chatId, s.userId, 'disconnected'), CFG.locDisconnectGraceMs);
        }
      }
      notifyPresence(ws.userId, false);
    }
  }

  const handlers = {
    'chat.join': onJoin,
    'chat.leave': (ws, m) => ws.chats.delete(m.chatId),
    'ptt.start': onPttStart,
    'ptt.stop': onPttStop,
    'loc.start': onLocStart,
    'loc.update': onLocUpdate,
    'loc.stop': onLocStop,
    ping: (ws) => send(ws, { t: 'pong', ts: Date.now() })
  };

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.chats = new Set();
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.authTimer = setTimeout(() => { if (!ws.userId) ws.close(4401, 'auth timeout'); }, CFG.authTimeoutMs);
    ws.on('message', (data, isBinary) => {
      ws.isAlive = true;
      if (isBinary) {
        if (!ws.userId) return ws.close(4401, 'unauthorized');
        return onAudio(ws, Buffer.isBuffer(data) ? data : Buffer.concat(data));
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return err(ws, 'bad_json', '消息格式不正确'); }
      if (!msg || typeof msg.t !== 'string') return err(ws, 'bad_message', '消息格式不正确');
      if (!ws.userId) return msg.t === 'auth' ? authenticate(ws, msg) : ws.close(4401, 'unauthorized');
      // 每条信令前确认账号/登录态仍有效（注销、退出登录即时生效）
      if (!getUser(ws.userId) || !load().tokens.find(t => t.token === ws.token)) return ws.close(4401, 'session ended');
      const h = handlers[msg.t];
      if (!h) return err(ws, 'unknown_type', `未知消息类型 ${msg.t}`);
      if (msg.t !== 'ping' && msg.t !== 'chat.leave' && typeof msg.chatId !== 'string') return err(ws, 'bad_message', '缺少 chatId');
      try { h(ws, msg); } catch (e) { console.error('[realtime]', e.message); err(ws, 'server_error', '服务器内部错误'); }
    });
    ws.on('close', () => onClose(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, CFG.heartbeatMs);
  heartbeat.unref();

  /** 挂到 http.Server 的 upgrade 事件（路径 /ws） */
  function attach(server, path = '/ws') {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== path) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  }

  /** 供 HTTP 路由调用：屏蔽 / 注销 / 退出登录后立即结束实时会话 */
  function revokeUser(userId, reason = 'permission') {
    for (const s of [...shares.values()]) if (s.userId === userId) stopShare(s.chatId, s.userId, reason);
    for (const [cid, f] of floors) if (f.holderId === userId) releaseFloor(cid, reason);
    const set = sockets.get(userId);
    if (set) for (const ws of set) ws.close(4401, 'revoked');
  }
  function stopUserShares(userId, reason = 'permission') {
    for (const s of [...shares.values()]) if (s.userId === userId) stopShare(s.chatId, s.userId, reason);
  }
  function revokeChat(chatId) {
    for (const s of [...shares.values()]) if (s.chatId === chatId) stopShare(s.chatId, s.userId, 'permission');
    if (floors.has(chatId)) releaseFloor(chatId, 'permission');
  }

  function close() {
    clearInterval(heartbeat);
    for (const s of shares.values()) { clearTimeout(s.graceTimer); }
    for (const f of floors.values()) { clearTimeout(f.maxTimer); clearTimeout(f.idleTimer); }
    wss.close();
  }

  return { attach, revokeUser, revokeChat, stopUserShares, close, CFG, _debug: { shares, floors, sockets } };
}

module.exports = { createHub };
