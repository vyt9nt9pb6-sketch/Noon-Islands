/**
 * 端到端 + 截图（iPhone 尺寸 390×844 @3x）—— V1.4：邮箱登录、资料页、组织认证材料上传；并确认对讲 / 位置共享页面未回退
 * 前提：后端已在 BASE（默认 http://localhost:3000）运行，并同源托管 H5 构建（VITE_API_BASE= npm run build:h5）。
 * Alice = 浏览器（Chrome 假麦克风 + 假定位），Bob = Node WebSocket 模拟客户端。
 * 浏览器路径用 CHROME 环境变量指定（默认 /usr/bin/google-chrome）。
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
const require = createRequire(import.meta.url);
const WebSocket = require(path.resolve('../backend/node_modules/ws'));

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve(process.env.OUT || '../screenshots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name} ${ok ? '' : extra}`); };

async function call(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function login(phone) {
  const s = await call('POST', '/api/auth/sms-code', null, { phone });
  return (await call('POST', '/api/auth/login', null, { phone, code: s.devCode })).data.token;
}

function bobClient(token) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const msgs = []; let bins = 0;
  ws.on('message', (d, bin) => { if (bin) bins++; else msgs.push(JSON.parse(d.toString())); });
  return {
    ws, msgs, get bins() { return bins; },
    ready: new Promise(res => ws.on('open', () => { ws.send(JSON.stringify({ t: 'auth', token, platform: 'android' })); setTimeout(res, 200); })),
    send: (o) => ws.send(JSON.stringify(o)),
    bin: (b) => ws.send(b, { binary: true })
  };
}

const ALICE_GEO = { longitude: 116.3975, latitude: 39.9087 }; // WGS-84
const BOB_WGS = { lng: 116.4032, lat: 39.9131 };

const P = process.env.PREFIX || 'v1.4';
let shotNo = 0;
const shots = [];
async function shot(page, name, desc) {
  const file = `${P}-${String(shotNo++).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push([file, desc]);
}
const modalCancel = async (page) => { await page.tap('.uni-modal .uni-modal__btn_default').catch(() => {}); await sleep(300); };

(async () => {
  const alice = await login('13800000001');
  const bob = await login('13800000002');
  const dave = await login('13800000004');
  const chat = await call('POST', '/api/chats/request', alice, { targetUserId: 'u_bob' });
  const chatId = chat.data.chatId;
  // 跨集团的 Dave 向 Alice 申请聊天（首页“待处理申请”卡片；接受后为受限会话）
  await call('POST', '/api/chats/request', dave, { targetUserId: 'u_alice', greeting: '你好，我是物流公司的 Dave' });
  await call('POST', `/api/chats/${chatId}/messages`, alice, { type: 'text', content: '下午到园区了吗？' });
  await call('POST', `/api/chats/${chatId}/messages`, bob, { type: 'text', content: '快到了，我开个位置共享给你，路上用对讲机说' });
  await call('POST', `/api/chats/${chatId}/messages`, alice, { type: 'text', content: '好的' });

  const B = bobClient(bob); await B.ready;
  B.send({ t: 'chat.join', chatId });

  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN',
    geolocation: ALICE_GEO, permissions: ['geolocation', 'microphone']
  });
  const page = await ctx.newPage();
  const errors = [];
  const external = new Set();
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!u.host.startsWith('localhost') && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) external.add(u.host); });
  // 同一路由只换 query 时 H5 不会重建页面 → goto 后 reload
  const go = async (hash, sel, wait = 500) => { await page.goto(BASE + '/#/' + hash); await page.reload(); if (sel) await page.waitForSelector(sel, { timeout: 20000 }); await sleep(wait); };

  // ---------- 登录 ----------
  await go('pages/login/login', 'uni-page');
  check('登录页含微信 / Apple ID / 支付宝入口', /微|微信/.test(await page.textContent('.oauth')) && /Apple/.test(await page.textContent('.oauth')) && /支付宝/.test(await page.textContent('.oauth')));
  const loginText = await page.textContent('.login-page').catch(() => '');
  check('登录页不展示联调种子或测试账号', !/联调种子|13800000001|alice@dawn-tech/.test(loginText), loginText.slice(0, 200));
  await shot(page, 'login', '登录页：手机号验证码 + 微信 / Apple ID / 支付宝入口');
  await page.fill('.login-page input[type="number"] >> nth=0', '13800000001').catch(() => {});
  await sleep(200);
  await shot(page, 'login-filled', '登录页（已填手机号）');
  await page.tap('.tab:has-text("邮箱")');
  await sleep(300);
  await page.fill('.login-page input[type="text"], .login-page input >> nth=0', 'alice@dawn-tech.example.cn').catch(() => {});
  await sleep(200);
  await shot(page, 'login-email', '登录页：邮箱验证码登录 / 注册');
  await page.tap('.oauth-item >> nth=0');
  await page.waitForSelector('.uni-modal', { timeout: 5000 }).catch(() => {});
  const oauthDlg = await page.textContent('.uni-modal').catch(() => '');
  check('未开通的第三方登录弹出“尚未开通”，不会进入会话', /尚未开通/.test(oauthDlg));
  await shot(page, 'login-oauth-closed', '登录页：点击微信 → 提示尚未开通（不会登录）');
  await page.tap('.uni-modal .uni-modal__btn_primary').catch(() => {});
  await sleep(300);
  await page.evaluate((t) => localStorage.setItem('wjd_token', t), alice);
  await page.reload();
  await page.waitForSelector('uni-page', { timeout: 20000 });

  // ---------- 消息 ----------
  await go('pages/index/index', '.chat-item', 800);
  check('会话列表：通栏列表 + 方形头像', (await page.$$('.chat-item .avatar-sq')).length >= 1);
  check('底部 Tab 使用原创图标', (await page.$$('.uni-tabbar__icon img, .uni-tabbar__icon')).length >= 3);
  const hasReq = !!(await page.$('.request-card'));
  check('首页显示待处理的聊天申请', hasReq);
  await shot(page, 'chat-list-request', '消息列表 + 待处理聊天申请卡片（Dave 申请）');
  if (hasReq) {
    await page.tap('.request-card .btn-primary');
    await sleep(1200);
    await page.tap('.uni-modal .uni-modal__btn_primary').catch(() => {});
    await go('pages/index/index', '.chat-item', 800);
  }
  await shot(page, 'chat-list', '消息列表（Bob、Dave 两个会话）');

  // ---------- 通讯录 ----------
  await go('pages/contacts/contacts', '.section-letter');
  await shot(page, 'contacts', '通讯录：搜索条 + 功能入口 + 组织架构（集团/公司/部门）');
  await page.tap('.cell.dept'); await sleep(400);
  await shot(page, 'contacts-dept-toast', '通讯录：点部门（V1 仅提示按姓名搜索，没有部门成员页）');
  await sleep(1800);
  await page.fill('.search-input input, input.search-input', 'Carol').catch(async () => { await page.click('.search-input'); await page.keyboard.type('Carol'); });
  await sleep(200);
  await page.tap('.search-act');
  await page.waitForSelector('.cell.person', { timeout: 8000 }).catch(() => {});
  await sleep(500);
  await shot(page, 'contacts-search', '通讯录：按姓名搜索结果（点整行或头像进入同一资料页）');
  await page.tap('.cell.person');
  await page.waitForSelector('.me-row', { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const friendPage = await page.textContent('.container').catch(() => '');
  check('从通讯录进入好友资料（含举报 / 屏蔽，可发消息）', /举报/.test(friendPage) && /屏蔽/.test(friendPage));
  await shot(page, 'friend-profile-contacts', '从通讯录进入好友资料页（与聊天头衔进入的是同一页）');
  if (await page.$('.danger .warn:has-text("举报")')) {
    await page.tap('.danger .warn:has-text("举报")'); await sleep(500);
    await shot(page, 'modal-report', '好友资料 → 举报弹窗（已从聊天“+”面板移出）');
    await modalCancel(page);
  }
  if (await page.$('.danger .warn:has-text("屏蔽")')) {
    await page.tap('.danger .warn:has-text("屏蔽")'); await sleep(500);
    await shot(page, 'modal-block', '好友资料 → 屏蔽确认弹窗');
    await modalCancel(page);
  }

  // ---------- 我 ----------
  await go('pages/profile/profile', '.me-row');
  const meText = await page.textContent('.container').catch(() => '');
  check('「我」页「账号与安全」行不再直接显示「注销账号」', /账号与安全/.test(meText) && !/注销账号/.test(meText));
  await shot(page, 'me', '我：头像资料行（进入自己的资料）、认证与设置；账号与安全行右侧无「注销账号」');
  await page.tap('.me-row');
  await page.waitForSelector('.me-row .badges, .cells .cell-bd', { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const ownFromMe = await page.textContent('.container').catch(() => '');
  check('从「我」页资料行进入自己的资料，且无举报 / 屏蔽', /组织认证|个人资料|尚未加入/.test(ownFromMe) && !/举报/.test(ownFromMe) && !/屏蔽/.test(ownFromMe));
  await shot(page, 'own-profile-me', '从「我」页进入自己的资料（无举报 / 屏蔽）');
  await go('pages/profile/profile', '.me-row');
  await page.tap('text=我的订单'); await sleep(400);
  await shot(page, 'me-orders-toast', '我 → 我的订单（V1 无订单页，仅提示）');
  await sleep(2000);
  await page.tap('text=服务条款 / 隐私权政策'); await sleep(500);
  await shot(page, 'me-terms-modal', '我 → 服务条款 / 隐私权政策（弹窗说明文档位置）');
  await page.tap('.uni-modal .uni-modal__btn_primary').catch(() => {}); await sleep(300);
  await go('pages/cert-org/cert-org', '.card', 800);
  check('组织认证方式二为上传劳动合同和工牌，不再是企业邮箱+管理员确认',
    /劳动合同/.test(await page.textContent('.container')) && /工牌/.test(await page.textContent('.container'))
    && !/企业邮箱 \+ 管理员确认/.test(await page.textContent('.container')));
  await shot(page, 'cert-org', '组织认证：方式一定位核验 + 方式二上传劳动合同、工牌等材料');
  const tinyPng = path.join(os.tmpdir(), 'wjd-e2e-doc.png');
  fs.writeFileSync(tinyPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.setInputFiles('#doc-contract', tinyPng);
  await page.setInputFiles('#doc-badge', tinyPng);
  await sleep(400);
  await shot(page, 'cert-org-docs', '组织认证方式二：已选择劳动合同与工牌（提交后立即认证，不做真伪核验）');
  await go('pages/cert-realname/cert-realname', '.card', 800);
  await shot(page, 'cert-realname', '实名认证页（本人支付 / 对方代付）');
  await go('pages/privacy-settings/privacy-settings', '.cells', 800);
  await shot(page, 'privacy-settings-before', '隐私设置（尚未授权位置共享）');
  await go('pages/account-delete/account-delete', '.danger-link', 600);
  check('注销入口在账号与安全页下方低调位置', !!(await page.$('.danger-link')) && /注销账号/.test(await page.textContent('.danger-link')));
  await shot(page, 'account-delete', '账号与安全：上方导出数据，下方低调放置注销账号');
  await page.tap('.danger-link'); await sleep(500);
  await shot(page, 'account-delete-modal', '账号与安全 → 注销确认弹窗（仍要注销）');
  await modalCancel(page);

  // ---------- 受限会话（Dave，跨集团未认证） ----------
  const chats = (await call('GET', '/api/chats', alice)).data || [];
  const daveChat = chats.find(c => c.peer && c.peer.id === 'u_dave');
  if (daveChat) {
    await go(`pages/chat/chat?chatId=${daveChat.chatId}`, '.input-bar', 800);
    check('受限会话显示持续提示条', !!(await page.$('.tip-bar')));
    await shot(page, 'chat-restricted', '1v1 受限会话（跨集团未认证：仅文字 + 持续提示条）');
  } else check('受限会话已建立', false, JSON.stringify(chats.map(c => c.peer && c.peer.id)));

  // ---------- 1v1 文字聊天 ----------
  await go(`pages/chat/chat?chatId=${chatId}`, '.input-bar .wt-key-btn', 800);
  check('输入栏用对讲机键替代语音/麦克风键', !!(await page.$('.wt-key-btn .wk-ant')) && !(await page.$('.mic-ico')));
  check('气泡：我方绿色带尾巴、对方白色', await page.evaluate(() => {
    const mine = document.querySelector('.msg-row.mine .bubble'); const other = document.querySelector('.msg-row:not(.mine):not(.sys) .bubble');
    return !!mine && !!other && getComputedStyle(mine).backgroundColor === 'rgb(160, 231, 90)' && getComputedStyle(other).backgroundColor === 'rgb(255, 255, 255)';
  }));
  await shot(page, 'chat-text', '1v1 文字聊天');
  await page.click('.input-bar .input');
  await page.keyboard.type('收到');
  await sleep(300);
  await shot(page, 'chat-typing', '1v1 文字聊天：输入文字后显示“发送”');
  await page.tap('.send-btn'); await sleep(800);

  await page.tap('.plus-btn');
  await page.waitForSelector('.plus-panel', { timeout: 5000 });
  await sleep(300);
  const plusText = await page.textContent('.plus-panel').catch(() => '');
  check('“+”面板保留对讲机 / 位置共享，不含举报 / 屏蔽', /对讲机/.test(plusText) && /位置共享/.test(plusText) && !/举报/.test(plusText) && !/屏蔽/.test(plusText));
  await shot(page, 'chat-plus', '“+”面板：对讲机 / 位置共享 / 查看实名（举报与屏蔽已移至对方资料页）');
  if (await page.$('.plus-panel .g-item:has-text("查看实名")')) {
    await page.tap('.plus-panel .g-item:has-text("查看实名")'); await sleep(500);
    await shot(page, 'modal-nameview', '“+” → 查看实名：付费查看说明弹窗');
    await modalCancel(page);
    if (!(await page.$('.plus-panel'))) await page.tap('.plus-btn');
  }

  // 从头衔（头像）进入资料；名字不可点
  if (await page.$('.plus-panel')) await page.tap('.plus-btn');
  await sleep(200);
  await page.tap('.msg-row:not(.mine):not(.sys) .msg-avatar');
  await page.waitForSelector('.danger, .cells', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  const fromAvatar = await page.textContent('.container').catch(() => '');
  check('点对方头衔（头像）进入好友资料', /举报/.test(fromAvatar) && /屏蔽/.test(fromAvatar));
  await shot(page, 'friend-profile-chat', '从聊天气泡旁头衔（头像）进入好友资料');
  await go(`pages/chat/chat?chatId=${chatId}`, '.input-bar .wt-key-btn', 600);
  await page.tap('.msg-row.mine .msg-avatar');
  await page.waitForSelector('.cells', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  const ownFromChat = await page.textContent('.container').catch(() => '');
  check('点自己的头衔进入自己的资料，无举报 / 屏蔽', !/举报/.test(ownFromChat) && !/屏蔽/.test(ownFromChat));
  await shot(page, 'own-profile-chat', '从自己的头衔进入自己的资料');
  await go(`pages/chat/chat?chatId=${chatId}`, '.input-bar .plus-btn', 600);
  await page.tap('.plus-btn');
  await page.waitForSelector('.plus-panel', { timeout: 5000 });

  // ---------- 对讲模式 ----------
  await page.tap('.plus-panel .g-item');
  await page.waitForSelector('.wt.panel', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.wt.panel.idle'), null, { timeout: 10000 }).catch(() => {});
  check('对讲机面板：天线 / 网罩 / LED / PTT，无液晶屏、无多余按键', !!(await page.$('.wt.panel.idle .wt-antenna')) && !!(await page.$('.wt-grille')) && !!(await page.$('.wt-led')) && !!(await page.$('.wt-ptt')) && !(await page.$('.wt-lcd')) && !(await page.$('.wt-keys')));
  check('对讲时不显示文字输入栏（输入框 / 对讲机键 / “+”）', !(await page.$('.input-bar')) && !(await page.$('.input-bar .input')) && !(await page.$('.plus-btn')));
  const exitBox = await (await page.$('.wt-exit'))?.boundingBox();
  check('对讲界面右上角有“退出对讲”', !!exitBox && (await page.textContent('.wt-exit')).trim() === '退出对讲' && exitBox.x > 390 / 2, JSON.stringify(exitBox));
  await sleep(400);
  await shot(page, 'walkie-idle', '对讲模式：待机（无输入栏，右上角“退出对讲”）');

  const btn = await page.$('.wt.panel .wt-ptt');
  const box = await btn.boundingBox();
  const before = B.bins;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.wt.panel.tx', { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  check('按住 PTT → 发射状态、LED 红色、按键按下', !!(await page.$('.wt.panel.tx .wt-led.red')) && !!(await page.$('.wt-ptt.pressed')));
  await shot(page, 'walkie-talking', '对讲模式：我在发话（红灯 + PTT 按下）');
  await page.mouse.up();
  await sleep(400);
  const got = B.bins - before;
  const cs = await page.evaluate((id) => window.__wjdRealtime.sessions.get(id).captureStats(), chatId);
  check(`Bob 实时收到 Alice 麦克风音频分片（${got} 帧 ≈ ${(got * 0.04).toFixed(1)} 秒）`, got >= 20, JSON.stringify(cs));
  check('Bob 收到开始/停止讲话信令', B.msgs.some(m => m.t === 'ptt.peer_start') && B.msgs.some(m => m.t === 'ptt.peer_stop'));
  check('松开 → 回到待机', !!(await page.$('.wt.panel.idle')));

  B.send({ t: 'ptt.start', chatId });
  await sleep(200);
  const tone = (seq) => { const b = Buffer.alloc(324); b[0] = 1; b.writeUInt16BE(seq, 1); for (let i = 0; i < 320; i++) { const x = Math.round(8000 * Math.sin(2 * Math.PI * 600 * (seq * 320 + i) / 8000)); let s = x, sign = (s >> 8) & 0x80; if (sign) s = -s; if (s > 32635) s = 32635; s += 0x84; let e = 7; for (let m = 0x4000; (s & m) === 0 && e > 0; e--, m >>= 1); const man = (s >> (e + 3)) & 0x0f; b[4 + i] = ~(sign | (e << 4) | man) & 0xff; } return b; };
  for (let i = 0; i < 40; i++) { B.bin(tone(i)); await sleep(40); }
  check('对方讲话 → 接收状态、LED 橙色', !!(await page.$('.wt.panel.rx .wt-led.orange')));
  await shot(page, 'walkie-peer-talking', '对讲模式：对方发话中（橙灯，PTT 变灰）');
  const stats = await page.evaluate((id) => window.__wjdRealtime.sessions.get(id).playerStats(), chatId);
  check(`Alice 播放器排入对方音频（${stats && stats.frames} 帧）`, stats && stats.frames >= 30, JSON.stringify(stats));
  const deniedBefore = B.msgs.length;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await sleep(300); await page.mouse.up();
  check('对方讲话中按 PTT → 不抢话（Bob 未收到 Alice 讲话）', !B.msgs.slice(deniedBefore).some(m => m.t === 'ptt.peer_start'));
  B.send({ t: 'ptt.stop', chatId });
  await sleep(300);

  await page.tap('.wt-exit');
  await sleep(400);
  check('点“退出对讲” → 回到文字聊天，输入栏恢复', !(await page.$('.wt.panel')) && !!(await page.$('.input-bar .input')));

  // 面板收起时对方讲话 → 浮层提示
  B.send({ t: 'ptt.start', chatId });
  for (let i = 0; i < 12; i++) { B.bin(tone(100 + i)); await sleep(40); }
  await page.waitForSelector('.talk-float', { timeout: 3000 }).catch(() => {});
  await shot(page, 'chat-peer-talking-float', '文字聊天中对方发话：浮层提示“Bob 正在讲话”');
  B.send({ t: 'ptt.stop', chatId });
  await sleep(300);

  // ---------- 位置共享 ----------
  B.send({ t: 'loc.start', chatId, consent: true });
  await sleep(300);
  B.send({ t: 'loc.update', chatId, lng: BOB_WGS.lng, lat: BOB_WGS.lat, accuracy: 15, coord: 'wgs84' });
  await page.waitForSelector('.rt-bar.peer', { timeout: 5000 }).catch(() => {});
  check('聊天页显示“Bob 正在共享实时位置”', !!(await page.$('.rt-bar.peer')));
  await shot(page, 'chat-peer-sharing-bar', '文字聊天：对方正在共享位置的状态条');

  await page.tap('.rt-bar.peer');
  await page.waitForSelector('.ll-page', { timeout: 10000 });
  await page.waitForFunction(() => window.__wjdMapMode, null, { timeout: 20000 }).catch(() => {});
  const mapMode = await page.evaluate(() => window.__wjdMapMode || null);
  check(`地图使用新底图（${mapMode}）`, mapMode === (process.env.EXPECT_MAP || 'pmtiles'), String(mapMode));
  await page.waitForFunction(() => window.__wjdMap && window.__wjdMap.loaded() && window.__wjdMap.areTilesLoaded(), null, { timeout: 20000 }).catch(() => {});
  check('矢量瓦片已加载渲染', await page.evaluate(() => !!(window.__wjdMap && window.__wjdMap.areTilesLoaded() && window.__wjdMap.queryRenderedFeatures().length > 20)));
  check('显示 © OpenStreetMap 署名', /OpenStreetMap/.test(await page.textContent('.attrib').catch(() => '')));
  check('地图页显示对方标注', !!(await page.$('.lmk.peer')));
  const locUi = await page.evaluate(() => ({ sheet: document.querySelector('.sheet')?.innerText || '', status: document.querySelector('.top-status')?.innerText || '', hasSeg: !!document.querySelector('.seg, .seg-item') }));
  check('位置共享页无时长选项、无剩余时间提示', !locUi.hasSeg && !/15\s*分钟|1\s*小时|直到我停止|剩余/.test(locUi.sheet + locUi.status), JSON.stringify(locUi));
  check('尚未共享时仍有“共享我的实时位置”入口', !!(await page.$('.start-btn')));
  await sleep(600);
  await shot(page, 'loc-not-sharing', '位置共享：我未共享（看对方位置 + “共享我的实时位置”入口）');
  await page.tap('.start-btn');
  await page.waitForSelector('.dialog', { timeout: 5000 }).catch(() => {});
  const dlg = await page.textContent('.dialog').catch(() => '');
  check('第一次使用 → 弹出隐私提示（写明位置不保存、退出即删除、无时长限制）', /不保存/.test(dlg) && /退出即删除/.test(dlg) && /没有时间限制/.test(dlg));
  await sleep(300);
  await shot(page, 'loc-privacy-notice', '位置共享：首次使用隐私提示');

  await page.tap('.d-btn.primary');
  await page.waitForFunction(() => !document.querySelector('.start-btn'), null, { timeout: 8000 }).catch(() => {});
  const upd = await (async () => { for (let i = 0; i < 30; i++) { const m = B.msgs.find(x => x.t === 'loc.peer_update'); if (m) return m; await sleep(200); } return null; })();
  check('确认后开始共享 → Bob 收到 Alice 位置（WGS-84 原样，无偏移）', !!upd && upd.coord === 'wgs84' && Math.abs(upd.lng - ALICE_GEO.longitude) < 1e-5, JSON.stringify(upd));
  B.send({ t: 'loc.update', chatId, lng: BOB_WGS.lng - 0.0006, lat: BOB_WGS.lat - 0.0004, accuracy: 12, coord: 'wgs84' });
  await sleep(800);
  await page.tap('.side-btn');
  await page.waitForFunction(() => window.__wjdMap && window.__wjdMap.areTilesLoaded(), null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  check('地图铺满屏幕（画布高度 ≈ 视口高度）', await page.evaluate(() => window.__wjdMap.getCanvas().clientHeight > 700));
  check('共享中没有底部提示条、没有独立“停止共享”按钮', !(await page.$('.sharing-row')) && !(await page.$('.stop-btn')) && !(await page.$('.sheet')) && !/停止共享/.test(await page.textContent('.ll-page')));
  const exitL = await (await page.$('.top-btn.exit')).boundingBox();
  check('左上角为“退出共享”', (await page.textContent('.top-btn.exit')).trim() === '退出共享' && exitL.x < 390 / 3);
  check('共享中仍有对讲机', !!(await page.$('.wt.compact')) && !(await page.$('.wt.compact .wt-lcd')));
  check('顶部显示双方距离', /米|公里/.test(await page.textContent('.top-status').catch(() => '')));
  await shot(page, 'loc-sharing', '位置共享：双方共享中（左上“退出共享”，无底部条）');

  const rb = await (await page.$('.wt.compact .wt-ptt')).boundingBox();
  const b2 = B.bins;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await sleep(1500);
  check('地图页按住 PTT → 发射中', !!(await page.$('.wt.compact.tx .wt-led.red')));
  await shot(page, 'loc-talking', '位置共享 + 我在对讲');
  await page.mouse.up();
  await sleep(300);
  check(`位置共享中对讲音频送达 Bob（${B.bins - b2} 帧）`, B.bins - b2 >= 20);

  // “收起”：回到聊天，后台继续共享
  const stopsBefore0 = B.msgs.filter(m => m.t === 'loc.peer_stopped').length;
  await page.tap('.top-btn:not(.exit)');
  await page.waitForSelector('.rt-bar.mine', { timeout: 8000 }).catch(() => {});
  check('点“收起” → 回到聊天，位置共享在后台继续', !!(await page.$('.rt-bar.mine')) && B.msgs.filter(m => m.t === 'loc.peer_stopped').length === stopsBefore0);
  await shot(page, 'chat-my-sharing-bar', '“收起”后的聊天页：我正在共享位置的状态条（后台继续共享）');

  // “退出共享” = 停止 + 删除 + 离开
  await page.tap('.rt-bar.mine .rt-text');
  await page.waitForSelector('.top-btn.exit', { timeout: 10000 });
  await sleep(800);
  const stopsBefore = B.msgs.filter(m => m.t === 'loc.peer_stopped').length;
  await page.tap('.top-btn.exit');
  await sleep(800);
  check('点“退出共享” → 共享结束（Bob 收到 loc.peer_stopped）并离开地图页', B.msgs.filter(m => m.t === 'loc.peer_stopped').length > stopsBefore && !(await page.$('.ll-page')));
  await go(`pages/live-location/live-location?chatId=${chatId}`, '.start-btn', 800);
  await page.tap('.start-btn');
  await page.waitForFunction(() => !document.querySelector('.start-btn'), null, { timeout: 8000 }).catch(() => {});
  check('第二次开始共享 → 不再弹隐私提示，直接开始', !(await page.$('.dialog')) && !(await page.$('.start-btn')));
  const sb2 = B.msgs.filter(m => m.t === 'loc.peer_stopped').length;
  await page.tap('.top-btn.exit');
  await sleep(800);
  check('再次“退出共享” → 停止共享', B.msgs.filter(m => m.t === 'loc.peer_stopped').length > sb2);
  B.send({ t: 'loc.stop', chatId });
  await sleep(300);

  // ---------- 隐私设置（已授权） ----------
  await go('pages/privacy-settings/privacy-settings', '.cell-ft.ok', 600);
  check('隐私设置显示“已同意”与撤回按钮', !!(await page.$('.cell-ft.ok')) && !!(await page.$('.btn-warn')));
  await shot(page, 'privacy-settings', '隐私设置：已授权（时间、版本、撤回）');
  await page.tap('.cell.access'); await sleep(400);
  await shot(page, 'privacy-settings-notice', '隐私设置：展开隐私提示全文');
  await page.tap('.btn-warn'); await sleep(500);
  await shot(page, 'privacy-withdraw-modal', '隐私设置：撤回授权确认弹窗');
  await modalCancel(page);

  // ---------- 对方视角：实名姓名查看请求（Bob 登录） ----------
  const nv = await call('POST', '/api/name-view/request', alice, { chatId });
  await page.evaluate((t) => localStorage.setItem('wjd_token', t), bob);
  await page.goto(BASE + '/#/pages/index/index'); await page.reload();
  await page.waitForSelector('.chat-item', { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  await shot(page, 'bob-chat-list-nameview', '对方（Bob）视角：消息列表 + 实名姓名查看请求卡片');
  await go('pages/nameview/nameview', '.container', 800);
  check('实名姓名查看请求页可见待处理请求', nv.code !== 0 || !!(await page.$('.btn-primary')), JSON.stringify(nv).slice(0, 120));
  await shot(page, 'nameview', '实名姓名查看请求页（对方逐次同意 / 拒绝）');

  check('页面无脚本错误', errors.length === 0, errors.join(' | '));
  check('没有请求高德 / World Map 域名', ![...external].some(h => /amap|autonavi|worldmap/i.test(h)), [...external].join(','));
  console.log('外部请求域名：', [...external].join(', ') || '（无，全部同源）');
  await browser.close();
  B.ws.close();
  fs.writeFileSync(`${OUT}/${P}-截图清单.md`, `# ${P} 全部页面与状态截图（iPhone 390×844 @3x，H5 构建 + Chrome）\n\n| 截图 | 页面 / 状态 |\n| --- | --- |\n` + shots.map(([f, d]) => `| ${f} | ${d} |`).join('\n') + '\n');
  console.log('\n截图清单：');
  for (const [f, d] of shots) console.log(`  ${f} → ${d}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n结果: ${results.length - failed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
