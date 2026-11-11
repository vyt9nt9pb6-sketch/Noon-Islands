<template>
  <view class="container">
    <view v-if="list.length === 0" class="empty muted">暂无待处理的实名姓名查看请求</view>

    <view v-for="n in list" :key="n.id" class="card">
      <view class="title">{{ n.requesterName }} 请求查看你的实名姓名</view>
      <view class="muted">对方已支付费用。你的同意仅对本次请求生效；拒绝后对方费用自动全额退回。每次请求都会弹出，你随时可以拒绝。</view>
      <view class="actions">
        <view class="btn-warn" @tap="respond(n, false)">拒绝本次</view>
        <view class="btn-primary" @tap="respond(n, true)">同意本次</view>
      </view>
    </view>

    <view class="muted note">
      依据《个人信息保护法》第 13 条，每一次查看请求都是一次独立的、具体的授权。
      平台不提供“长期同意”或“永久关闭”开关，以保障你对姓名展示的逐次控制权。
    </view>
  </view>
</template>

<script>
import { api } from '@/api';

export default {
  data() {
    return { list: [] };
  },
  async onShow() {
    const res = await api.nameViewIncoming();
    this.list = res.data || [];
  },
  methods: {
    async respond(n, accept) {
      const res = await api.nameViewRespond(n.id, accept);
      uni.showToast({ title: res.message || '已处理', icon: 'none' });
      const r = await api.nameViewIncoming();
      this.list = r.data || [];
    }
  }
};
</script>

<style>
.title { font-size: 30rpx; font-weight: 600; margin-bottom: 12rpx; }
.actions { display: flex; gap: 16rpx; margin-top: 20rpx; }
.actions .btn-primary, .actions .btn-warn { flex: 1; margin-top: 0; }
.empty { text-align: center; padding: 100rpx 0; }
.note { line-height: 1.8; padding: 0 12rpx; }
</style>
