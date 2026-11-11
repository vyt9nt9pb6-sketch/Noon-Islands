/** 聊天路由：申请/接受、会话列表、消息收发（含受限模式与组织认证阻断）、举报/屏蔽 */
const express = require('express');
const { load, save, id } = require('../db');
const { authRequired } = require('../middleware/auth');
const { getUser, getCompany, getOrgCertStatus, relationBetween, isRestricted, canInitiateChat, canSendMessage } = require('../services/permissions');

const router = express.Router();
router.use(authRequired);

function getChat(chatId, userId) {
  const chat = load().chats.find(c => c.id === chatId && c.memberIds.includes(userId));
  return chat || null;
}

function sysMessage(chatId, content) {
  const db = load();
  db.messages.push({ id: id('msg'), chatId, fromUserId: 'system', type: 'system', content, createdAt: new Date().toISOString() });
}

function relationLabel(relation) {
  return { same_company: '同公司', same_group_cross_company: '同集团·不同公司', cross_group: '跨集团' }[relation] || relation;
}

// 发起聊天 / 申请
router.post('/request', (req, res) => {
  const { targetUserId, greeting } = req.body || {};
  const me = req.user;
  const target = getUser(targetUserId);
  if (!target) return res.status(404).json({ code: 404, message: '对方账号不存在或已注销' });

  const check = canInitiateChat(me, target);
  if (!check.allowed) {
    return res.status(403).json({ code: 403, message: check.reason || '暂不满足发起聊天的条件', data: { relation: check.relation } });
  }

  const db = load();
  const existing = db.chats.find(c => c.memberIds.includes(me.id) && c.memberIds.includes(target.id));
  if (existing) return res.json({ code: 0, message: '会话已存在', data: { chatId: existing.id, needAccept: false } });

  if (!check.needRequest) {
    // 同公司：直接建会话
    const chat = { id: id('chat'), memberIds: [me.id, target.id], relation: check.relation, createdAt: new Date().toISOString() };
    db.chats.push(chat);
    sysMessage(chat.id, `会话已建立（${relationLabel(check.relation)}）`);
    save();
    return res.json({ code: 0, data: { chatId: chat.id, needAccept: false } });
  }

  const dup = db.chatRequests.find(r => r.fromUserId === me.id && r.toUserId === target.id && r.status === 'pending');
  if (dup) return res.status(409).json({ code: 409, message: '已有一份待对方处理的申请' });

  const request = {
    id: id('req'), fromUserId: me.id, toUserId: target.id, status: 'pending',
    relation: check.relation, greeting: String(greeting || '').slice(0, 100),
    createdAt: new Date().toISOString()
  };
  db.chatRequests.push(request);
  save();
  res.json({ code: 0, data: { requestId: request.id, needAccept: true, message: '申请已发出，等待对方接受' } });
});

// 我收到的待处理申请
router.get('/requests', (req, res) => {
  const db = load();
  const list = db.chatRequests.filter(r => r.toUserId === req.user.id && r.status === 'pending').map(r => {
    const from = getUser(r.fromUserId);
    return {
      id: r.id, fromUserId: r.fromUserId, fromName: from?.displayName, fromCompany: getCompany(from?.org.companyId)?.name,
      greeting: r.greeting, relationLabel: relationLabel(r.relation), createdAt: r.createdAt
    };
  });
  res.json({ code: 0, data: list });
});

// 接受 / 拒绝
router.post('/requests/:rid/respond', (req, res) => {
  const { accept } = req.body || {};
  const db = load();
  const r = db.chatRequests.find(x => x.id === req.params.rid && x.toUserId === req.user.id && x.status === 'pending');
  if (!r) return res.status(404).json({ code: 404, message: '申请不存在或已处理' });

  if (!accept) {
    r.status = 'rejected';
    save();
    return res.json({ code: 0, message: '已拒绝' });
  }

  // 同集团跨公司：接受时再校验双方组织认证（防止申请期间认证过期）
  if (r.relation === 'same_group_cross_company') {
    const aCert = getOrgCertStatus(r.fromUserId), bCert = getOrgCertStatus(r.toUserId);
    if (!aCert.certified || !bCert.certified) {
      return res.status(403).json({ code: 403, message: '任一方组织认证已失效，无法建立会话' });
    }
  }

  r.status = 'accepted';
  const chat = { id: id('chat'), memberIds: [r.fromUserId, r.toUserId], relation: r.relation, createdAt: new Date().toISOString() };
  db.chats.push(chat);
  sysMessage(chat.id, `会话已建立（${relationLabel(r.relation)}）`);
  save();
  res.json({ code: 0, data: { chatId: chat.id } });
});

// 会话列表
router.get('/', (req, res) => {
  const db = load();
  const me = req.user;
  const list = db.chats.filter(c => c.memberIds.includes(me.id)).map(c => {
    const peerId = c.memberIds.find(m => m !== me.id);
    const peer = getUser(peerId);
    if (!peer) return null;
    const peerCert = getOrgCertStatus(peerId);
    const myCert = getOrgCertStatus(me.id);
    const lastMsg = db.messages.filter(m => m.chatId === c.id).slice(-1)[0];
    return {
      chatId: c.id, peer: {
        id: peer.id, displayName: peer.displayName, avatarColor: peer.avatarColor,
        realnameCertified: !!peer.realnameCertified, orgCert: peerCert
      },
      relation: c.relation, relationLabel: relationLabel(c.relation),
      restricted: isRestricted(c),
      myOrgCert: myCert,
      lastMessage: lastMsg ? { type: lastMsg.type, content: lastMsg.content, createdAt: lastMsg.createdAt } : null
    };
  }).filter(Boolean);
  res.json({ code: 0, data: list });
});

// 会话详情 + 消息
router.get('/:chatId/messages', (req, res) => {
  const chat = getChat(req.params.chatId, req.user.id);
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const db = load();
  const messages = db.messages.filter(m => m.chatId === chat.id).map(m => ({
    id: m.id, fromUserId: m.fromUserId, type: m.type, content: m.content, createdAt: m.createdAt,
    fromMe: m.fromUserId === req.user.id
  }));
  const peerId = chat.memberIds.find(m => m !== req.user.id);
  const peer = getUser(peerId);
  const peerCert = getOrgCertStatus(peerId);
  res.json({
    code: 0,
    data: {
      chatId: chat.id,
      peer: {
        id: peer.id, displayName: peer.displayName, avatarColor: peer.avatarColor,
        realnameCertified: !!peer.realnameCertified,
        realName: peer.realnameCertified ? peer.realName : null, // 仅在被逐次授权后由 nameview 路由下发
        orgCert: peerCert
      },
      relation: chat.relation, relationLabel: relationLabel(chat.relation),
      restricted: isRestricted(chat),
      mySendBlocked: !canSendMessage(chat, req.user.id).allowed ? canSendMessage(chat, req.user.id).reason : null,
      messages
    }
  });
});

// 发送消息（含受限模式功能限制与组织认证阻断）
router.post('/:chatId/messages', (req, res) => {
  const { type = 'text', content } = req.body || {};
  const chat = getChat(req.params.chatId, req.user.id);
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });

  const sendCheck = canSendMessage(chat, req.user.id);
  if (!sendCheck.allowed) {
    return res.status(403).json({ code: 403, message: sendCheck.reason });
  }

  const blocked = load().blocks.find(b => b.userId === chat.memberIds.find(m => m !== req.user.id) && b.blockedUserId === req.user.id);
  if (blocked) return res.status(403).json({ code: 403, message: '对方已将与你的会话屏蔽' });

  // PRD 2.3 受限模式：仅文字可用
  if (sendCheck.restricted && ['file', 'voice', 'video'].includes(type)) {
    return res.status(403).json({ code: 403, message: '受限模式下仅支持文字消息，双方完成组织认证后解锁文件/语音/视频' });
  }
  if (type === 'text' && (!content || !String(content).trim())) {
    return res.status(400).json({ code: 400, message: '消息内容不能为空' });
  }

  const db = load();
  const msg = {
    id: id('msg'), chatId: chat.id, fromUserId: req.user.id, type,
    content: String(content).slice(0, 2000), createdAt: new Date().toISOString()
  };
  db.messages.push(msg);
  save();
  res.json({ code: 0, data: msg });
});

// 会话内“请求对方完成组织认证”
router.post('/:chatId/request-org-cert', (req, res) => {
  const chat = getChat(req.params.chatId, req.user.id);
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const peerId = chat.memberIds.find(m => m !== req.user.id);
  if (getOrgCertStatus(peerId).certified) {
    return res.status(400).json({ code: 400, message: '对方已完成组织认证' });
  }
  sysMessage(chat.id, `${req.user.displayName} 请求你完成组织认证，以便解锁完整会话功能`);
  save();
  res.json({ code: 0, message: '已向对方发送组织认证请求' });
});

// 屏蔽（会话内入口，社交类上架必备）
router.post('/:chatId/block', (req, res) => {
  const chat = getChat(req.params.chatId, req.user.id);
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const db = load();
  const peerId = chat.memberIds.find(m => m !== req.user.id);
  if (!db.blocks.find(b => b.userId === req.user.id && b.blockedUserId === peerId)) {
    db.blocks.push({ id: id('blk'), userId: req.user.id, blockedUserId: peerId, createdAt: new Date().toISOString() });
  }
  sysMessage(chat.id, `${req.user.displayName} 已屏蔽该会话`);
  save();
  // 屏蔽后立即结束该会话内的位置共享与对讲
  require('../realtime').revokeChat(chat.id);
  res.json({ code: 0, message: '已屏蔽' });
});

// 举报（会话内入口）
router.post('/:chatId/report', (req, res) => {
  const chat = getChat(req.params.chatId, req.user.id);
  if (!chat) return res.status(404).json({ code: 404, message: '会话不存在' });
  const { reason } = req.body || {};
  const db = load();
  db.reports.push({ id: id('rpt'), chatId: chat.id, reporterId: req.user.id, reason: String(reason || '').slice(0, 200), createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, message: '举报已受理，平台将尽快核实处理' });
});

module.exports = router;
