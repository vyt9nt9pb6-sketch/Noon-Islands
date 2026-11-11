/** 组织路由：集团→公司→部门架构、人员搜索（PRD 2.1 / 2.2） */
const express = require('express');
const { load, save, id } = require('../db');
const { authRequired } = require('../middleware/auth');
const { getUser, getCompany, getOrgCertStatus, relationBetween, canInitiateChat } = require('../services/permissions');

const router = express.Router();
router.use(authRequired);

// 完整组织架构树
router.get('/structure', (req, res) => {
  const db = load();
  const tree = db.groups.map(g => ({
    id: g.id, name: g.name,
    companies: db.companies.filter(c => c.groupId === g.id).map(c => ({
      id: c.id, name: c.name,
      departments: db.departments.filter(d => d.companyId === c.id).map(d => ({
        id: d.id, name: d.name,
        memberCount: db.users.filter(u => !u.deletedAt && u.org?.departmentId === d.id).length
      }))
    }))
  }));
  res.json({ code: 0, data: tree });
});

// 人员搜索（默认可搜到全部组织内人员）
router.get('/users/search', (req, res) => {
  const { keyword, companyId, departmentId } = req.query;
  const me = req.user;
  const db = load();
  let list = db.users.filter(u => !u.deletedAt && u.id !== me.id && !u.isAdmin);
  if (companyId) list = list.filter(u => u.org && u.org.companyId === companyId);
  if (departmentId) list = list.filter(u => u.org && u.org.departmentId === departmentId);
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    list = list.filter(u => u.displayName.toLowerCase().includes(kw));
  }
  const data = list.map(u => {
    const relation = relationBetween(me, u);
    const cert = getOrgCertStatus(u.id);
    const initiation = canInitiateChat(me, u);
    return {
      id: u.id, displayName: u.displayName, avatarColor: u.avatarColor,
      company: getCompany(u.org && u.org.companyId)?.name,
      department: db.departments.find(d => d.id === (u.org && u.org.departmentId))?.name,
      realnameCertified: !!u.realnameCertified,
      orgCertified: cert.certified,
      relation,
      chatPermission: {
        canInitiate: initiation.allowed,
        needRequest: initiation.needRequest,
        reason: initiation.reason
      }
    };
  });
  res.json({ code: 0, data });
});

// 我的公司注册地址（用于组织认证距离核验的展示；坐标仅核验用，不下发历史）
router.get('/my-company', (req, res) => {
  const me = req.user;
  const company = getCompany(me.org && me.org.companyId);
  if (!company) return res.status(404).json({ code: 404, message: '未找到所属公司' });
  res.json({
    code: 0,
    data: {
      id: company.id, name: company.name, radiusMeters: company.radiusMeters,
      addressLabel: company.registeredAddress.label
    }
  });
});


// 好友 / 个人资料（聊天点头像、通讯录点人、我的页顶栏进入同一页）
router.get('/users/:id', (req, res) => {
  const me = req.user;
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ code: 404, message: '用户不存在' });
  const db = load();
  const self = u.id === me.id;
  const relation = self ? 'self' : relationBetween(me, u);
  const cert = getOrgCertStatus(u.id);
  const initiation = self ? { allowed: false, needRequest: false, reason: null } : canInitiateChat(me, u);
  const blocked = !self && !!db.blocks.find(b => b.userId === me.id && b.blockedUserId === u.id);
  const chat = self ? null : db.chats.find(c => c.memberIds.includes(me.id) && c.memberIds.includes(u.id));
  res.json({
    code: 0,
    data: {
      id: u.id, displayName: u.displayName, avatarColor: u.avatarColor, self,
      company: getCompany(u.org && u.org.companyId)?.name || '',
      department: (db.departments.find(d => d.id === (u.org && u.org.departmentId)) || {}).name || '',
      realnameCertified: !!u.realnameCertified,
      orgCertified: cert.certified,
      orgCert: cert,
      relation,
      chatId: chat ? chat.id : null,
      blocked,
      chatPermission: {
        canInitiate: initiation.allowed,
        needRequest: initiation.needRequest,
        reason: initiation.reason
      }
    }
  });
});

router.post('/users/:id/block', (req, res) => {
  const me = req.user;
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ code: 404, message: '用户不存在' });
  if (u.id === me.id) return res.status(400).json({ code: 400, message: '不能屏蔽自己' });
  const db = load();
  if (!db.blocks.find(b => b.userId === me.id && b.blockedUserId === u.id)) {
    db.blocks.push({ id: id('blk'), userId: me.id, blockedUserId: u.id, createdAt: new Date().toISOString() });
  }
  const chat = db.chats.find(c => c.memberIds.includes(me.id) && c.memberIds.includes(u.id));
  if (chat) {
    const { sysMessage } = require('./chat');
    // sysMessage may not be exported; write inline
    db.messages.push({ id: id('msg'), chatId: chat.id, fromUserId: 'system', type: 'system', content: `${me.displayName} 已屏蔽该会话`, createdAt: new Date().toISOString() });
    save();
    require('../realtime').revokeChat(chat.id);
  } else save();
  res.json({ code: 0, message: '已屏蔽' });
});

router.post('/users/:id/report', (req, res) => {
  const me = req.user;
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ code: 404, message: '用户不存在' });
  if (u.id === me.id) return res.status(400).json({ code: 400, message: '不能举报自己' });
  const { reason } = req.body || {};
  const db = load();
  const chat = db.chats.find(c => c.memberIds.includes(me.id) && c.memberIds.includes(u.id));
  db.reports.push({
    id: id('rpt'), chatId: chat ? chat.id : null, targetUserId: u.id,
    reporterId: me.id, reason: String(reason || '').slice(0, 200), createdAt: new Date().toISOString()
  });
  save();
  res.json({ code: 0, message: '举报已受理，平台将尽快核实处理' });
});

module.exports = router;
