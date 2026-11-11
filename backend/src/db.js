/**
 * 午间岛 - 数据层
 * V1 采用 JSON 文件持久化（零原生依赖，开箱即用）。
 * 生产环境请替换为 PostgreSQL / MySQL（接口保持不变，仅替换 load/save 与查询实现）。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = () => ({
  meta: { version: 1, createdAt: new Date().toISOString() },
  groups: [],        // 集团 { id, name }
  companies: [],     // 公司 { id, groupId, name, registeredAddress: {lat,lng,label}, radiusMeters, domains: [] }
  departments: [],   // 部门 { id, companyId, name }
  users: [],         // 员工账号 { id, phone, realName, realnameCertified, org: {companyId, departmentId}, displayName, avatarColor, deletedAt }
  tokens: [],        // { token, userId, createdAt }
  smsCodes: [],      // { phone, code, expiresAt }
  chats: [],         // { id, memberIds: [a,b], relation, createdAt, restrictedAtStart }
  chatRequests: [],  // { id, fromUserId, toUserId, status: pending|accepted|rejected, relation, createdAt }
  messages: [],      // { id, chatId, fromUserId, type: text|file|voice|video|system, content, createdAt }
  orgCerts: [],      // { id, userId, companyId, method: location|fallback, withinRadius(bool,仅定位方式), verifiedAt, validUntil, expiredByDeparture }
  orgCertAttempts: [], // { userId, failedAt } —— 24h 内失败计数
  fallbackRequests: [], // { id, userId, companyEmail, verifyCode, emailVerified, adminConfirmed, createdAt, status }
  realnameCerts: [],   // { id, userId, provider, providerFlowNo, status, submittedAt }
  orders: [],          // { id, kind: realname|nameview, payerUserId, payeeUserId(被认证人/被查看人), amount, consentedIrrevocable, status, payTime, submitTime, result, refundAmount }
  nameViewRequests: [], // { id, chatId, requesterId, targetId, status: pending|accepted|rejected|refunded, createdAt, respondedAt }
  nameViewLogs: [],     // 审计日志 { id, requesterId, targetId, action, chatId, createdAt }
  blocks: [],           // { id, userId, blockedUserId, createdAt }
  reports: [],          // { id, chatId, reporterId, reason, createdAt }
  auditLogs: []         // 全局审计
});

let db = null;

function load() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = Object.assign(EMPTY(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
      return db;
    } catch (e) {
      console.error('[db] 数据文件损坏，重建：', e.message);
    }
  }
  db = EMPTY();
  seed();
  save();
  return db;
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- 种子数据：2 个集团 / 3 家公司 / 5 个账号 ---------------- */
function seed() {
  const g1 = { id: 'grp_chenxi', name: '晨曦集团' };
  const g2 = { id: 'grp_yuanyang', name: '远洋集团' };
  db.groups.push(g1, g2);

  const cA = { id: 'comp_dawn_tech', groupId: g1.id, name: '晨曦科技', radiusMeters: 500, domains: ['dawn-tech.example.cn'], registeredAddress: { lat: 39.9042, lng: 116.4074, label: '北京市东城区晨曦大厦' } };
  const cB = { id: 'comp_dawn_media', groupId: g1.id, name: '晨曦传媒', radiusMeters: 500, domains: ['dawn-media.example.cn'], registeredAddress: { lat: 31.2304, lng: 121.4737, label: '上海市黄浦区晨曦传媒中心' } };
  const cC = { id: 'comp_ocean_logi', groupId: g2.id, name: '远洋物流', radiusMeters: 500, domains: ['ocean-logi.example.cn'], registeredAddress: { lat: 22.5431, lng: 114.0579, label: '深圳市福田区远洋大厦' } };
  db.companies.push(cA, cB, cC);

  db.departments.push(
    { id: 'dept_tech_rd', companyId: cA.id, name: '研发部' },
    { id: 'dept_tech_hr', companyId: cA.id, name: '人事部' },
    { id: 'dept_media_ed', companyId: cB.id, name: '编辑部' },
    { id: 'dept_logi_op', companyId: cC.id, name: '运营部' }
  );

  db.users.push(
    { id: 'u_alice', phone: '13800000001', realName: '张伟', realnameCertified: false, displayName: 'Alice', avatarColor: '#4C7DFF', org: { companyId: cA.id, departmentId: 'dept_tech_rd' } },
    { id: 'u_bob', phone: '13800000002', realName: '李娜', realnameCertified: true, displayName: 'Bob', avatarColor: '#27BA6E', org: { companyId: cA.id, departmentId: 'dept_tech_hr' } },
    { id: 'u_carol', phone: '13800000003', realName: '王芳', realnameCertified: false, displayName: 'Carol', avatarColor: '#FF9F43', org: { companyId: cB.id, departmentId: 'dept_media_ed' } },
    { id: 'u_dave', phone: '13800000004', realName: '赵磊', realnameCertified: false, displayName: 'Dave', avatarColor: '#8A6DFF', org: { companyId: cC.id, departmentId: 'dept_logi_op' } },
    { id: 'u_admin', phone: '13900000000', realName: '系统管理员', realnameCertified: true, displayName: 'Admin', avatarColor: '#666666', isAdmin: true, org: { companyId: cA.id, departmentId: 'dept_tech_hr' } }
  );

  // 预置：Bob 已通过组织认证（6 个月有效）
  const now = Date.now();
  db.orgCerts.push({
    id: id('oc'), userId: 'u_bob', companyId: cA.id, method: 'fallback',
    withinRadius: null, verifiedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 180 * 24 * 3600 * 1000).toISOString(), expiredByDeparture: false
  });

  db.auditLogs.push({ id: id('log'), action: 'seed', createdAt: new Date().toISOString() });
}

module.exports = { load, save, id, DATA_FILE };
