/** 认证中间件：Bearer token → req.user */
const { load } = require('../db');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ code: 401, message: '未登录' });
  const record = load().tokens.find(t => t.token === token);
  const user = record && load().users.find(u => u.id === record.userId && !u.deletedAt);
  if (!user) return res.status(401).json({ code: 401, message: '登录已失效' });
  req.user = user;
  req.platform = req.headers['x-platform'] || null;
  next();
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ code: 403, message: '需要管理员权限' });
    next();
  });
}

module.exports = { authRequired, adminRequired };
