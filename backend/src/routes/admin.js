/** 管理路由：离职联动（组织认证立即失效）；原邮箱替代路径管理员确认已停用 */
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

// 原「企业邮箱 + 管理员确认」已由材料上传替代，不再经管理员审核
router.get('/fallback-requests', (req, res) => {
  res.status(410).json({ code: 410, message: '该路径已停用，组织认证方式二改为上传劳动合同和工牌，不再经管理员确认', data: [] });
});
router.post('/fallback-requests/:id/approve', (req, res) => {
  res.status(410).json({ code: 410, message: '该路径已停用，组织认证方式二改为上传劳动合同和工牌，不再经管理员确认' });
});

// 待处理举报（内容安全运营）
router.get('/reports', (req, res) => {
  res.json({ code: 0, data: load().reports });
});

module.exports = router;
