/**
 * 午间岛 - 实时功能（对讲机 / 位置共享）权限判定
 *
 * 规则（详见 docs/对讲与位置共享设计.md §3）：
 * - 仅限 1 对 1 会话，且请求者必须是会话成员
 * - 发送阻断（组织认证过期 / 离职）→ 对讲与位置共享同样阻断
 * - 任一方屏蔽了对方 → 阻断
 * - 跨集团受限模式（仅文字）→ 对讲与位置共享默认不可用（FLAGS.restrictedModeRealtime 控制，V1 = 不允许）
 * - 服务端功能开关可按平台关闭
 */
const { load } = require('../db');
const { getUser, canSendMessage } = require('./permissions');
const { FLAGS, isFeatureEnabled } = require('./flags');

const FEATURE_LABEL = { walkieTalkie: '对讲', locationShare: '位置共享' };

function findChat(chatId, userId) {
  const chat = load().chats.find(c => c.id === chatId);
  if (!chat || !chat.memberIds.includes(userId)) return null;
  return chat;
}

/**
 * @param {string} feature 'walkieTalkie' | 'locationShare'
 * @returns {{allowed:boolean, code?:string, reason?:string, chat?:object, peerId?:string}}
 */
function canUseRealtime(chatId, userId, feature, platform) {
  const chat = findChat(chatId, userId);
  if (!chat) return { allowed: false, code: 'not_member', reason: '会话不存在' };
  if (chat.memberIds.length !== 2) return { allowed: false, code: 'not_one_to_one', reason: `${FEATURE_LABEL[feature]}仅支持单聊` };
  const peerId = chat.memberIds.find(m => m !== userId);
  if (!getUser(peerId)) return { allowed: false, code: 'peer_gone', reason: '对方账号不存在或已注销', chat, peerId };
  if (!isFeatureEnabled(feature, platform)) {
    return { allowed: false, code: 'feature_disabled', reason: `${FEATURE_LABEL[feature]}功能暂未开放`, chat, peerId };
  }
  const send = canSendMessage(chat, userId);
  if (!send.allowed) return { allowed: false, code: 'send_blocked', reason: send.reason, chat, peerId };
  const blocks = load().blocks;
  if (blocks.find(b => (b.userId === peerId && b.blockedUserId === userId) || (b.userId === userId && b.blockedUserId === peerId))) {
    return { allowed: false, code: 'blocked', reason: '会话已被屏蔽', chat, peerId };
  }
  if (send.restricted && !FLAGS.restrictedModeRealtime.includes(feature)) {
    return {
      allowed: false, code: 'restricted', chat, peerId,
      reason: `受限模式下仅支持文字消息，双方完成组织认证后解锁${FEATURE_LABEL[feature]}`
    };
  }
  return { allowed: true, chat, peerId };
}

module.exports = { canUseRealtime, findChat };
