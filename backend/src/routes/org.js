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
  if (companyId) list = list.filter(u => u.org.companyId === companyId);
  if (departmentId) list = list.filter(u => u.org.departmentId === departmentId);
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
      company: getCompany(u.org.companyId)?.name,
      department: db.departments.find(d => d.id === u.org.departmentId)?.name,
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
  const company = getCompany(me.org.companyId);
  if (!company) return res.status(404).json({ code: 404, message: '未找到所属公司' });
  res.json({
    code: 0,
    data: {
      id: company.id, name: company.name, radiusMeters: company.radiusMeters,
      addressLabel: company.registeredAddress.label
    }
  });
});

module.exports = router;
