/**
 * 付费查看姓名（PRD 3.2）：逐次、单次授权
 * - 每一次请求都是独立授权，同意只对本次请求生效，不提供“长期拒绝/永久关闭”开关
 * - iOS 端整体关闭（服务端功能开关，客户端不渲染入口）
 * - 授权日志仅用于审计
 */
const express = require('express');
const { load, save, id } = require('../db');
const { authRequired } = require('../middleware/auth');
const { getUser } = require('../services/permissions');
const { FLAGS, isFeatureEnabled } = require('../services/flags');

const router = express.Router();
router.use(authRequired);

// 功能开关查询（客户端据此决定是否渲染入口）
router.get('/flag', (req, res) => {
  res.json({ code: 0, data: { enabled: isFeatureEnabled('paidNameView', req.headers['x-platform']), fee: FLAGS.nameViewFee } });
});

// A 发起查看请求：先支付（mock），请求送达 B
router.post('/request', (req, res) => {
  if (!isFeatureEnabled('paidNameView', req.headers['x-platform'])) {
    return res.status(404).json({ code: 404, message: '该功能在当前平台暂不开放' });
  }
  const { chatId } = req.body || {};
  const db = load();
  const chat = db.chats.find(c => c.id === chatId && c.memberIds.includes(req.user.id));
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const targetId = chat.memberIds.find(m => m !== req.user.id);
  const target = getUser(targetId);
  if (!target?.realnameCertified) return res.status(400).json({ code: 400, message: '对方尚未完成实名认证' });

  const dup = db.nameViewRequests.find(r => r.chatId === chatId && r.requesterId === req.user.id && r.status === 'pending');
  if (dup) return res.status(409).json({ code: 409, message: '已有待对方处理的查看请求' });

  // mock 支付下单（生产：微信支付普通商户收款，Android 端）
  const order = {
    id: id('ord'), kind: 'nameview', chatId,
    payerUserId: req.user.id, payeeUserId: targetId,
    amount: FLAGS.nameViewFee.amount, currency: FLAGS.nameViewFee.currency,
    consentedIrrevocable: true, status: 'paid', payTime: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);

  const request = {
    id: id('nvr'), chatId, orderId: order.id,
    requesterId: req.user.id, targetId,
    status: 'pending', createdAt: new Date().toISOString()
  };
  db.nameViewRequests.push(request);
  db.nameViewLogs.push({ id: id('nvlog'), requesterId: req.user.id, targetId, action: 'request_paid', chatId, createdAt: new Date().toISOString() });
  db.messages.push({ id: id('msg'), chatId, fromUserId: 'system', type: 'system', content: `${req.user.displayName} 请求查看你的实名姓名（已支付费用）`, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, data: { requestId: request.id, message: '请求已送达，等待对方逐次授权' } });
});

// 我收到的待处理请求
router.get('/incoming', (req, res) => {
  const db = load();
  const list = db.nameViewRequests.filter(r => r.targetId === req.user.id && r.status === 'pending').map(r => {
    const requester = getUser(r.requesterId);
    return { id: r.id, chatId: r.chatId, requesterName: requester?.displayName, requesterId: r.requesterId, createdAt: r.createdAt };
  });
  res.json({ code: 0, data: list });
});

// B 逐次同意 / 拒绝（同意仅对本次请求生效）
router.post('/incoming/:requestId/respond', (req, res) => {
  const { accept } = req.body || {};
  const db = load();
  const r = db.nameViewRequests.find(x => x.id === req.params.requestId && x.targetId === req.user.id && x.status === 'pending');
  if (!r) return res.status(404).json({ code: 404, message: '请求不存在或已处理' });

  r.status = accept ? 'accepted' : 'rejected';
  r.respondedAt = new Date().toISOString();
  db.nameViewLogs.push({ id: id('nvlog'), requesterId: r.requesterId, targetId: req.user.id, action: accept ? 'accept_once' : 'reject_once', chatId: r.chatId, createdAt: r.respondedAt });

  const order = db.orders.find(o => o.id === r.orderId);
  if (accept) {
    // 同意 → 本次会话展示姓名（读取时动态校验，不落姓名副本）
    db.messages.push({ id: id('msg'), chatId: r.chatId, fromUserId: 'system', type: 'system', content: '对方已同意本次展示实名姓名', createdAt: new Date().toISOString() });
  } else {
    // 拒绝 → 请求关闭；费用原路全额退回请求方（平台主动退，无需 A 申请）
    if (order) { order.status = 'refunded'; order.refundAmount = order.amount; order.refundReason = '对方拒绝授权，自动全额退款'; order.refundedAt = new Date().toISOString(); }
    db.messages.push({ id: id('msg'), chatId: r.chatId, fromUserId: 'system', type: 'system', content: '对方拒绝了本次查看请求，费用已原路退回', createdAt: new Date().toISOString() });
  }
  save();
  res.json({ code: 0, message: accept ? '已同意本次展示' : '已拒绝，对方费用已自动退回' });
});

// 会话内可见的已授权姓名（仅 accepted 且属于该会话的最近一次授权；逐次生效）
router.get('/revealed/:chatId', (req, res) => {
  const db = load();
  const chat = db.chats.find(c => c.id === req.params.chatId && c.memberIds.includes(req.user.id));
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const peerId = chat.memberIds.find(m => m !== req.user.id);
  const accepted = db.nameViewRequests
    .filter(r => r.chatId === chat.id && r.requesterId === req.user.id && r.targetId === peerId && r.status === 'accepted')
    .sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt))[0];
  if (!accepted) return res.json({ code: 0, data: { revealed: false } });
  const peer = getUser(peerId);
  res.json({ code: 0, data: { revealed: true, realName: peer?.realName, respondedAt: accepted.respondedAt, note: '同意仅对本次请求生效，查看下一次需重新取得同意' } });
});

module.exports = router;
