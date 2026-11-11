/** 认证路由：短信验证码登录（V1 使用 Mock，生产接入持牌短信服务商） */
const express = require('express');
const { load, save, id } = require('../db');
const { getUser } = require('../services/permissions');

const router = express.Router();

// 发送验证码
router.post('/sms-code', (req, res) => {
  const { phone } = req.body || {};
  if (!/^1\d{10}$/.test(String(phone || ''))) {
    return res.status(400).json({ code: 400, message: '手机号格式不正确' });
  }
  const db = load();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.smsCodes = db.smsCodes.filter(c => c.phone !== phone);
  db.smsCodes.push({ phone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  save();
  // 生产环境：仅通过短信下发，绝不回传。开发模式返回以便联调。
  const devReturn = process.env.NODE_ENV !== 'production';
  res.json({ code: 0, message: '验证码已发送', devCode: devReturn ? code : undefined });
});

// 登录
router.post('/login', (req, res) => {
  const { phone, code } = req.body || {};
  const db = load();
  const record = db.smsCodes.find(c => c.phone === phone && c.code === code);
  if (!record || new Date(record.expiresAt) < new Date()) {
    return res.status(400).json({ code: 400, message: '验证码错误或已过期' });
  }
  db.smsCodes = db.smsCodes.filter(c => c.phone !== phone);
  const user = db.users.find(u => u.phone === phone && !u.deletedAt);
  if (!user) {
    return res.status(404).json({ code: 404, message: '该手机号未加入任何组织，请联系企业管理员开通账号' });
  }
  const token = `tk_${id('t')}`;
  db.tokens.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  db.auditLogs.push({ id: id('log'), action: 'login', userId: user.id, createdAt: new Date().toISOString() });
  save();
  res.json({ code: 0, data: { token, userId: user.id, displayName: user.displayName } });
});

// 退出登录
router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const db = load();
    db.tokens = db.tokens.filter(t => t.token !== token);
    save();
  }
  res.json({ code: 0, message: '已退出' });
});

// 当前用户信息（含认证徽章状态）
router.get('/me', require('../middleware/auth').authRequired, (req, res) => {
  const perms = require('../services/permissions');
  const u = req.user;
  const orgCert = perms.getOrgCertStatus(u.id);
  res.json({
    code: 0,
    data: {
      id: u.id, phone: u.phone, displayName: u.displayName, avatarColor: u.avatarColor,
      realnameCertified: !!u.realnameCertified,
      org: { company: perms.getCompany(u.org.companyId)?.name, department: load().departments.find(d => d.id === u.org.departmentId)?.name },
      orgCert
    }
  });
});

module.exports = router;
