/**
 * 午间岛 实时通道冒烟测试（由 smoke-test.js 调用）
 * 覆盖：WS 鉴权、权限矩阵（同公司 / 同集团跨公司 / 跨集团受限 / 非成员 / 屏蔽）、
 *       对讲话权（离线拒绝、busy、音频转发、无话权丢弃、松开、空闲释放、最长时长、对方断线）、
 *       位置共享（仅首次同意 + 按账号记录 + 撤回、时长校验、开始、统一 WGS-84（GCJ-02 来源反解）、节流、进入页面补发最后位置、停止、到期、断线超时）、
 *       不落盘、地图配置（OSM / PMTiles，不含任何 key）
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(base, name) {
    this.name = name;
    this.msgs = [];
    this.bins = [];
    this.waiters = [];
    this.closed = null;
    this.ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) { this.bins.push(Buffer.from(data)); this._flush(); return; }
      const m = JSON.parse(data.toString());
      this.msgs.push(m);
      this._flush();
    });
    this.ws.on('close', (code) => { this.closed = code; this._flush(); });
    this.ws.on('error', () => {});
  }
  open() { return new Promise((res, rej) => { if (this.ws.readyState === 1) return res(); this.ws.once('open', res); this.ws.once('error', rej); }); }
  json(o) { this.ws.send(JSON.stringify(o)); }
  bin(buf) { this.ws.send(buf, { binary: true }); }
  _flush() { for (const w of [...this.waiters]) w(); }
  /** 等待满足条件的消息（从 since 下标开始找），找到后返回该消息 */
  wait(pred, timeout = 3000, since = 0) {
    return new Promise((resolve) => {
      const tryFind = () => {
        const m = this.msgs.slice(since).find(pred);
        if (m) { cleanup(); resolve(m); return true; }
        return false;
      };
      const t = setTimeout(() => { cleanup(); resolve(null); }, timeout);
      const w = () => tryFind();
      const cleanup = () => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); };
      this.waiters.push(w);
      tryFind();
    });
  }
  waitBin(count, timeout = 2000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { cleanup(); resolve(this.bins.length >= count); }, timeout);
      const w = () => { if (this.bins.length >= count) { cleanup(); resolve(true); } };
      const cleanup = () => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); };
      this.waiters.push(w); w();
    });
  }
  waitClose(timeout = 2000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { cleanup(); resolve(this.closed); }, timeout);
      const w = () => { if (this.closed !== null) { cleanup(); resolve(this.closed); } };
      const cleanup = () => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); };
      this.waiters.push(w); w();
    });
  }
  mark() { return this.msgs.length; }
  close() { this.ws.close(); }
}

async function connect(base, token, name, platform = 'h5') {
  const c = new Client(base, name);
  await c.open();
  c.json({ t: 'auth', token, platform });
  const ok = await c.wait(m => m.t === 'auth.ok' || m.t === 'auth.fail');
  c.authed = ok && ok.t === 'auth.ok';
  return c;
}

function audioFrame(seq, bytes = 160) {
  const b = Buffer.alloc(4 + bytes, 0xff);
  b[0] = 1; b.writeUInt16BE(seq & 0xffff, 1); b[3] = 0;
  return b;
}

module.exports = async function realtimeTests({ BASE, call, login, check, tokens, chats, dataFile }) {
  const { alice, bob, carol } = tokens;
  const { abChat, adChat } = chats;
  const all = [];
  const conn = async (tok, name, p) => { const c = await connect(BASE, tok, name, p); all.push(c); return c; };

  console.log('== 9. 实时通道鉴权 ==');
  const anon = new Client(BASE, 'anon'); all.push(anon);
  await anon.open();
  anon.json({ t: 'ptt.start', chatId: abChat });
  check('未鉴权发信令 → 连接被关闭(4401)', (await anon.waitClose()) === 4401);
  const bad = await connect(BASE, 'not-a-token', 'bad'); all.push(bad);
  check('错误 token → auth.fail 并关闭', bad.authed === false && (await bad.waitClose()) === 4401);
  const anonBin = new Client(BASE, 'anonBin'); all.push(anonBin);
  await anonBin.open();
  anonBin.bin(audioFrame(1));
  check('未鉴权发音频 → 连接被关闭', (await anonBin.waitClose()) === 4401);

  console.log('== 10. 实时功能权限矩阵 ==');
  const A = await conn(alice, 'alice');
  check('Alice WS 鉴权成功', A.authed === true);
  A.json({ t: 'chat.join', chatId: abChat });
  const st = await A.wait(m => m.t === 'chat.state' && m.chatId === abChat);
  check('同公司会话 → 对讲可用', st && st.permissions.walkieTalkie.allowed === true, JSON.stringify(st && st.permissions));
  check('同公司会话 → 位置共享可用', st && st.permissions.locationShare.allowed === true);
  check('对方(Bob)未连接 → peerOnline=false', st && st.peerOnline === false);

  A.json({ t: 'chat.join', chatId: adChat });
  const stR = await A.wait(m => m.t === 'chat.state' && m.chatId === adChat);
  check('跨集团受限会话 → 对讲不可用(restricted)', stR && stR.permissions.walkieTalkie.allowed === false && stR.permissions.walkieTalkie.code === 'restricted', JSON.stringify(stR && stR.permissions));
  check('跨集团受限会话 → 位置共享不可用(restricted)', stR && stR.permissions.locationShare.code === 'restricted');
  let mk = A.mark();
  A.json({ t: 'ptt.start', chatId: adChat });
  const dR = await A.wait(m => m.t === 'ptt.denied' && m.chatId === adChat, 2000, mk);
  check('受限模式按住说话 → 服务端拒绝', dR && dR.code === 'restricted' && /受限模式/.test(dR.message));
  mk = A.mark();
  A.json({ t: 'loc.start', chatId: adChat, consent: true });
  const lR = await A.wait(m => m.t === 'loc.denied' && m.chatId === adChat, 2000, mk);
  check('受限模式开始位置共享 → 服务端拒绝', lR && lR.code === 'restricted');

  const C = await conn(carol, 'carol');
  mk = C.mark();
  C.json({ t: 'chat.join', chatId: abChat });
  const nm = await C.wait(m => m.t === 'error' && m.code === 'not_member', 2000, mk);
  check('非会话成员订阅 → not_member', !!nm);
  mk = C.mark();
  C.json({ t: 'ptt.start', chatId: abChat });
  const nm2 = await C.wait(m => m.t === 'ptt.denied', 2000, mk);
  check('非会话成员按住说话 → 拒绝', nm2 && nm2.code === 'not_member');

  // 同集团跨公司：Carol 完成组织认证后与 Bob（已认证）建会话
  const cv = await call('POST', '/api/cert/org/verify-location', { token: carol, body: { lat: 31.2305, lng: 121.4738 } });
  const cr = await call('POST', '/api/chats/request', { token: carol, body: { targetUserId: 'u_bob', greeting: '你好' } });
  const breqs = await call('GET', '/api/chats/requests', { token: bob });
  const bacc = await call('POST', `/api/chats/requests/${breqs.data.find(r => r.fromUserId === 'u_carol').id}/respond`, { token: bob, body: { accept: true } });
  const cbChat = bacc.data && bacc.data.chatId;
  check('同集团跨公司（双方已认证）→ 建会话', cv.code === 0 && cr.code === 0 && !!cbChat, JSON.stringify({ cv: cv.code, cr: cr.code }));
  C.json({ t: 'chat.join', chatId: cbChat });
  const stG = await C.wait(m => m.t === 'chat.state' && m.chatId === cbChat);
  check('同集团跨公司会话 → 对讲/位置共享可用', stG && stG.permissions.walkieTalkie.allowed && stG.permissions.locationShare.allowed);

  console.log('== 11. 对讲话权控制 ==');
  mk = A.mark();
  A.json({ t: 'ptt.start', chatId: abChat });
  const off = await A.wait(m => m.t === 'ptt.denied' && m.chatId === abChat, 2000, mk);
  check('对方离线 → 拒绝(peer_offline)', off && off.code === 'peer_offline');

  mk = A.mark();
  const B = await conn(bob, 'bob');
  const pres = await A.wait(m => m.t === 'presence' && m.chatId === abChat && m.online === true, 2000, mk);
  check('Bob 上线 → Alice 收到在线通知', !!pres);
  B.json({ t: 'chat.join', chatId: abChat });
  await B.wait(m => m.t === 'chat.state' && m.chatId === abChat);

  mk = A.mark(); let mkB = B.mark();
  A.json({ t: 'ptt.start', chatId: abChat });
  const g = await A.wait(m => m.t === 'ptt.granted' && m.chatId === abChat, 2000, mk);
  const ps = await B.wait(m => m.t === 'ptt.peer_start' && m.chatId === abChat, 2000, mkB);
  check('Alice 按下 → 获得话权', !!g && g.codec === 1);
  check('Bob 收到“对方正在讲话”(busy 指示)', ps && ps.from === 'u_alice' && ps.streamId === g.streamId);

  mkB = B.mark();
  B.json({ t: 'ptt.start', chatId: abChat });
  const busy = await B.wait(m => m.t === 'ptt.denied', 2000, mkB);
  check('Alice 讲话中 Bob 按下 → busy（同一时间只一人讲）', busy && busy.code === 'busy' && busy.holderId === 'u_alice');

  for (let i = 1; i <= 3; i++) A.bin(audioFrame(i));
  const gotBin = await B.waitBin(3);
  check('音频分片实时转发给对方', gotBin && B.bins.length === 3);
  check('转发帧带服务端 streamId、保留序号', B.bins[0] && B.bins[0][3] === g.streamId && B.bins[2].readUInt16BE(1) === 3);
  check('发送方不会收到自己的音频', A.bins.length === 0);

  mkB = B.mark();
  B.bin(audioFrame(9));
  const nf = await B.wait(m => m.t === 'error' && m.code === 'no_floor', 2000, mkB);
  check('无话权发音频 → 丢弃并提示', !!nf && A.bins.length === 0);

  mkB = B.mark();
  A.json({ t: 'ptt.stop', chatId: abChat });
  const pstop = await B.wait(m => m.t === 'ptt.peer_stop', 2000, mkB);
  check('Alice 松开 → Bob 收到停止(released)', pstop && pstop.reason === 'released');

  mkB = B.mark(); mk = A.mark();
  B.json({ t: 'ptt.start', chatId: abChat });
  const g2 = await B.wait(m => m.t === 'ptt.granted', 2000, mkB);
  check('话权释放后 Bob 可以讲', !!g2);
  const L = st.limits;
  const idle = await B.wait(m => m.t === 'ptt.released', L.pttIdleMs + 2000, mkB);
  check('按住但无音频超过空闲阈值 → 自动释放(idle)', idle && idle.reason === 'idle');

  if (L.pttMaxMs > 5000) {
    check('最长讲话时长 60 秒（非加速模式，跳过等待）', L.pttMaxMs === 60000);
  } else {
  mk = A.mark();
  A.json({ t: 'ptt.start', chatId: abChat });
  await A.wait(m => m.t === 'ptt.granted', 2000, mk);
  let seq = 10; const pump = setInterval(() => A.bin(audioFrame(seq++)), 150);
  const mx = await A.wait(m => m.t === 'ptt.released', 4000, mk);
  clearInterval(pump);
  check('持续讲话超过最长时长 → 自动释放(max_duration)', mx && mx.reason === 'max_duration', JSON.stringify(mx));
  }

  mk = A.mark();
  A.json({ t: 'ptt.start', chatId: abChat });
  await A.wait(m => m.t === 'ptt.granted', 2000, mk);
  B.close();
  const po = await A.wait(m => m.t === 'ptt.released', 3000, mk);
  check('讲话中对方断线 → 话权释放(peer_offline)', po && po.reason === 'peer_offline');
  const poff = await A.wait(m => m.t === 'presence' && m.online === false, 2000, mk);
  check('对方断线 → 离线通知', !!poff);

  console.log('== 12. 位置共享 ==');
  const B2 = await conn(bob, 'bob2');
  B2.json({ t: 'chat.join', chatId: abChat });
  await B2.wait(m => m.t === 'chat.state');

  // 首次使用：未确认隐私提示 → 拒绝；chat.state 告知尚未同意
  const st0 = await A.wait(m => m.t === 'chat.state' && m.chatId === abChat);
  check('首次使用前 chat.state 显示尚未同意隐私提示', st0 && st0.locationConsent && st0.locationConsent.accepted === false && !!st0.locationConsent.version);
  check('chat.state 不再下发共享时长档', st0 && st0.limits && st0.limits.durations === undefined);
  mk = A.mark();
  A.json({ t: 'loc.start', chatId: abChat });
  const nc = await A.wait(m => m.t === 'loc.denied', 2000, mk);
  check('首次使用未确认隐私提示 → 拒绝(consent_required)', nc && nc.code === 'consent_required');

  mk = A.mark(); mkB = B2.mark();
  // 旧客户端若仍带 duration 字段，服务端忽略，不因此拒绝或设到期
  A.json({ t: 'loc.start', chatId: abChat, duration: '15m', consent: true });
  const ls = await A.wait(m => m.t === 'loc.started', 2000, mk);
  const lps = await B2.wait(m => m.t === 'loc.peer_started', 2000, mkB);
  check('首次确认隐私提示后开始共享（无时长限制）', !!ls && ls.consent && ls.consent.accepted === true && !ls.expiresAt && !ls.hardCap);
  const rawC = fs.readFileSync(dataFile, 'utf-8');
  check('同意按账号记录在服务端（仅版本与时间）', /"kind": ?"location_share"/.test(rawC));
  check('共享不设到期时间（旧 duration 字段被忽略）', !!ls && ls.expiresAt == null && ls.duration == null);
  check('对方收到“开始共享”', lps && lps.from === 'u_alice');

  // 北京天安门附近 WGS-84（测试专用坐标）
  const W = { lng: 116.391234, lat: 39.906543 };
  mkB = B2.mark();
  A.json({ t: 'loc.update', chatId: abChat, lng: W.lng, lat: W.lat, accuracy: 12, coord: 'wgs84' });
  const up = await B2.wait(m => m.t === 'loc.peer_update', 2000, mkB);
  const dLng = up && up.lng - W.lng, dLat = up && up.lat - W.lat;
  check('对方实时收到位置', !!up && up.from === 'u_alice');
  check('WGS-84 原样转发（OSM 底图同为 WGS-84，无偏移）', up && up.coord === 'wgs84' && Math.abs(dLng) < 1e-6 && Math.abs(dLat) < 1e-6, JSON.stringify({ dLng, dLat }));
  A.json({ t: 'loc.update', chatId: abChat, lng: W.lng + 0.001, lat: W.lat, coord: 'wgs84' });
  await sleep(10);
  const cntBefore = B2.msgs.filter(m => m.t === 'loc.peer_update').length;
  check('过于频繁的更新被节流丢弃', cntBefore === 1);
  await sleep(L.locMinIntervalMs + 60);
  // 小程序上报 GCJ-02：服务端反解成 WGS-84 再转发（天安门 WGS-84 → GCJ-02 后应还原）
  const G = { lng: 116.397476, lat: 39.907937 }; // ≈ W 的 GCJ-02 坐标（测试专用）
  A.json({ t: 'loc.update', chatId: abChat, lng: G.lng, lat: G.lat, coord: 'gcj02' });
  const up2 = await B2.wait(m => m.t === 'loc.peer_update' && m.lng !== W.lng, 2000, mkB);
  check('GCJ-02 来源（小程序）反解为 WGS-84 转发', !!up2 && up2.coord === 'wgs84' && Math.abs(up2.lng - W.lng) < 0.0002 && Math.abs(up2.lat - W.lat) < 0.0002, JSON.stringify(up2 && [up2.lng, up2.lat]));
  const LAST = up2 ? up2.lng : null;

  // Carol 看不到 Alice 与 Bob 的位置
  check('第三方(Carol)收不到位置', !C.msgs.some(m => m.t && m.t.startsWith('loc.peer')));

  // Bob 新设备进入地图页 → 补发最后位置（仅内存中的当前会话）
  const B3 = await conn(bob, 'bob3');
  B3.json({ t: 'chat.join', chatId: abChat });
  const st3 = await B3.wait(m => m.t === 'chat.state');
  check('对方进入页面时可看到最新位置', st3 && st3.peerShare && st3.peerShare.last && st3.peerShare.last.lng === LAST);

  // 共享期间仍可对讲（地图页按住说话）
  mk = A.mark(); mkB = B2.mark();
  A.json({ t: 'ptt.start', chatId: abChat });
  const g3 = await A.wait(m => m.t === 'ptt.granted', 2000, mk);
  A.bin(audioFrame(1));
  const before = B2.bins.length;
  const gotDuring = await B2.waitBin(before + 1);
  A.json({ t: 'ptt.stop', chatId: abChat });
  check('位置共享进行中可同时对讲', !!g3 && gotDuring);

  // 文件中不能出现任何位置坐标
  const raw = fs.readFileSync(dataFile, 'utf-8');
  const leaks = ['116.391', '39.906', '116.397', '39.907', '"lastLoc', '"locations'].filter(x => raw.includes(x));
  check('共享位置不写入数据库（无坐标落盘）', leaks.length === 0, JSON.stringify(leaks));
  check('会话内留有“开始共享”系统提示（无坐标）', /开始共享实时位置/.test(raw));

  mk = A.mark(); mkB = B2.mark();
  A.json({ t: 'loc.stop', chatId: abChat });
  const lst = await A.wait(m => m.t === 'loc.stopped', 2000, mk);
  const lpst = await B2.wait(m => m.t === 'loc.peer_stopped', 2000, mkB);
  check('一键停止 → 立即结束', lst && lst.reason === 'user' && lpst && lpst.reason === 'user');
  mk = A.mark();
  A.json({ t: 'loc.update', chatId: abChat, lng: 116.4, lat: 39.9, coord: 'gcj02' });
  const ns = await A.wait(m => m.t === 'error' && m.code === 'not_sharing', 2000, mk);
  check('停止后位置更新被拒绝', !!ns);
  B3.json({ t: 'chat.join', chatId: abChat });
  const st4 = await B3.wait(m => m.t === 'chat.state', 2000, B3.mark() - 1);
  const st4b = B3.msgs.filter(m => m.t === 'chat.state').slice(-1)[0];
  check('停止后最后位置从内存删除', st4b && st4b.peerShare === null);

  // 无时长限制：等待超过原先 15 分钟加速窗口后仍在共享；第二次使用不再需要确认隐私提示
  mk = A.mark(); mkB = B2.mark();
  A.json({ t: 'loc.start', chatId: abChat });
  const ls15 = await A.wait(m => m.t === 'loc.started', 2000, mk);
  check('已同意过 → 再次开始共享无需再确认（不再弹隐私提示）', !!ls15 && ls15.expiresAt == null);
  await sleep(Math.max(2000, (L.locDisconnectGraceMs || 100) + 200)); // 超过原 15 分钟加速窗口（约 1.8 秒）
  check('等待后仍在共享（不会到期自动结束）', !A.msgs.slice(mk).some(m => m.t === 'loc.stopped') && !B2.msgs.slice(mkB).some(m => m.t === 'loc.peer_stopped' && m.reason === 'expired'));

  // 共享者断线超时 → 结束（与时长无关的 60 秒宽限）
  mk = A.mark(); mkB = B2.mark();
  A.json({ t: 'loc.start', chatId: abChat });
  await A.wait(m => m.t === 'loc.started', 2000, mk);
  A.close();
  const dc = await B2.wait(m => m.t === 'loc.peer_stopped', L.locDisconnectGraceMs + 3000, mkB);
  check('共享者断线超过宽限期 → 自动结束(disconnected)', dc && dc.reason === 'disconnected', JSON.stringify(dc));

  // 撤回同意（我的 → 隐私设置）：立即结束进行中的共享，下次重新弹出隐私提示
  const A2 = await conn(alice, 'alice2');
  A2.json({ t: 'chat.join', chatId: abChat });
  await A2.wait(m => m.t === 'chat.state');
  mk = A2.mark(); mkB = B2.mark();
  A2.json({ t: 'loc.start', chatId: abChat });
  check('新设备同一账号无需再次同意（同意跟随账号）', !!(await A2.wait(m => m.t === 'loc.started', 2000, mk)));
  const pv = await call('GET', '/api/account/privacy/location', { token: alice });
  check('隐私设置可查看同意状态与时间', pv.data && pv.data.accepted === true && !!pv.data.acceptedAt);
  const wd = await call('POST', '/api/account/privacy/location/withdraw', { token: alice });
  const wdStop = await B2.wait(m => m.t === 'loc.peer_stopped', 2000, mkB);
  check('撤回同意 → 进行中的共享立即结束', wd.code === 0 && wd.data.accepted === false && !!wdStop);
  mk = A2.mark();
  A2.json({ t: 'loc.start', chatId: abChat });
  const again = await A2.wait(m => m.t === 'loc.denied', 2000, mk);
  check('撤回后再次使用 → 重新需要确认隐私提示', again && again.code === 'consent_required');
  const exp = await call('GET', '/api/account/export', { token: alice });
  check('数据导出包含同意记录、不含位置', Array.isArray(exp.data.privacyConsents) && exp.data.privacyConsents.length >= 1 && !JSON.stringify(exp.data).includes('116.39'));

  // 屏蔽 → 立即结束共享并禁用对讲
  mk = C.mark();
  C.json({ t: 'loc.start', chatId: cbChat, consent: true });
  await C.wait(m => m.t === 'loc.started', 2000, mk);
  await call('POST', `/api/chats/${cbChat}/block`, { token: bob });
  const bl = await C.wait(m => m.t === 'loc.stopped', 2000, mk);
  check('被屏蔽 → 位置共享立即结束', bl && bl.reason === 'permission');
  mk = C.mark();
  C.json({ t: 'ptt.start', chatId: cbChat });
  const blp = await C.wait(m => m.t === 'ptt.denied', 2000, mk);
  check('被屏蔽 → 对讲被拒绝(blocked)', blp && blp.code === 'blocked');

  console.log('== 13. 地图配置（OpenStreetMap 数据，无 key） ==');
  check('地图配置需登录', (await fetch(BASE + '/api/map/config')).status === 401);
  const cfg = await fetch(BASE + '/api/map/config', { headers: { Authorization: `Bearer ${alice}` } });
  const cfgText = await cfg.text();
  const cfgJson = JSON.parse(cfgText);
  check('底图为 OSM 来源（PMTiles 或 MapLibre 样式），坐标 WGS-84', ['pmtiles', 'style'].includes(cfgJson.data.source) && cfgJson.data.coord === 'wgs84');
  check('配置带 OpenStreetMap 署名', /OpenStreetMap/.test(cfgJson.data.attribution || ''));
  check('配置不含高德 / 任何 key', !/amap|key|jscode/i.test(cfgText.replace(/"source"/, '')), cfgText.slice(0, 120));
  check('高德安全密钥代理已移除', (await fetch(BASE + '/_AMapService/v3/log/init')).status === 404);
  if (cfgJson.data.source === 'pmtiles' && cfgJson.data.pmtilesUrl.startsWith('/tiles/')) {
    const r = await fetch(BASE + cfgJson.data.pmtilesUrl, { headers: { Range: 'bytes=0-126' } });
    const b = Buffer.from(await r.arrayBuffer());
    check('自带 PMTiles 支持 Range 请求（206 + PMTiles v3 头）', r.status === 206 && b.slice(0, 7).toString() === 'PMTiles' && b[7] === 3);
    const g = await fetch(BASE + '/tiles/fonts/Noto%20Sans%20Regular/0-255.pbf');
    check('字形 PBF 由本服务提供', g.status === 200);
  }
  const pre = await fetch(BASE + '/tiles/x.pmtiles', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } });
  check('/tiles 允许 App WebView 跨域 Range 预检', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /range/i.test(pre.headers.get('access-control-allow-headers') || ''));
  check('/tiles 不允许路径穿越', (await fetch(BASE + '/tiles/..%2F..%2Fsrc%2Findex.js')).status >= 400);

  return { closeAll: () => all.forEach(c => { try { c.close(); } catch { /* */ } }), connect: (t, n) => conn(t, n) };
};
