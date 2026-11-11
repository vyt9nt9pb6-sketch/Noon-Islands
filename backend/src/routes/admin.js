/** 管理路由：离职联动（组织认证立即失效）、替代认证管理员确认 */
const express = require('express');
const { load, save, id } = require('../db');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();
router.use(adminRequired);

// 标记员工离职：组织认证立即失效，不等 6 个月周期（PRD 2.4）
router.post('/users/:userId/depart', (req, res) => {
  const db = load();
  const user = db.users.find(u => u.id === req.params.userId && !u.deletedAt);
  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
  user.departed = true;
  db.orgCerts.filter(c => c.userId === user.id).forEach(c => { c.expiredByDeparture = true; });
  db.auditLogs.push({ id: id('log'), action: 'user_departed', userId: user.id, operatorId: req.user.id, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, message: `已标记 ${user.displayName} 离职，其组织认证立即失效，新消息发送被阻断` });
});

// 待管理员确认的邮箱验证替代认证申请
router.get('/fallback-requests', (req, res) => {
  const db = load();
  const list = db.fallbackRequests.filter(f => f.status === 'email_verified').map(f => {
    const u = db.users.find(x => x.id === f.userId);
    return { id: f.id, userId: f.userId, userName: u?.displayName, companyEmail: f.companyEmail, createdAt: f.createdAt };
  });
  res.json({ code: 0, data: list });
});

// 管理员确认通过 → 组织认证生效 6 个月
router.post('/fallback-requests/:id/approve', (req, res) => {
  const db = load();
  const fr = db.fallbackRequests.find(f => f.id === req.params.id && f.status === 'email_verified');
  if (!fr) return res.status(404).json({ code: 404, message: '申请不存在或状态不允许' });
  const user = db.users.find(u => u.id === fr.userId);
  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
  fr.status = 'approved';
  fr.adminConfirmed = true;
  db.orgCerts.push({
    id: id('oc'), userId: user.id, companyId: user.org.companyId, method: 'fallback',
    withinRadius: null, verifiedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
    expiredByDeparture: false
  });
  db.auditLogs.push({ id: id('log'), action: 'org_cert_fallback_approved', userId: user.id, operatorId: req.user.id, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, message: '已确认，组织认证生效（6 个月）' });
});

// 待处理举报（内容安全运营）
router.get('/reports', (req, res) => {
  res.json({ code: 0, data: load().reports });
});

module.exports = router;
