<template>
  <view class="container">
    <!-- 待处理的聊天申请 -->
    <view v-for="r in pendingRequests" :key="r.id" class="card request-card">
      <view class="req-title">{{ r.fromName }}（{{ r.fromCompany }}）申请与你聊天</view>
      <view class="muted">{{ r.relationLabel }} · {{ r.greeting || '无附言' }}</view>
      <view class="req-actions">
        <view class="btn-warn small" @tap="respond(r, false)">拒绝</view>
        <view class="btn-primary small" @tap="respond(r, true)">接受</view>
      </view>
    </view>

    <!-- 待处理的实名姓名查看请求 -->
    <view v-for="n in incomingNameViews" :key="n.id" class="card request-card">
      <view class="req-title">{{ n.requesterName }} 请求查看你的实名姓名（已支付费用）</view>
      <view class="muted">同意仅对本次请求生效，下次查看需重新取得你的同意</view>
      <view class="req-actions">
        <view class="btn-warn small" @tap="respondNameView(n, false)">拒绝</view>
        <view class="btn-primary small" @tap="respondNameView(n, true)">同意本次</view>
      </view>
    </view>

    <!-- 会话列表 -->
    <view v-if="chats.length === 0" class="empty">
      <view class="muted">暂无会话，去通讯录发起聊天吧</view>
    </view>
    <view v-for="c in chats" :key="c.chatId" class="card chat-item" @tap="openChat(c)">
      <view class="avatar" :style="{ background: c.peer.avatarColor }">{{ c.peer.displayName[0] }}</view>
      <view class="chat-main">
        <view class="row1">
          <text class="name">{{ c.peer.displayName }}</text>
          <text class="badge badge-org" :class="{ expired: !c.peer.orgCert.certified }">
            {{ c.peer.orgCert.certified ? '组织已认证' : c.peer.orgCert.reason === 'departed' ? '已离职' : c.peer.orgCert.reason === 'expired' ? '已过期' : '未认证' }}
          </text>
          <text v-if="c.peer.realnameCertified" class="badge badge-realname">实名已认证</text>
        </view>
        <view class="muted">{{ c.lastMessage ? c.lastMessage.content : '会话已建立' }}</view>
      </view>
      <view v-if="c.restricted" class="restricted-tag">受限</view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';
import { userStore, refreshProfile, refreshNameViewFlag } from '@/store/user';

export default {
  data() {
    return { chats: [], pendingRequests: [], incomingNameViews: [] };
  },
  async onShow() {
    if (!userStore.token) {
      uni.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await refreshProfile();
    refreshNameViewFlag();
    await this.refresh();
  },
  methods: {
    async refresh() {
      const [chats, reqs, nvs] = await Promise.all([
        api.chats(), api.chatRequests(), api.nameViewIncoming().catch(() => ({ data: [] }))
      ]);
      this.chats = chats.data;
      this.pendingRequests = reqs.data;
      this.incomingNameViews = nvs.data || [];
    },
    async respond(r, accept) {
      await api.respondChatRequest(r.id, accept);
      if (accept) uni.showToast({ title: '已接受', icon: 'success' });
      this.refresh();
    },
    async respondNameView(n, accept) {
      const res = await api.nameViewRespond(n.id, accept);
      uni.showToast({ title: res.message || '已处理', icon: 'none' });
      this.refresh();
    },
    openChat(c) {
      uni.navigateTo({ url: `/pages/chat/chat?chatId=${c.chatId}` });
    }
  }
};
</script>

<style>
.request-card { border-left: 8rpx solid #4c7dff; }
.req-title { font-size: 30rpx; font-weight: 600; margin-bottom: 8rpx; }
.req-actions { display: flex; gap: 16rpx; margin-top: 20rpx; }
.req-actions .btn-primary, .req-actions .btn-warn { flex: 1; margin-top: 0; padding: 14rpx 0; font-size: 26rpx; }
.chat-item { display: flex; align-items: center; }
.avatar {
  width: 88rpx; height: 88rpx; border-radius: 20rpx; color: #fff;
  font-size: 36rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.chat-main { flex: 1; margin-left: 20rpx; overflow: hidden; }
.row1 { display: flex; align-items: center; margin-bottom: 8rpx; }
.name { font-size: 32rpx; font-weight: 600; }
.restricted-tag {
  background: #fff7e8; color: #b25e00; font-size: 20rpx;
  border-radius: 8rpx; padding: 6rpx 12rpx; flex-shrink: 0;
}
.empty { text-align: center; padding: 120rpx 0; }
</style>
