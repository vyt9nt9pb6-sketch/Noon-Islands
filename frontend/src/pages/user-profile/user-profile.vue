<template>
  <view class="container">
    <!-- 早期微信联系人资料：大头像 + 名字/公司 + 操作列表。自己与好友共用本页。 -->
    <view class="cells me-cells">
      <view class="cell me-row">
        <view class="avatar-sq big" :style="{ background: u.avatarColor }">{{ (u.displayName || '?').slice(0, 1) }}</view>
        <view class="cell-bd me-main">
          <view class="name">{{ u.displayName }}</view>
          <view class="sub">{{ orgLine }}</view>
          <view class="badges">
            <text class="badge" :class="u.orgCertified ? 'badge-org' : 'badge-org expired'">{{ u.orgCertified ? '组织已认证' : '未认证' }}</text>
            <text class="badge" :class="u.realnameCertified ? 'badge-realname' : 'badge-org expired'">{{ u.realnameCertified ? '实名已认证' : '未实名' }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="u.self" class="cells">
      <view class="cell access" @tap="go('/pages/cert-org/cert-org')">
        <view class="cell-bd">组织认证</view>
      </view>
      <view class="cell access" @tap="go('/pages/cert-realname/cert-realname')">
        <view class="cell-bd">实名认证</view>
      </view>
    </view>

    <view v-else class="cells">
      <view class="cell access" @tap="startChat">
        <view class="cell-bd">{{ chatLabel }}</view>
      </view>
    </view>
    <view v-if="!u.self && u.chatPermission && u.chatPermission.reason" class="cells-tips">{{ u.chatPermission.reason }}</view>

    <!-- 举报 / 屏蔽只出现在对方资料，不出现在自己资料，也不再放在聊天“+”面板 -->
    <view v-if="!u.self" class="cells danger">
      <view class="cell access" @tap="showReport">
        <view class="cell-bd warn">举报</view>
      </view>
      <view class="cell access" @tap="showBlock">
        <view class="cell-bd warn">{{ u.blocked ? '已屏蔽' : '屏蔽' }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';
import { userStore } from '@/store/user';

export default {
  data() {
    return {
      userId: '',
      u: { displayName: '', avatarColor: '#ccc', self: false, company: '', department: '', orgCertified: false, realnameCertified: false, chatPermission: {}, blocked: false, chatId: null }
    };
  },
  computed: {
    orgLine() {
      const a = [this.u.company, this.u.department].filter(Boolean).join(' · ');
      return a || (this.u.self ? '尚未加入组织' : '');
    },
    chatLabel() {
      const p = this.u.chatPermission || {};
      if (this.u.chatId) return '发消息';
      if (!p.canInitiate) return '暂不能发起聊天';
      return p.needRequest ? '申请聊天' : '发消息';
    }
  },
  onLoad(options) {
    this.userId = options.userId || (userStore.profile && userStore.profile.id) || '';
  },
  async onShow() {
    if (!this.userId) return;
    const res = await api.userProfile(this.userId);
    this.u = res.data;
    uni.setNavigationBarTitle({ title: this.u.self ? '个人资料' : this.u.displayName });
  },
  methods: {
    go(url) { uni.navigateTo({ url }); },
    async startChat() {
      const p = this.u.chatPermission || {};
      if (this.u.chatId) {
        uni.navigateTo({ url: `/pages/chat/chat?chatId=${this.u.chatId}` });
        return;
      }
      if (!p.canInitiate) {
        return uni.showToast({ title: p.reason || '暂不能发起聊天', icon: 'none' });
      }
      const res = await api.chatRequest(this.u.id, '你好');
      if (res.data && res.data.chatId && !p.needRequest) {
        uni.navigateTo({ url: `/pages/chat/chat?chatId=${res.data.chatId}` });
      } else {
        uni.showModal({ title: '已发起', content: res.data?.message || res.message || '操作成功', showCancel: false });
      }
    },
    showReport() {
      uni.showModal({
        title: '举报该用户',
        editable: true,
        placeholderText: '举报原因',
        success: async (m) => {
          if (!m.confirm) return;
          await api.reportUser(this.u.id, m.content || '');
          uni.showToast({ title: '举报已受理', icon: 'success' });
        }
      });
    },
    showBlock() {
      if (this.u.blocked) return uni.showToast({ title: '已屏蔽', icon: 'none' });
      uni.showModal({
        title: '屏蔽该用户',
        content: '屏蔽后你将无法继续向对方发送消息。',
        success: async (m) => {
          if (!m.confirm) return;
          await api.blockUser(this.u.id);
          this.u.blocked = true;
          uni.showToast({ title: '已屏蔽', icon: 'success' });
        }
      });
    }
  }
};
</script>

<style>
.me-cells { margin-top: 40rpx; }
.me-row { padding: 36rpx 30rpx; }
.avatar-sq.big { width: 128rpx; height: 128rpx; font-size: 54rpx; }
.me-main { margin-left: 28rpx; }
.name { font-size: 36rpx; margin-bottom: 8rpx; }
.sub { font-size: 26rpx; color: #888; }
.badges { margin-top: 12rpx; }
.danger { margin-top: 40rpx; }
.warn { color: #E64340; }
</style>
