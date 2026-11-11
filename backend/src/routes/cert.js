/**
 * 认证路由（PRD 2.4 / 3 / 4 / 5）
 * - 组织认证：一次性距离核验（方式一）/ 上传劳动合同与工牌等材料（方式二，只认证不核验真伪，上传后立即生效 6 个月）；24h 内定位失败 3 次限制；不保存经纬度
 * - 实名认证：付费（本人/代付），代付人直接向平台支付，提交前可取消（全额退），提交后不可单方撤销
 */
const express = require('express');
const { load, save, id, DATA_DIR } = require('../db');
const fs = require('fs');
const path = require('path');
const { authRequired } = require('../middleware/auth');
const { getCompany, getOrgCertStatus } = require('../services/permissions');
const { FLAGS } = require('../services/flags');

const router = express.Router();
router.use(authRequired);

/** 订单路由：独立挂载于 /api/orders（付款人/被认证人通用） */
const ordersRouter = express.Router();
ordersRouter.use(authRequired);

/* ==================== 组织认证 ==================== */

const ORG_CERT_ATTEMPT_LIMIT = 3;      // 24 小时内最多 3 次（PRD 2.4）
const ORG_CERT_VALID_DAYS = 180;       // 6 个月（PRD 2.4）

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 组织认证状态
router.get('/org/status', (req, res) => {
  const status = getOrgCertStatus(req.user.id);
  const db = load();
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recentFails = db.orgCertAttempts.filter(a => a.userId === req.user.id && new Date(a.failedAt) > cutoff);
  const daysLeft = status.validUntil ? Math.ceil((new Date(status.validUntil) - Date.now()) / 86400000) : null;
  res.json({
    code: 0,
    data: {
      ...status,
      daysLeft,
      attemptsLeft: Math.max(0, ORG_CERT_ATTEMPT_LIMIT - recentFails.length),
      company: getCompany(req.user.org && req.user.org.companyId)?.name || ''
    }
  });
});

// 一次性距离核验（方案A）：仅保存布尔结果与时间戳，不保存经纬度（PRD 1.1）
router.post('/org/verify-location', (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ code: 400, message: '缺少定位坐标' });
  }
  const db = load();
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recentFails = db.orgCertAttempts.filter(a => a.userId === req.user.id && new Date(a.failedAt) > cutoff);
  if (recentFails.length >= ORG_CERT_ATTEMPT_LIMIT) {
    return res.status(429).json({ code: 429, message: '核验失败次数已达今日上限（24 小时内 3 次），请改用上传劳动合同、工牌等材料，或明日再试' });
  }

  const company = getCompany(req.user.org && req.user.org.companyId);
  if (!company) return res.status(404).json({ code: 404, message: '未找到所属公司' });

  const distance = haversineMeters(lat, lng, company.registeredAddress.lat, company.registeredAddress.lng);
  const within = distance <= (company.radiusMeters || 500);

  if (!within) {
    db.orgCertAttempts.push({ userId: req.user.id, failedAt: new Date().toISOString() });
    save();
    return res.status(200).json({
      code: 0,
      data: { passed: false, reason: '不在公司注册地址允许半径内', attemptsLeft: Math.max(0, ORG_CERT_ATTEMPT_LIMIT - recentFails.length - 1) }
    });
  }

  // 通过：仅写入布尔结果 + 时间戳（不写坐标、不写距离）
  db.orgCerts.push({
    id: id('oc'), userId: req.user.id, companyId: company.id, method: 'location',
    withinRadius: true, verifiedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + ORG_CERT_VALID_DAYS * 24 * 3600 * 1000).toISOString(),
    expiredByDeparture: false
  });
  db.auditLogs.push({ id: id('log'), action: 'org_cert_location', userId: req.user.id, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, data: { passed: true, validUntil: db.orgCerts.slice(-1)[0].validUntil } });
});

// 方式二：上传劳动合同、工牌等材料。只做认证、不做内容核验，也不经企业管理员审核；材料齐全后立即发放 6 个月组织认证。
const DOC_KINDS = ['contract', 'badge', 'other'];
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const MAX_DOCS = 6;

function extOf(name, mime) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf') || mime === 'application/pdf') return '.pdf';
  if (n.endsWith('.png') || mime === 'image/png') return '.png';
  if (n.endsWith('.webp') || mime === 'image/webp') return '.webp';
  if (n.endsWith('.heic') || mime === 'image/heic') return '.heic';
  return '.jpg';
}

router.post('/org/documents', (req, res) => {
  const company = getCompany(req.user.org && req.user.org.companyId);
  if (!company) return res.status(400).json({ code: 400, message: '尚未加入组织，请联系企业开通账号后再认证' });
  if (getOrgCertStatus(req.user.id).certified) return res.status(400).json({ code: 400, message: '已完成组织认证' });
  const files = Array.isArray((req.body || {}).files) ? req.body.files : [];
  if (files.length < 2 || files.length > MAX_DOCS) {
    return res.status(400).json({ code: 400, message: '请至少上传劳动合同和工牌各一份，最多 6 份' });
  }
  const prepared = [];
  for (const f of files) {
    const kind = DOC_KINDS.includes(f.kind) ? f.kind : null;
    const mime = String(f.mime || 'application/octet-stream').toLowerCase();
    if (!kind) return res.status(400).json({ code: 400, message: '材料类型无效（合同 / 工牌 / 其他）' });
    if (!DOC_MIME.includes(mime)) return res.status(400).json({ code: 400, message: '仅支持图片或 PDF' });
    const raw = String(f.data || '').replace(/^data:[^;]+;base64,/, '');
    let buf;
    try { buf = Buffer.from(raw, 'base64'); } catch (e) { buf = null; }
    if (!buf || !buf.length) return res.status(400).json({ code: 400, message: '文件内容无效' });
    if (buf.length > MAX_DOC_BYTES) return res.status(400).json({ code: 400, message: '单个文件不能超过 3 MB' });
    prepared.push({ kind, name: String(f.name || kind).slice(0, 80), mime, buf });
  }
  if (!prepared.some(f => f.kind === 'contract') || !prepared.some(f => f.kind === 'badge')) {
    return res.status(400).json({ code: 400, message: '请同时上传劳动合同和工牌（不做真伪核验，仅确认已提交这两类材料）' });
  }

  const db = load();
  const dir = path.join(DATA_DIR, 'org-docs', req.user.id);
  fs.mkdirSync(dir, { recursive: true });
  const recs = [];
  for (const f of prepared) {
    const recId = id('od');
    const storedAs = recId + extOf(f.name, f.mime);
    fs.writeFileSync(path.join(dir, storedAs), f.buf);
    recs.push({
      id: recId, userId: req.user.id, companyId: company.id,
      kind: f.kind, name: f.name, mime: f.mime, size: f.buf.length,
      storedAs, uploadedAt: new Date().toISOString()
    });
  }
  db.orgDocs = db.orgDocs || [];
  db.orgDocs.push(...recs);
  const cert = {
    id: id('oc'), userId: req.user.id, companyId: company.id, method: 'documents',
    withinRadius: null, verifiedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + ORG_CERT_VALID_DAYS * 24 * 3600 * 1000).toISOString(),
    expiredByDeparture: false
  };
  db.orgCerts.push(cert);
  db.auditLogs.push({ id: id('log'), action: 'org_cert_documents', userId: req.user.id, createdAt: new Date().toISOString() });
  save();
  res.json({
    code: 0,
    data: {
      passed: true, validUntil: cert.validUntil,
      files: recs.map(r => ({ kind: r.kind, name: r.name, size: r.size, uploadedAt: r.uploadedAt }))
    }
  });
});

// 原「企业邮箱 + 管理员确认」路径已由材料上传替代
router.post('/org/fallback/request', (req, res) => {
  res.status(410).json({ code: 410, message: '该路径已停用，请改用上传劳动合同和工牌完成组织认证' });
});
router.post('/org/fallback/verify', (req, res) => {
  res.status(410).json({ code: 410, message: '该路径已停用，请改用上传劳动合同和工牌完成组织认证' });
});

/* ==================== 实名认证（付费） ==================== */

const ORDER_STATUS = {
  CREATED: 'created',          // 已创建（被认证方已确认授权）
  PROXY_CONFIRMED: 'proxy_confirmed', // 代付人已确认（如适用）
  PAID: 'paid',                // 已支付（认证未提交：仍可取消、全额退）
  SUBMITTED: 'submitted',      // 已提交服务商（取消/退款入口关闭）
  SUCCESS: 'success',          // 认证成功（不退）
  FAILED_INFO_FIRST: 'failed_info_first',   // 信息不实失败（同一账号首次：可退）
  FAILED_INFO_REPEAT: 'failed_info_repeat', // 信息不实失败（后续：不退）
  FAILED_PLATFORM: 'failed_platform',       // 平台/接口故障（全额退）
  CANCELLED: 'cancelled'       // 支付前/提交前主动取消（全额退）
};

// 实名认证状态
router.get('/realname/status', (req, res) => {
  const db = load();
  const cert = db.realnameCerts.filter(c => c.userId === req.user.id).slice(-1)[0];
  const myOrders = db.orders.filter(o => o.kind === 'realname' && o.payeeUserId === req.user.id);
  res.json({
    code: 0,
    data: {
      certified: !!req.user.realnameCertified,
      cert: cert || null,
      fee: FLAGS.realnameFee,
      orders: myOrders
    }
  });
});

// 发起实名认证：选择付费方（本人 / 请对方代付）
router.post('/realname/apply', (req, res) => {
  const { payer } = req.body || {}; // 'self' | 'proxy'
  const proxyUserId = req.body?.proxyUserId;
  if (req.user.realnameCertified) return res.status(400).json({ code: 400, message: '已完成实名认证' });
  if (payer !== 'self' && payer !== 'proxy') return res.status(400).json({ code: 400, message: '付费方参数不合法' });
  if (payer === 'proxy' && !proxyUserId) return res.status(400).json({ code: 400, message: '缺少代付人' });

  const db = load();
  const order = {
    id: id('ord'), kind: 'realname',
    payeeUserId: req.user.id,                                  // 被认证人
    payerUserId: payer === 'self' ? req.user.id : proxyUserId, // 付款人（直接向平台支付）
    amount: FLAGS.realnameFee.amount, currency: FLAGS.realnameFee.currency,
    consentedIrrevocable: false,                              // 代付人需主动勾选（非默认）
    proxyAccepted: payer === 'self' ? true : false,            // 被认证方确认接受该笔代付
    status: ORDER_STATUS.CREATED,
    infoFalseFailCount: db.orders.filter(o => o.kind === 'realname' && o.payeeUserId === req.user.id && ['failed_info_first', 'failed_info_repeat'].includes(o.status)).length,
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  save();
  res.json({ code: 0, data: { orderId: order.id, amount: order.amount, payer } });
});

// 被认证方确认：授权实名 + 接受代付（PRD 4.2 前置条件 1）
router.post('/realname/accept-proxy', (req, res) => {
  const { orderId } = req.body || {};
  const db = load();
  const order = db.orders.find(o => o.id === orderId && o.kind === 'realname' && o.payeeUserId === req.user.id && o.status === ORDER_STATUS.CREATED);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在或状态不允许确认' });
  order.proxyAccepted = true;
  order.status = ORDER_STATUS.PROXY_CONFIRMED;
  save();
  res.json({ code: 0, message: '已确认接受代付，等待付款人支付' });
});

// 代付人/本人支付前的不可撤销确认（主动勾选，非默认勾选，PRD 4.2 前置条件 2）
ordersRouter.post('/:orderId/consent', (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId && o.payerUserId === req.user.id && [ORDER_STATUS.CREATED, ORDER_STATUS.PROXY_CONFIRMED].includes(o.status));
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在或状态不允许' });
  order.consentedIrrevocable = true;
  save();
  res.json({ code: 0, message: '已确认：认证提交后不可单方撤销或退款，认证失败按规则处理' });
});

// 支付（Mock：直接成功；生产接入微信支付/支付宝普通商户收款，平台为收款商户）
ordersRouter.post('/:orderId/pay', (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId && o.payerUserId === req.user.id && o.status === ORDER_STATUS.PROXY_CONFIRMED);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在或不可支付（需被认证方确认 + 不可撤销勾选）' });
  if (!order.consentedIrrevocable) return res.status(400).json({ code: 400, message: '支付前必须勾选确认不可撤销条款' });
  order.status = ORDER_STATUS.PAID;
  order.payTime = new Date().toISOString();
  save();
  res.json({ code: 0, data: { status: order.status, cancelWindow: '认证未提交阶段可取消，全额退款' } });
});

// 认证未提交阶段：主动取消（全额退，原路退回付款人）
ordersRouter.post('/:orderId/cancel', (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId && o.payerUserId === req.user.id && o.status === ORDER_STATUS.PAID);
  if (!order) return res.status(403).json({ code: 403, message: '仅“认证未提交”状态可取消。认证已提交后取消/退款入口已关闭' });
  order.status = ORDER_STATUS.CANCELLED;
  order.refundAmount = order.amount;   // 原路退回付款人
  order.refundReason = '认证提交前主动取消';
  order.refundedAt = new Date().toISOString();
  save();
  res.json({ code: 0, message: '已取消，费用将原路退回', data: { refundAmount: order.refundAmount } });
});

// 提交认证（关闭取消/退款入口，PRD 原则 4）
ordersRouter.post('/:orderId/submit', (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId && o.kind === 'realname' && o.payeeUserId === req.user.id && o.status === ORDER_STATUS.PAID);
  if (!order) return res.status(403).json({ code: 403, message: '仅已支付订单可提交' });
  order.status = ORDER_STATUS.SUBMITTED;
  order.submitTime = new Date().toISOString();
  db.realnameCerts.push({ id: id('rc'), userId: req.user.id, provider: 'mock-provider', providerFlowNo: id('flow'), status: 'processing', submittedAt: order.submitTime });
  save();
  res.json({ code: 0, message: '认证已提交至服务商，取消与退款入口已关闭' });
});

// Mock 服务商回调（联调用）：result: success | info_false | platform_error
ordersRouter.post('/:orderId/provider-callback', (req, res) => {
  const { result } = req.body || {};
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId && o.status === ORDER_STATUS.SUBMITTED);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在或未提交' });

  if (result === 'success') {
    order.status = ORDER_STATUS.SUCCESS;
    const user = db.users.find(u => u.id === order.payeeUserId);
    if (user) user.realnameCertified = true;
    const cert = db.realnameCerts.filter(c => c.userId === order.payeeUserId).slice(-1)[0];
    if (cert) { cert.status = 'success'; cert.finishedAt = new Date().toISOString(); }
    save();
    return res.json({ code: 0, message: '认证成功，徽章已生效（不退款）' });
  }
  if (result === 'platform_error') {
    order.status = ORDER_STATUS.FAILED_PLATFORM;
    order.refundAmount = order.amount;  // 全额、原路退回付款人
    order.refundReason = '平台/服务商接口故障';
    save();
    return res.json({ code: 0, message: '平台故障，全额退款（原路退回付款人）' });
  }
  if (result === 'info_false') {
    // 同一账号首次信息不实失败：可退；后续：不退（PRD 4.3）
    const first = (order.infoFalseFailCount || 0) === 0;
    order.status = first ? ORDER_STATUS.FAILED_INFO_FIRST : ORDER_STATUS.FAILED_INFO_REPEAT;
    order.refundAmount = first ? order.amount : 0;
    order.refundReason = first ? '信息不实-首次失败-可退' : '信息不实-再次失败-不退';
    save();
    return res.json({ code: 0, message: first ? '信息不实（首次），费用可退' : '信息不实（非首次），不予退款' });
  }
  res.status(400).json({ code: 400, message: 'result 参数不合法' });
});

// 我的订单列表
ordersRouter.get('/', (req, res) => {
  const db = load();
  const list = db.orders.filter(o => o.payerUserId === req.user.id || o.payeeUserId === req.user.id);
  res.json({ code: 0, data: list });
});

module.exports = { router, ordersRouter };
