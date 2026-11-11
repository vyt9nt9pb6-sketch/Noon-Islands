/** 账号路由：App 内自助注销（App Store 5.1.1(v) 强制）与数据导出 */
const express = require('express');
const { load, save, id } = require('../db');
const { authRequired } = require('../middleware/auth');
const { getLocationConsent, withdrawLocationConsent, consentsOf } = require('../services/consent');

const router = express.Router();
router.use(authRequired);

// 数据导出（个保法查阅权）
router.get('/export', (req, res) => {
  const me = req.user;
  const db = load();
  res.json({
    code: 0,
    data: {
      profile: { id: me.id, phone: me.phone, email: me.email || '', displayName: me.displayName, realName: me.realName, realnameCertified: me.realnameCertified },
      org: me.org,
      orgCerts: db.orgCerts.filter(c => c.userId === me.id),
      realnameCerts: db.realnameCerts.filter(c => c.userId === me.id),
      nameViewLogsAboutMe: db.nameViewLogs.filter(l => l.targetId === me.id || l.requesterId === me.id),
      orgDocs: (db.orgDocs || []).filter(d => d.userId === me.id).map(d => ({ kind: d.kind, name: d.name, size: d.size, uploadedAt: d.uploadedAt })), // 仅元数据，不含文件内容
      privacyConsents: consentsOf(me.id) // 仅同意记录；位置共享数据不保存，因此没有可导出的位置

    }
  });
});

// 位置共享隐私同意：查看 / 撤回（“我的 → 隐私设置”）
router.get('/privacy/location', (req, res) => {
  res.json({ code: 0, data: getLocationConsent(req.user.id) });
});
router.post('/privacy/location/withdraw', (req, res) => {
  const st = withdrawLocationConsent(req.user.id);
  // 撤回即结束所有进行中的位置共享（同时释放话权、断开实时连接，客户端会自动重连）
  require('../realtime').stopUserShares(req.user.id, 'permission');
  res.json({ code: 0, message: '已撤回。下次使用位置共享时会重新显示隐私提示。', data: st });
});

// 注销：App 内可实际完成（不能只留邮箱申请）
router.post('/delete', (req, res) => {
  const me = req.user;
  const db = load();
  // 软删除账号，保留审计必要最小数据；撤回定位核验等同意（停止对应目的处理）
  me.deletedAt = new Date().toISOString();
  me.displayName = '已注销用户';
  me.phone = null;
  // 使组织认证失效
  db.orgCerts.filter(c => c.userId === me.id).forEach(c => { c.expiredByDeparture = true; });
  // 令牌全部失效
  db.tokens = db.tokens.filter(t => t.userId !== me.id);
  // 待处理请求关闭
  db.chatRequests.filter(r => (r.fromUserId === me.id || r.toUserId === me.id) && r.status === 'pending').forEach(r => { r.status = 'closed_by_deletion'; });
  db.nameViewRequests.filter(r => (r.requesterId === me.id || r.targetId === me.id) && r.status === 'pending').forEach(r => { r.status = 'closed_by_deletion'; });
  // 实时会话：立即结束位置共享 / 释放对讲话权并断开连接
  require('../realtime').revokeUser(me.id, 'permission');
  db.auditLogs.push({ id: id('log'), action: 'account_deleted', userId: me.id, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, message: '账号注销已完成。定位核验、授权日志将按保留期限到期删除。' });
});

module.exports = router;
