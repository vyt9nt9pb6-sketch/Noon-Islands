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

    <!-- 会话列表（早期微信：通栏白底、方形头像、细分隔线、右侧时间） -->
    <view v-if="chats.length === 0" class="empty">
      <view class="muted">暂无会话，去通讯录发起聊天吧</view>
    </view>
    <view v-else class="chat-list">
      <view v-for="c in chats" :key="c.chatId" class="chat-item" hover-class="chat-item-hover" @tap="openChat(c)">
        <view class="avatar-sq" :style="{ background: c.peer.avatarColor }">{{ c.peer.displayName[0] }}</view>
        <view class="chat-main">
          <view class="row1">
            <text class="name">{{ c.peer.displayName }}</text>
            <text class="badge badge-org" :class="{ expired: !c.peer.orgCert.certified }">
              {{ c.peer.orgCert.certified ? '组织已认证' : c.peer.orgCert.reason === 'departed' ? '已离职' : c.peer.orgCert.reason === 'expired' ? '已过期' : '未认证' }}
            </text>
            <text v-if="c.peer.realnameCertified" class="badge badge-realname">实名</text>
            <text class="time">{{ timeText(c.lastMessage && c.lastMessage.createdAt) }}</text>
          </view>
          <view class="row2">
            <text v-if="c.restricted" class="restricted-tag">[受限]</text>{{ c.lastMessage ? c.lastMessage.content : '会话已建立' }}
          </view>
        </view>
      </view>
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
    timeText(iso) {
      if (!iso) return '';
      const d = new Date(iso), now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return '昨天';
      return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    openChat(c) {
      uni.navigateTo({ url: `/pages/chat/chat?chatId=${c.chatId}` });
    }
  }
};
</script>

<style>
.request-card { border-left: 6rpx solid #09BB07; }
.req-title { font-size: 30rpx; margin-bottom: 8rpx; }
.req-actions { display: flex; gap: 20rpx; margin-top: 20rpx; }
.req-actions .btn-primary, .req-actions .btn-warn { flex: 1; margin: 0; height: 68rpx; line-height: 68rpx; font-size: 28rpx; }
.chat-list { background: #fff; border-bottom: 1rpx solid #D9D9D9; }
.chat-item { position: relative; display: flex; align-items: center; padding: 20rpx 24rpx; background: #fff; }
.chat-item-hover { background: #D9D9D9; }
.chat-item + .chat-item::before { content: ''; position: absolute; left: 24rpx; right: 0; top: 0; height: 1rpx; background: #E5E5E5; }
.chat-main { flex: 1; margin-left: 24rpx; overflow: hidden; }
.row1 { display: flex; align-items: center; margin-bottom: 8rpx; }
.name { font-size: 34rpx; color: #000; white-space: nowrap; }
.time { margin-left: auto; padding-left: 12rpx; font-size: 24rpx; color: #B2B2B2; flex-shrink: 0; }
.row2 { font-size: 28rpx; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.restricted-tag { color: #E64340; margin-right: 6rpx; }
.empty { text-align: center; padding: 160rpx 0; }
</style>
