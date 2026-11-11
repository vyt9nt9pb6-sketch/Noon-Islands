/**
 * 午间岛 - 服务端功能开关（PRD 4.1 / 8）
 * “付费查看姓名”在 iOS 端（含 iOS App）V1 整体关闭：服务端开关控制可见性。
 * 客户端在请求头携带 x-platform: android | ios | harmony | mp-weixin
 */
const PLATFORMS = ['android', 'ios', 'harmony', 'mp-weixin'];

const FLAGS = {
  paidNameView: { enabled: true, disabledPlatforms: ['ios'] }, // iOS 关闭（IAP 定性未明确前的取舍）
  realnameFee: { amount: 990, currency: 'CNY' },              // 实名认证服务费（分）
  nameViewFee: { amount: 500, currency: 'CNY' },              // 付费查看姓名（分）
  orgCertServiceFee: { enabled: false, amount: 0 },           // V1 组织认证不收费
  // 实时功能（docs/对讲与位置共享设计.md）
  walkieTalkie: { enabled: true, disabledPlatforms: [] },      // 按住说话对讲机（仅单聊）
  locationShare: { enabled: true, disabledPlatforms: [] },     // 实时位置共享（仅单聊）
  // 跨集团受限模式（仅文字）下允许的实时功能。V1 为空 = 对讲与位置共享均不可用
  restrictedModeRealtime: []
};

function normalizePlatform(p) {
  if (!p) return null;
  const s = String(p).toLowerCase();
  return PLATFORMS.find(x => s.includes(x)) || (s.includes('weixin') || s.includes('wechat') ? 'mp-weixin' : null);
}

function isFeatureEnabled(name, platform) {
  const flag = FLAGS[name];
  if (!flag) return false;
  if (flag.enabled === false) return false;
  const p = normalizePlatform(platform);
  if (flag.disabledPlatforms && p && flag.disabledPlatforms.includes(p)) return false;
  return true;
}

module.exports = { FLAGS, isFeatureEnabled, normalizePlatform };
