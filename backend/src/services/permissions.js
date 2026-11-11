/**
 * 午间岛 - 聊天权限矩阵（PRD 2.2 / 2.3 / 2.4）
 *
 * 关系          | 搜索    | 发起聊天前置               | 受限模式
 * ------------- | ------- | -------------------------- | --------
 * 同公司        | 可搜到  | 直接可聊                   | 否
 * 同集团跨公司  | 可搜到  | 双方组织认证有效 + 对方接受 | 否（接受后正常）
 * 跨集团        | 可搜到  | 需申请，对方接受           | 双方均未完成组织认证时受限
 */
const { load } = require('../db');

function getUser(userId) {
  return load().users.find(u => u.id === userId && !u.deletedAt) || null;
}

function getCompany(companyId) {
  return load().companies.find(c => c.id === companyId) || null;
}

/** 组织认证状态：PRD 2.4（6 个月有效期 / 离职立即失效） */
function getOrgCertStatus(userId) {
  const db = load();
  const user = getUser(userId);
  if (!user) return { certified: false, reason: 'no_user' };
  const companyId = user.org && user.org.companyId;
  if (!companyId) return { certified: false, reason: 'no_org' };
  const cert = db.orgCerts
    .filter(c => c.userId === userId && c.companyId === companyId)
    .sort((a, b) => new Date(b.verifiedAt) - new Date(a.verifiedAt))[0];
  if (!cert) return { certified: false, reason: 'not_certified' };
  if (cert.expiredByDeparture) return { certified: false, reason: 'departed', validUntil: cert.validUntil };
  if (new Date(cert.validUntil) <= new Date()) return { certified: false, reason: 'expired', validUntil: cert.validUntil };
  return { certified: true, validUntil: cert.validUntil, method: cert.method, verifiedAt: cert.verifiedAt };
}

/** 两用户关系判定 */
function relationBetween(userA, userB) {
  if (!userA || !userB) return 'unknown';
  const ca = userA.org && userA.org.companyId, cb = userB.org && userB.org.companyId;
  if (!ca || !cb) return 'cross_group';
  if (ca === cb) return 'same_company';
  const ga = getCompany(ca)?.groupId, gb = getCompany(cb)?.groupId;
  if (ga && ga === gb) return 'same_group_cross_company';
  return 'cross_group';
}

/**
 * 会话受限模式：PRD 2.3 —— 仅适用于跨集团会话；
 * 仅在双方均完成组织认证后解除；任一方单方认证不自动升级。
 */
function isRestricted(chat) {
  const [a, b] = chat.memberIds;
  const relation = relationBetween(getUser(a), getUser(b));
  if (relation !== 'cross_group') return false;
  return !(getOrgCertStatus(a).certified && getOrgCertStatus(b).certified);
}

/** 发起聊天前置校验 */
function canInitiateChat(initiator, target) {
  const relation = relationBetween(initiator, target);
  if (relation === 'same_company') {
    return { allowed: true, needRequest: false, relation, restricted: false, reason: null };
  }
  if (relation === 'same_group_cross_company') {
    // 硬性门槛：任一方组织认证未完成或已过期，申请入口置灰
    const aCert = getOrgCertStatus(initiator.id);
    const bCert = getOrgCertStatus(target.id);
    const missing = [];
    if (!aCert.certified) missing.push(initiator.displayName);
    if (!bCert.certified) missing.push(target.displayName);
    if (missing.length) {
      return {
        allowed: false, needRequest: true, relation, restricted: true,
        reason: `需双方完成组织认证后方可申请聊天（未认证：${missing.join('、')}）`
      };
    }
    return { allowed: true, needRequest: true, relation, restricted: false, reason: null };
  }
  if (relation === 'cross_group') {
    return { allowed: true, needRequest: true, relation, restricted: true, reason: null };
  }
  return { allowed: false, needRequest: false, relation: 'unknown', restricted: true, reason: '关系未知' };
}

/**
 * 消息发送校验：
 * - 组织认证到期/离职 → 新消息发送被阻断（历史消息保留可读，PRD 2.4）
 * - 跨集团未认证（先聊后认证）→ 受限模式下仅文字可用（PRD 2.3）
 */
function canSendMessage(chat, senderId) {
  const sender = getUser(senderId);
  if (!sender) return { allowed: false, reason: '账号不存在或已注销' };
  const status = getOrgCertStatus(senderId);
  if (!status.certified && (status.reason === 'expired' || status.reason === 'departed')) {
    const why = status.reason === 'expired' ? '组织认证已过期' : '组织关系已失效（离职）';
    return { allowed: false, reason: `${why}，新消息发送已阻断。历史消息保留可读。` };
  }
  return { allowed: true, restricted: isRestricted(chat), reason: null };
}

module.exports = { getUser, getCompany, getOrgCertStatus, relationBetween, isRestricted, canInitiateChat, canSendMessage };
