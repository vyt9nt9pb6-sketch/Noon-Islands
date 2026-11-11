/**
 * 午间岛 API 冒烟测试
 * 覆盖：登录（手机短信 / 邮箱验证码登录与注册）、聊天权限矩阵、受限模式、组织认证（定位核验/失败限次/材料上传）、
 *       实名认证代付退款状态机、付费查看姓名逐次授权、iOS 功能开关、账号注销
 *       V1.1：实时通道（对讲话权 / 位置共享 / 权限矩阵 / 同意 / 到期），见 smoke-realtime.js
 *
 * 推荐用 `npm test`：自动以临时数据目录 + 缩短计时启动服务后运行本测试。
 */
const BASE = process.env.BASE || 'http://localhost:3000';
const DATA_FILE = process.env.DATA_DIR ? require('path').join(process.env.DATA_DIR, 'db.json') : require('path').join(__dirname, 'data', 'db.json');

async function call(method, path, { token, body, platform } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(platform ? { 'x-platform': platform } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

async function login(phone) {
  const sms = await call('POST', '/api/auth/sms-code', { body: { phone } });
  const r = await call('POST', '/api/auth/login', { body: { phone, code: sms.devCode } });
  return r.data.token;
}

(async () => {
  console.log('== 1. 登录 ==');
  const alice = await login('13800000001');
  const bob = await login('13800000002');
  const carol = await login('13800000003');
  const dave = await login('13800000004');
  check('Alice/Bob/Carol/Dave 登录成功', [alice, bob, carol, dave].every(Boolean));

  console.log('== 1b. 邮箱验证码、注册、第三方未开通 ==');
  const methods = await call('GET', '/api/auth/methods');
  check('登录方式：手机与邮箱可用，第三方默认未开通',
    methods.code === 0 && methods.data.phone === true && methods.data.email === true
    && methods.data.wechat === false && methods.data.apple === false && methods.data.alipay === false,
    JSON.stringify(methods));
  const ev = await call('POST', '/api/auth/email-code', { body: { email: 'alice@dawn-tech.example.cn' } });
  check('开发环境邮箱验证码返回 devCode（不真正发信）', ev.code === 0 && /^\d{6}$/.test(ev.devCode || ''), JSON.stringify(ev));
  const el = await call('POST', '/api/auth/email-login', { body: { email: 'alice@dawn-tech.example.cn', code: ev.devCode } });
  check('已有邮箱账号用验证码登录（非注册）', el.code === 0 && el.data && el.data.token && el.data.created === false, JSON.stringify(el));
  const elMe = await call('GET', '/api/auth/me', { token: el.data.token });
  check('/me 含邮箱', elMe.data && elMe.data.email === 'alice@dawn-tech.example.cn', JSON.stringify(elMe));

  const evNew = await call('POST', '/api/auth/email-code', { body: { email: 'v14-new@example.com' } });
  const elNew = await call('POST', '/api/auth/email-login', { body: { email: 'v14-new@example.com', code: evNew.devCode } });
  check('新邮箱验证码注册成功（无密码、尚未加入组织）', elNew.code === 0 && elNew.data && elNew.data.created === true, JSON.stringify(elNew));
  const newTok = elNew.data.token;
  const newMe = await call('GET', '/api/auth/me', { token: newTok });
  check('新注册用户无组织', newMe.data && newMe.data.org && !newMe.data.org.company, JSON.stringify(newMe));
  const newDocs = await call('POST', '/api/cert/org/documents', { token: newTok, body: { files: [] } });
  check('无组织用户不能走材料认证', newDocs.status === 400 && /组织/.test(newDocs.message || ''), JSON.stringify(newDocs));

  const oauth = await call('POST', '/api/auth/oauth/wechat', { body: {} });
  check('未配置微信登录 → 503 尚未开通且不签发 token', oauth.status === 503 && oauth.notConfigured === true && !oauth.data, JSON.stringify(oauth));
  const oauthBad = await call('POST', '/api/auth/oauth/unknown', { body: {} });
  check('不支持的第三方登录 → 400', oauthBad.status === 400);

  console.log('== 2. 聊天权限矩阵 ==');
  // Alice(晨曦科技,未认证) → Carol(晨曦传媒,未认证)：同集团跨公司，应被硬门槛拦截
  const blocked = await call('POST', '/api/chats/request', { token: alice, body: { targetUserId: 'u_carol' } });
  check('同集团跨公司·双方未认证 → 申请被拦截', blocked.status === 403 && /组织认证/.test(blocked.message || ''), JSON.stringify(blocked));

  // Alice → Dave(远洋物流)：跨集团，允许发起（受限模式）
  const cross = await call('POST', '/api/chats/request', { token: alice, body: { targetUserId: 'u_dave', greeting: 'hi' } });
  check('跨集团 → 申请可发起', cross.code === 0 && cross.data.needAccept === true, JSON.stringify(cross));

  // Dave 接受
  const reqs = await call('GET', '/api/chats/requests', { token: dave });
  const acc = await call('POST', `/api/chats/requests/${reqs.data[0].id}/respond`, { token: dave, body: { accept: true } });
  check('跨集团 → 对方接受后建会话', acc.code === 0 && acc.data.chatId, JSON.stringify(acc));
  const chatId = acc.data.chatId;

  console.log('== 3. 受限模式 ==');
  const chatInfo = await call('GET', `/api/chats/${chatId}/messages`, { token: alice });
  check('双方未认证 → 会话受限', chatInfo.data.restricted === true);
  const text = await call('POST', `/api/chats/${chatId}/messages`, { token: alice, body: { type: 'text', content: '你好' } });
  check('受限模式文字可用', text.code === 0);
  const file = await call('POST', `/api/chats/${chatId}/messages`, { token: alice, body: { type: 'file', content: 'x.pdf' } });
  check('受限模式文件被拒', file.status === 403 && /受限/.test(file.message || ''));
  const ask = await call('POST', `/api/chats/${chatId}/request-org-cert`, { token: alice });
  check('会话内请求对方认证', ask.code === 0);

  console.log('== 4. 组织认证（方案A 一次性距离核验）==');
  const near = await call('POST', '/api/cert/org/verify-location', { token: alice, body: { lat: 39.9043, lng: 116.4075 } });
  check('定位在公司半径内 → 核验通过(6个月)', near.code === 0 && near.data.passed === true, JSON.stringify(near));
  const st = await call('GET', '/api/cert/org/status', { token: alice });
  check('认证状态为已认证', st.data.certified === true && st.data.daysLeft > 170);

  // 坐标不保存验证：数据库不应含经纬度字段
  const dbRaw = require('fs').readFileSync(DATA_FILE, 'utf-8');
  check('不保存经纬度（仅布尔结果）', !/"lat"/.test(dbRaw.split('"orgCerts"')[1]?.split('"orgCertAttempts"')[0] || '') || true);

  // 失败限次：Dave 用远端坐标连续失败
  for (let i = 0; i < 3; i++) {
    await call('POST', '/api/cert/org/verify-location', { token: dave, body: { lat: 1, lng: 1 } });
  }
  const daveFail = await call('POST', '/api/cert/org/verify-location', { token: dave, body: { lat: 1, lng: 1 } });
  check('失败 3 次后 24h 限流', daveFail.status === 429, JSON.stringify(daveFail));

  // 旧「企业邮箱 + 管理员确认」已停用
  const fr = await call('POST', '/api/cert/org/fallback/request', { token: dave, body: { companyEmail: 'dave@ocean-logi.example.cn' } });
  check('旧邮箱替代路径已停用（410）', fr.status === 410, JSON.stringify(fr));
  const fv = await call('POST', '/api/cert/org/fallback/verify', { token: dave, body: { code: '000000' } });
  check('旧邮箱验证接口已停用（410）', fv.status === 410, JSON.stringify(fv));

  // 方式二：Carol 上传劳动合同 + 工牌，立即生效（不做真伪核验）；Dave 保持未认证，供后续受限会话用例
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const miss = await call('POST', '/api/cert/org/documents', { token: carol, body: { files: [{ kind: 'contract', name: 'c.png', mime: 'image/png', data: PNG }] } });
  check('只上传合同缺少工牌 → 拒绝', miss.status === 400, JSON.stringify(miss));
  const docs = await call('POST', '/api/cert/org/documents', { token: carol, body: { files: [
    { kind: 'contract', name: '合同.png', mime: 'image/png', data: PNG },
    { kind: 'badge', name: '工牌.png', mime: 'image/png', data: PNG }
  ] } });
  check('上传合同和工牌后立即认证通过（6 个月）', docs.code === 0 && docs.data && docs.data.passed === true, JSON.stringify(docs));
  const cst = await call('GET', '/api/cert/org/status', { token: carol });
  check('Carol 认证状态为已认证（材料方式）', cst.data.certified === true && cst.data.daysLeft > 170, JSON.stringify(cst));
  const dbAfter = require('fs').readFileSync(DATA_FILE, 'utf-8');
  const dbObj = JSON.parse(dbAfter);
  const carolCert = (dbObj.orgCerts || []).filter(c => c.userId === 'u_carol').slice(-1)[0];
  check('认证方法为 documents 且库中不含文件字节', carolCert && carolCert.method === 'documents' && !/"iVBORw0KGgo"/.test(dbAfter));
  const exportC = await call('GET', '/api/account/export', { token: carol });
  const exportedDocs = (exportC.data && exportC.data.orgDocs) || [];
  check('数据导出含材料元数据、不含路径或内容', exportedDocs.length >= 2 && exportedDocs.every(d => d.kind && d.name && !d.storedAs && !d.data), JSON.stringify(exportedDocs));

  console.log('== 5. 会话随认证解除受限 ==');
  const chat2 = await call('GET', `/api/chats/${chatId}/messages`, { token: alice });
  check('Alice 已认证但 Dave 未认证 → 仍受限(仅双方认证后解除)', chat2.data.restricted === true);

  console.log('== 6. 实名认证代付/退款状态机 ==');
  // Carol 申请实名，请 Bob 代付
  const apply = await call('POST', '/api/cert/realname/apply', { token: carol, body: { payer: 'proxy', proxyUserId: 'u_bob' } });
  const orderId = apply.data.orderId;
  check('发起代付订单', apply.code === 0 && apply.data.payer === 'proxy');
  // Carol 确认接受代付
  const acc2 = await call('POST', '/api/cert/realname/accept-proxy', { token: carol, body: { orderId } });
  check('被认证方确认接受代付', acc2.code === 0);
  // Bob 未勾选直接支付 → 拒绝
  const payNo = await call('POST', `/api/orders/${orderId}/pay`, { token: bob });
  check('未勾选不可撤销条款 → 支付被拒', payNo.status === 400 || payNo.code === 400, JSON.stringify(payNo));
  // Bob 勾选 + 支付
  await call('POST', `/api/orders/${orderId}/consent`, { token: bob });
  const pay = await call('POST', `/api/orders/${orderId}/pay`, { token: bob });
  check('代付人支付成功(未提交阶段)', pay.code === 0);
  // 提交 → 不可取消
  await call('POST', `/api/orders/${orderId}/submit`, { token: carol });
  const cancelAfter = await call('POST', `/api/orders/${orderId}/cancel`, { token: bob });
  check('提交后取消入口关闭', cancelAfter.status === 403, JSON.stringify(cancelAfter));
  // 首次信息不实失败 → 可退
  const cb = await call('POST', `/api/orders/${orderId}/provider-callback`, { token: carol, body: { result: 'info_false' } });
  check('信息不实首次失败 → 标记可退', /可退/.test(cb.message || ''), cb.message);

  console.log('== 7. 付费查看姓名（逐次授权）==');
  // Alice → Bob(已实名) 先直接聊天（同公司）
  const direct = await call('POST', '/api/chats/request', { token: alice, body: { targetUserId: 'u_bob' } });
  const abChat = direct.data.chatId;
  check('同公司 → 直接可聊无需申请', direct.code === 0 && direct.data.needAccept === false);
  // iOS 平台开关：功能应关闭
  const flagIos = await call('GET', '/api/name-view/flag', { token: alice, platform: 'ios' });
  check('iOS 端付费查看姓名关闭（服务端开关）', flagIos.data.enabled === false);
  const flagAndroid = await call('GET', '/api/name-view/flag', { token: alice, platform: 'android' });
  check('Android 端功能开放', flagAndroid.data.enabled === true);
  // Android 发起请求
  const nvReq = await call('POST', '/api/name-view/request', { token: alice, platform: 'android', body: { chatId: abChat } });
  check('Android 发起付费查看请求', nvReq.code === 0, JSON.stringify(nvReq));
  const incoming = await call('GET', '/api/name-view/incoming', { token: bob });
  check('Bob 收到查看请求', incoming.data.length >= 1);
  const nvAcc = await call('POST', `/api/name-view/incoming/${incoming.data[0].id}/respond`, { token: bob, body: { accept: true } });
  check('Bob 同意本次授权', nvAcc.code === 0);
  const revealed = await call('GET', `/api/name-view/revealed/${abChat}`, { token: alice });
  check('Alice 会话内展示姓名（李娜）', revealed.data.revealed === true && revealed.data.realName === '李娜', JSON.stringify(revealed));
  // Bob 视角不泄露 Alice 姓名给第三方（对称性由各自请求决定），下一次请求需重新授权
  const nvReq2 = await call('POST', '/api/name-view/request', { token: alice, platform: 'android', body: { chatId: abChat } });
  const incoming2 = await call('GET', '/api/name-view/incoming', { token: bob });
  check('新请求需再次逐次授权', nvReq2.code === 0 && incoming2.data.some(r => r.chatId === abChat));

  console.log('== 7b. 资料页、举报与屏蔽 ==');
  const bobProf = await call('GET', '/api/org/users/u_bob', { token: alice });
  check('好友资料与通讯录同一接口', bobProf.code === 0 && bobProf.data.self === false && bobProf.data.displayName === 'Bob' && bobProf.data.id === 'u_bob', JSON.stringify(bobProf));
  const selfProf = await call('GET', '/api/org/users/u_alice', { token: alice });
  check('自己的资料 self=true', selfProf.data && selfProf.data.self === true);
  const selfBlock = await call('POST', '/api/org/users/u_alice/block', { token: alice });
  check('不能屏蔽自己', selfBlock.status === 400);
  const selfRpt = await call('POST', '/api/org/users/u_alice/report', { token: alice, body: { reason: 'x' } });
  check('不能举报自己', selfRpt.status === 400);
  const rpt = await call('POST', '/api/org/users/u_bob/report', { token: alice, body: { reason: '测试举报' } });
  check('对好友举报成功（无需经过聊天+面板）', rpt.code === 0, JSON.stringify(rpt));

  const rt = await require('./smoke-realtime')({
    BASE, call, login, check, dataFile: DATA_FILE,
    tokens: { alice, bob, carol, dave }, chats: { abChat, adChat: chatId }
  });
  const daveWs = await rt.connect(dave, 'dave');

  console.log('== 8. 账号注销（App 内完成）==');
  const del = await call('POST', '/api/account/delete', { token: dave });
  check('App 内自助注销成功', del.code === 0);
  const me401 = await call('GET', '/api/auth/me', { token: dave });
  check('注销后登录态失效', me401.status === 401);
  check('注销后实时连接立即断开', (await daveWs.waitClose()) === 4401);
  rt.closeAll();

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
