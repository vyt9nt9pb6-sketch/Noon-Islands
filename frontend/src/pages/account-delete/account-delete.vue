<template>
  <view class="container">
    <view class="card">
      <view class="title">账号与安全</view>
      <view class="btn-primary ghost" @tap="exportData">导出我的数据（查阅权）</view>
      <view class="btn-warn" @tap="confirmDelete">注销账号</view>
      <view class="muted sub">
        注销将在应用内直接完成：账号信息匿名化、组织认证失效、登录态失效。
        保留审计必要的最小数据按期限到期删除。此入口依据应用商店对账号删除的强制要求提供。
      </view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';
import { logout } from '@/store/user';

export default {
  methods: {
    async exportData() {
      const res = await api.accountExport();
      uni.showModal({
        title: '我的数据',
        content: JSON.stringify(res.data).slice(0, 800) + '……（完整数据见后端 /api/account/export）',
        showCancel: false
      });
    },
    confirmDelete() {
      uni.showModal({
        title: '注销账号',
        content: '注销是不可逆操作：账号将被匿名化，组织认证立即失效，待处理请求全部关闭。确认继续？',
        confirmText: '仍要注销',
        confirmColor: '#e64a3a',
        success: async (m) => {
          if (!m.confirm) return;
          const res = await api.accountDelete();
          uni.showToast({ title: res.message || '已注销', icon: 'none' });
          setTimeout(() => logout(), 1500);
        }
      });
    }
  }
};
</script>

<style>
.title { font-size: 32rpx; font-weight: 700; margin-bottom: 16rpx; }
.ghost { background: #e8f3ff; color: #4c7dff; }
.sub { margin-top: 20rpx; line-height: 1.7; }
</style>
