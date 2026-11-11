/**
 * API 请求封装
 * 开发环境指向本地后端；生产按部署修改 BASE_URL
 * 所有请求携带 x-platform 头，供服务端功能开关判定（如 iOS 关闭付费查看姓名）
 */
import { currentPlatform } from '@/utils/platform';

// #ifdef H5
export const BASE_URL = 'http://localhost:3000';
// #endif
// #ifndef H5
export const BASE_URL = 'http://192.168.1.100:3000'; // 改为你的后端局域网地址
// #endif

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

export function request({ url, method = 'GET', data = {} }) {
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
        uni.showToast({ title: (body && body.message) || '请求失败', icon: 'none' });
        reject(body);
      },
      fail: (err) => {
        uni.showToast({ title: '网络不可用', icon: 'none' });
        reject(err);
      }
    });
  });
}

export const api = {
  // 认证
  smsCode: (phone) => request({ url: '/api/auth/sms-code', method: 'POST', data: { phone } }),
  login: (phone, code) => request({ url: '/api/auth/login', method: 'POST', data: { phone, code } }),
  logout: () => request({ url: '/api/auth/logout', method: 'POST' }),
  me: () => request({ url: '/api/auth/me' }),

  // 组织
  orgStructure: () => request({ url: '/api/org/structure' }),
  searchUsers: (keyword) => request({ url: `/api/org/users/search?keyword=${encodeURIComponent(keyword || '')}` }),
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
  orgFallbackRequest: (companyEmail) => request({ url: '/api/cert/org/fallback/request', method: 'POST', data: { companyEmail } }),
  orgFallbackVerify: (code) => request({ url: '/api/cert/org/fallback/verify', method: 'POST', data: { code } }),

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

  // 账号
  accountDelete: () => request({ url: '/api/account/delete', method: 'POST' }),
  accountExport: () => request({ url: '/api/account/export' })
};
