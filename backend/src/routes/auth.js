/** 认证路由：短信验证码登录；邮箱验证码登录/注册；第三方登录预留钩子（未配置不得假装成功） */
const express = require('express');
const { load, save, id } = require('../db');
const { mailConfigured, sendLoginCode } = require('../services/mail');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const AVATAR_COLORS = ['#4C7DFF', '#27BA6E', '#FF9F43', '#8A6DFF', '#E64340', '#09BB07', '#576B95'];
const isProd = () => process.env.NODE_ENV === 'production';

function issueToken(db, user, action) {
  const token = `tk_${id('t')}`;
  db.tokens.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  db.auditLogs.push({ id: id('log'), action, userId: user.id, createdAt: new Date().toISOString() });
  save();
  return { token, userId: user.id, displayName: user.displayName };
}

function oauthConfigured(provider) {
  if (provider === 'wechat') return !!(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
  if (provider === 'apple') return !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
  if (provider === 'alipay') return !!(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY);
  return false;
}

router.get('/methods', (req, res) => {
  res.json({
    code: 0,
    data: {
      phone: true,
      email: true,
      wechat: oauthConfigured('wechat'),
      apple: oauthConfigured('apple'),
      alipay: oauthConfigured('alipay')
    }
  });
});

// 发送短信验证码（既有手机登录，生产需接入持牌短信服务商）
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
  const devReturn = !isProd();
  res.json({ code: 0, message: '验证码已发送', devCode: devReturn ? code : undefined });
});

// 手机号 + 短信验证码登录（不自动注册；账号需已加入组织）
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
  res.json({ code: 0, data: issueToken(db, user, 'login') });
});

// 发送邮箱验证码（阿里云邮件推送）。生产未配置凭证时不得假装发送成功。
router.post('/email-code', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
  const db = load();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.emailCodes = (db.emailCodes || []).filter(c => c.email !== email);
  db.emailCodes.push({ email, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  save();

  if (isProd() || mailConfigured()) {
    try {
      await sendLoginCode(email, code);
    } catch (e) {
      db.emailCodes = db.emailCodes.filter(c => c.email !== email);
      save();
      const notCfg = e && e.code === 'mail_not_configured';
      return res.status(notCfg ? 503 : 502).json({
        code: notCfg ? 503 : 502,
        message: notCfg ? '邮箱登录尚未开通：请管理员配置阿里云邮件推送后再试' : '验证邮件发送失败，请稍后重试'
      });
    }
  }
  // 非生产且未配置推送：与短信 devCode 一样，只在联调返回验证码，方便本地 / e2e
  res.json({ code: 0, message: '验证码已发送', devCode: !isProd() ? code : undefined });
});

// 邮箱验证码登录或注册（无密码）。已有账号则登录；没有则创建账号（尚未加入组织）。
router.post('/email-login', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const { code } = req.body || {};
  if (!EMAIL_RE.test(email)) return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
  const db = load();
  const record = (db.emailCodes || []).find(c => c.email === email && c.code === code);
  if (!record || new Date(record.expiresAt) < new Date()) {
    return res.status(400).json({ code: 400, message: '验证码错误或已过期' });
  }
  db.emailCodes = db.emailCodes.filter(c => c.email !== email);
  let user = db.users.find(u => u.email === email && !u.deletedAt);
  let created = false;
  if (!user) {
    const local = email.split('@')[0].replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '').slice(0, 20) || '用户';
    user = {
      id: id('u'), email, phone: null, realName: '', realnameCertified: false,
      displayName: local, avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      org: { companyId: null, departmentId: null },
      registeredAt: new Date().toISOString(), registeredVia: 'email'
    };
    db.users.push(user);
    created = true;
  }
  const data = issueToken(db, user, created ? 'register_email' : 'login_email');
  res.json({ code: 0, data: { ...data, created } });
});

// 第三方登录预留：未配置完整凭证时一律明确「尚未开通」，绝不签发登录态。
// 配置后：微信开放平台 / Sign in with Apple / 支付宝开放平台 的回调在此核验 identity token 再绑定或创建账号。
router.post('/oauth/:provider', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!['wechat', 'apple', 'alipay'].includes(provider)) {
    return res.status(400).json({ code: 400, message: '不支持的登录方式' });
  }
  if (!oauthConfigured(provider)) {
    return res.status(503).json({ code: 503, message: '该登录方式尚未开通', notConfigured: true, provider });
  }
  // 已配置时的接入点（凭据配齐后再实现身份令牌核验，当前不签发登录态，避免半成品误登录）
  return res.status(501).json({ code: 501, message: '该登录方式正在接入，请先使用手机号或邮箱验证码', provider });
});

router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const db = load();
    const rec = db.tokens.find(t => t.token === token);
    db.tokens = db.tokens.filter(t => t.token !== token);
    save();
    if (rec && !db.tokens.some(t => t.userId === rec.userId)) require('../realtime').revokeUser(rec.userId, 'logout');
  }
  res.json({ code: 0, message: '已退出' });
});

router.get('/me', require('../middleware/auth').authRequired, (req, res) => {
  const perms = require('../services/permissions');
  const u = req.user;
  const orgCert = perms.getOrgCertStatus(u.id);
  const company = u.org && u.org.companyId ? perms.getCompany(u.org.companyId) : null;
  const dept = u.org && u.org.departmentId ? load().departments.find(d => d.id === u.org.departmentId) : null;
  res.json({
    code: 0,
    data: {
      id: u.id, phone: u.phone || '', email: u.email || '', displayName: u.displayName, avatarColor: u.avatarColor,
      realnameCertified: !!u.realnameCertified,
      org: { company: company?.name || '', department: dept?.name || '' },
      orgCert
    }
  });
});

module.exports = router;
