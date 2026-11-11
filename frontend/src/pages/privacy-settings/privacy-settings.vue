<template>
  <view class="container">
    <view class="cells-title">位置共享</view>
    <view class="cells">
      <view class="cell">
        <view class="cell-bd">隐私提示授权</view>
        <text :class="['cell-ft', st.accepted ? 'ok' : '']">{{ statusText }}</text>
      </view>
      <view v-if="st.accepted" class="cell">
        <view class="cell-bd">同意时间</view>
        <text class="cell-ft">{{ formatTime(st.acceptedAt) }}</text>
      </view>
      <view class="cell">
        <view class="cell-bd">提示版本</view>
        <text class="cell-ft">{{ st.version || '-' }}</text>
      </view>
      <view class="cell access" @tap="showNotice = !showNotice">
        <view class="cell-bd">查看隐私提示全文</view>
      </view>
    </view>
    <view v-if="showNotice" class="notice">
      <view v-for="p in points" :key="p.k" class="np"><text class="nk">{{ p.k }}</text><text class="nv">{{ p.v }}</text></view>
    </view>
    <view class="cells-tips">
      位置共享只在第一次使用时弹出隐私提示，你确认后即视为同意，之后开始共享不会再询问。授权记录（是否同意、时间、版本）保存在服务器上并跟随账号；位置数据本身不保存，停止或退出共享即删除。
    </view>
    <view v-if="st.accepted" class="btn-warn" @tap="withdraw">撤回位置共享授权</view>
    <view v-else class="cells-tips muted-center">尚未授权。下次在聊天里使用“位置共享”时会先显示隐私提示。</view>
  </view>
</template>

<script>
import { api } from '@/api';
import { LOCATION_NOTICE_POINTS } from '@/realtime/privacy-notice';

export default {
  data() { return { st: { accepted: false, version: '', acceptedAt: null }, showNotice: false, points: LOCATION_NOTICE_POINTS, loaded: false }; },
  computed: {
    statusText() { if (!this.loaded) return '读取中…'; return this.st.accepted ? '已同意' : this.st.outdated ? '提示已更新，需重新确认' : '未授权'; }
  },
  onShow() { this.load(); },
  methods: {
    async load() {
      try { const r = await api.locationPrivacy(); this.st = r.data; } catch (e) { /* 网络错误时保持原状 */ }
      this.loaded = true;
    },
    formatTime(iso) {
      if (!iso) return '';
      const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    withdraw() {
      uni.showModal({
        title: '撤回位置共享授权',
        content: '撤回后，你正在进行的位置共享会立即结束；下次使用时会重新显示隐私提示。',
        confirmText: '撤回', confirmColor: '#E64340',
        success: async (m) => {
          if (!m.confirm) return;
          const r = await api.withdrawLocationPrivacy();
          this.st = r.data;
          uni.showToast({ title: '已撤回', icon: 'success' });
        }
      });
    }
  }
};
</script>

<style>
.ok { color: #09BB07; }
.notice { background: #fff; margin-top: 20rpx; padding: 10rpx 30rpx 20rpx; border-top: 1rpx solid #D9D9D9; border-bottom: 1rpx solid #D9D9D9; }
.np { padding: 14rpx 0; font-size: 27rpx; line-height: 1.55; display: flex; flex-direction: column; }
.nk { color: #000; font-weight: 600; }
.nv { color: #555; }
.muted-center { text-align: center; padding-top: 40rpx; }
</style>
