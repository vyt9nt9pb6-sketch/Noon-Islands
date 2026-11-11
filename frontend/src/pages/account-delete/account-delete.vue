<template>
  <view class="container">
    <view class="cells">
      <view class="cell access" @tap="exportData">
        <view class="cell-bd">导出我的数据</view>
        <text class="cell-ft">查阅权</text>
      </view>
    </view>
    <view class="cells-tips">可导出账号资料、组织认证记录与隐私同意记录。组织认证材料仅导出文件名等元数据，不含原件。</view>

    <!-- 注销入口放在本页较下方、较低调处，不出现在「我」页「账号与安全」行右侧 -->
    <view class="danger-wrap">
      <view class="danger-link" @tap="confirmDelete">注销账号</view>
      <view class="muted sub">
        注销将在应用内直接完成：账号信息匿名化、组织认证失效、登录态失效。
        保留审计必要的最小数据按期限到期删除。此入口依据应用商店对账号删除的强制要求提供，请谨慎操作。
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
.danger-wrap { margin: 120rpx 40rpx 40rpx; text-align: center; }
.danger-link { font-size: 26rpx; color: #B2B2B2; padding: 16rpx 0; }
.danger-link:active { color: #E64340; }
.sub { margin-top: 16rpx; line-height: 1.7; text-align: left; }
</style>
