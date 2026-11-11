/**
 * 午间岛 - 位置共享隐私提示的“首次同意”记录（按账号保存在服务端，换设备不重复弹出）
 *
 * - 第一次使用位置共享时弹出隐私提示，用户点“确认并开始共享”即视为接受，服务端记录 { userId, kind, version, acceptedAt }
 * - 之后再开始共享不再弹窗；隐私提示内容有实质变更时提升 LOCATION_PRIVACY_VERSION，所有人会重新看到一次
 * - 可在“我的 → 隐私设置”查看并撤回；撤回后立即结束进行中的共享，下次使用重新弹出提示
 * - 只记录“是否同意、版本、时间”，不含任何位置数据
 */
const { load, save, id } = require('../db');

const LOCATION_PRIVACY_VERSION = '2026-11-v2';
const KIND = 'location_share';

function table() {
  const db = load();
  if (!db.privacyConsents) db.privacyConsents = [];
  return db.privacyConsents;
}

function current(userId) {
  return table().filter(c => c.userId === userId && c.kind === KIND).sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : -1))[0] || null;
}

function getLocationConsent(userId) {
  const c = current(userId);
  const accepted = !!c && !c.withdrawnAt && c.version === LOCATION_PRIVACY_VERSION;
  return { accepted, version: LOCATION_PRIVACY_VERSION, acceptedAt: accepted ? c.acceptedAt : null, outdated: !!c && !c.withdrawnAt && c.version !== LOCATION_PRIVACY_VERSION };
}

function acceptLocationConsent(userId, platform) {
  const st = getLocationConsent(userId);
  if (st.accepted) return st;
  table().push({ id: id('pc'), userId, kind: KIND, version: LOCATION_PRIVACY_VERSION, acceptedAt: new Date().toISOString(), platform: platform || null, withdrawnAt: null });
  save();
  return getLocationConsent(userId);
}

function withdrawLocationConsent(userId) {
  const now = new Date().toISOString();
  let changed = false;
  for (const c of table()) if (c.userId === userId && c.kind === KIND && !c.withdrawnAt) { c.withdrawnAt = now; changed = true; }
  if (changed) save();
  return getLocationConsent(userId);
}

function consentsOf(userId) { return table().filter(c => c.userId === userId); }

module.exports = { LOCATION_PRIVACY_VERSION, getLocationConsent, acceptLocationConsent, withdrawLocationConsent, consentsOf };
