/** 轻量全局用户状态（响应式） */
import { reactive } from 'vue';
import { api, getToken, clearToken } from '@/api';
import { disposeAllRealtime } from '@/realtime/session';

export const userStore = reactive({
  token: getToken(),
  profile: null,
  nameViewEnabled: true
});

export async function refreshProfile() {
  if (!userStore.token) return null;
  try {
    const res = await api.me();
    userStore.profile = res.data;
    return res.data;
  } catch (e) {
    userStore.profile = null;
    return null;
  }
}

export async function refreshNameViewFlag() {
  try {
    const res = await api.nameViewFlag();
    userStore.nameViewEnabled = !!res.data.enabled;
  } catch (e) {
    userStore.nameViewEnabled = false;
  }
}

export function logout() {
  disposeAllRealtime(); // 立即结束对讲与位置共享
  api.logout().catch(() => {});
  clearToken();
  userStore.token = '';
  userStore.profile = null;
  uni.reLaunch({ url: '/pages/login/login' });
}
