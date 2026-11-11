/** 实时通道单例：供 HTTP 路由在屏蔽 / 注销 / 退出登录时即时结束对讲与位置共享 */
let hub = null;
module.exports = {
  setHub(h) { hub = h; },
  getHub() { return hub; },
  revokeUser(userId, reason) { if (hub) hub.revokeUser(userId, reason); },
  revokeChat(chatId) { if (hub) hub.revokeChat(chatId); },
  stopUserShares(userId, reason) { if (hub) hub.stopUserShares(userId, reason); }
};
