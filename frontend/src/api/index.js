/**
 * API 请求封装
 * 开发环境指向本地后端；生产按部署修改 BASE_URL
 * 所有请求携带 x-platform 头，供服务端功能开关判定（如 iOS 关闭付费查看姓名）
 */
import { currentPlatform } from '@/utils/platform';

// 后端地址：优先读构建环境变量 VITE_API_BASE（见 docs/部署指南.md），未设置时用下面的默认值。
// H5 同源部署（后端托管 H5 构建产物）时设 VITE_API_BASE= 空字符串即可。
const ENV_BASE = import.meta.env.VITE_API_BASE;
// #ifdef H5
export const BASE_URL = ENV_BASE !== undefined ? ENV_BASE : 'http://localhost:3000';
// #endif
// #ifndef H5
export const BASE_URL = ENV_BASE !== undefined && ENV_BASE !== '' ? ENV_BASE : 'http://192.168.1.100:3000'; // 改为你的后端局域网地址
// #endif

/** 实时通道 WebSocket 地址（http→ws, https→wss；H5 同源时取当前页面地址） */
export function wsUrl() {
  let base = BASE_URL;
  // #ifdef H5
  if (!base) base = window.location.origin;
  // #endif
  return base.replace(/^http/, 'ws') + '/ws';
}

/** 绝对地址（地图瓦片 / 字形 URL 在 renderjs 里需要完整地址） */
export function absoluteUrl(path) {
  let base = BASE_URL;
  // #ifdef H5
  if (!base) base = window.location.origin;
  // #endif
  return base + path;
}

const TOKEN_KEY = 'wjd_token';

export function getToken() {
  return uni.getStorageSync(TOKEN_KEY) || '';
}
export function setToken(t) {
  uni.setStorageSync(TOKEN_KEY, t);
}
export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY);
}

export function request({ url, method = 'GET', data = {}, silent = false }) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': getToken() ? `Bearer ${getToken()}` : '',
        'x-platform': currentPlatform()
      },
      success: (res) => {
        const body = res.data;
        if (res.statusCode === 401) {
          clearToken();
          uni.reLaunch({ url: '/pages/login/login' });
          return reject(body);
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          return resolve(body);
        }
        if (!silent) uni.showToast({ title: (body && body.message) || '请求失败', icon: 'none' });
        reject(body);
      },
      fail: (err) => {
        if (!silent) uni.showToast({ title: '网络不可用', icon: 'none' });
        reject(err);
      }
    });
  });
}

export const api = {
  // 认证
  smsCode: (phone) => request({ url: '/api/auth/sms-code', method: 'POST', data: { phone } }),
  login: (phone, code) => request({ url: '/api/auth/login', method: 'POST', data: { phone, code } }),
  emailCode: (email) => request({ url: '/api/auth/email-code', method: 'POST', data: { email } }),
  emailLogin: (email, code) => request({ url: '/api/auth/email-login', method: 'POST', data: { email, code } }),
  loginMethods: () => request({ url: '/api/auth/methods' }),
  oauthLogin: (provider, data) => request({ url: `/api/auth/oauth/${provider}`, method: 'POST', data: data || {} }),
  logout: () => request({ url: '/api/auth/logout', method: 'POST' }),
  me: () => request({ url: '/api/auth/me' }),

  // 组织
  orgStructure: () => request({ url: '/api/org/structure' }),
  searchUsers: (keyword) => request({ url: `/api/org/users/search?keyword=${encodeURIComponent(keyword || '')}` }),
  userProfile: (userId) => request({ url: `/api/org/users/${userId}` }),
  blockUser: (userId) => request({ url: `/api/org/users/${userId}/block`, method: 'POST' }),
  reportUser: (userId, reason) => request({ url: `/api/org/users/${userId}/report`, method: 'POST', data: { reason } }),
  myCompany: () => request({ url: '/api/org/my-company' }),

  // 聊天
  chats: () => request({ url: '/api/chats' }),
  chatRequest: (targetUserId, greeting) => request({ url: '/api/chats/request', method: 'POST', data: { targetUserId, greeting } }),
  chatRequests: () => request({ url: '/api/chats/requests' }),
  respondChatRequest: (rid, accept) => request({ url: `/api/chats/requests/${rid}/respond`, method: 'POST', data: { accept } }),
  chatMessages: (chatId) => request({ url: `/api/chats/${chatId}/messages` }),
  sendMessage: (chatId, type, content) => request({ url: `/api/chats/${chatId}/messages`, method: 'POST', data: { type, content } }),
  requestOrgCert: (chatId) => request({ url: `/api/chats/${chatId}/request-org-cert`, method: 'POST' }),
  blockChat: (chatId) => request({ url: `/api/chats/${chatId}/block`, method: 'POST' }),
  reportChat: (chatId, reason) => request({ url: `/api/chats/${chatId}/report`, method: 'POST', data: { reason } }),

  // 组织认证
  orgCertStatus: () => request({ url: '/api/cert/org/status' }),
  orgVerifyLocation: (lat, lng) => request({ url: '/api/cert/org/verify-location', method: 'POST', data: { lat, lng } }),
  orgSubmitDocuments: (files) => request({ url: '/api/cert/org/documents', method: 'POST', data: { files } }),

  // 实名认证与订单
  realnameStatus: () => request({ url: '/api/cert/realname/status' }),
  realnameApply: (payer, proxyUserId) => request({ url: '/api/cert/realname/apply', method: 'POST', data: { payer, proxyUserId } }),
  realnameAcceptProxy: (orderId) => request({ url: '/api/cert/realname/accept-proxy', method: 'POST', data: { orderId } }),
  orderConsent: (orderId) => request({ url: `/api/orders/${orderId}/consent`, method: 'POST' }),
  orderPay: (orderId) => request({ url: `/api/orders/${orderId}/pay`, method: 'POST' }),
  orderCancel: (orderId) => request({ url: `/api/orders/${orderId}/cancel`, method: 'POST' }),
  orderSubmit: (orderId) => request({ url: `/api/orders/${orderId}/submit`, method: 'POST' }),
  orderProviderCallback: (orderId, result) => request({ url: `/api/orders/${orderId}/provider-callback`, method: 'POST', data: { result } }),
  orders: () => request({ url: '/api/cert/orders' }),

  // 付费查看姓名
  nameViewFlag: () => request({ url: '/api/name-view/flag' }),
  nameViewRequest: (chatId) => request({ url: '/api/name-view/request', method: 'POST', data: { chatId } }),
  nameViewIncoming: () => request({ url: '/api/name-view/incoming' }),
  nameViewRespond: (rid, accept) => request({ url: `/api/name-view/incoming/${rid}/respond`, method: 'POST', data: { accept } }),
  nameViewRevealed: (chatId) => request({ url: `/api/name-view/revealed/${chatId}` }),

  // 地图 / 位置共享（V1.2：OSM 底图配置，不含任何 key）
  mapConfig: () => request({ url: '/api/map/config' }),
  locationPrivacy: () => request({ url: '/api/account/privacy/location', silent: true }),
  withdrawLocationPrivacy: () => request({ url: '/api/account/privacy/location/withdraw', method: 'POST' }),

  // 账号
  accountDelete: () => request({ url: '/api/account/delete', method: 'POST' }),
  accountExport: () => request({ url: '/api/account/export' })
};
