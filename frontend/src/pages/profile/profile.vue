<template>
  <view class="container">
    <!-- 早期微信“我”页：头像资料行 + 分组设置项 -->
    <view class="cells me-cells">
      <view class="cell me-row access" @tap="goOwnProfile">
        <view class="avatar-sq big" :style="{ background: profile.avatarColor }">{{ (profile.displayName || '?').slice(0, 1) }}</view>
        <view class="cell-bd me-main">
          <view class="name">{{ profile.displayName }}</view>
          <view class="sub">{{ orgLine }}</view>
        </view>
      </view>
    </view>

    <view class="cells">
      <view class="cell" @tap="goOrgCert">
        <view class="ico" style="background:#3C83D6">组</view>
        <view class="cell-bd">组织认证</view>
        <view class="cell-ft access">
          <text class="badge" :class="profile.orgCert.certified ? 'badge-org' : 'badge-org expired'">{{ orgCertText }}</text>
        </view>
      </view>
      <view class="cell" @tap="goRealnameCert">
        <view class="ico" style="background:#09BB07">实</view>
        <view class="cell-bd">实名认证</view>
        <view class="cell-ft access">
          <text class="badge" :class="profile.realnameCertified ? 'badge-realname' : 'badge-org expired'">{{ profile.realnameCertified ? '实名已认证' : '未实名' }}</text>
        </view>
      </view>
    </view>
    <view v-if="profile.orgCert.certified && profile.orgCert.validUntil" class="cells-tips">
      组织认证有效期至 {{ formatDate(profile.orgCert.validUntil) }}，到期前 30 天提醒续认证。实名认证是信任增强，不是聊天门槛；姓名默认不展示。
    </view>

    <view class="cells">
      <view class="cell access" @tap="goOrders">
        <view class="ico" style="background:#F9A33A">单</view>
        <view class="cell-bd">我的订单</view>
      </view>
    </view>

    <view class="cells">
      <view class="cell access" @tap="goPrivacySettings">
        <view class="ico" style="background:#576B95">隐</view>
        <view class="cell-bd">隐私</view>
        <text class="cell-ft">位置共享授权</text>
      </view>
      <view class="cell access" @tap="goPrivacy">
        <view class="ico" style="background:#8E8E93">文</view>
        <view class="cell-bd">服务条款 / 隐私权政策</view>
      </view>
      <view class="cell access" @tap="goAccount">
        <view class="ico" style="background:#E64340">安</view>
        <view class="cell-bd">账号与安全</view>
      </view>
    </view>

    <view class="btn-warn logout" @tap="doLogout">退出登录</view>
  </view>
</template>
<script>
import { api } from '@/api';
import { userStore, refreshProfile, logout } from '@/store/user';

export default {
  computed: {
    profile() {
      return userStore.profile || {
        displayName: '-', avatarColor: '#ccc',
        orgCert: { certified: false }, org: {}, realnameCertified: false
      };
    },
    orgLine() {
      const o = this.profile.org || {};
      return [o.company, o.department].filter(Boolean).join(' · ') || '尚未加入组织';
    },
    orgCertText() {
      const c = this.profile.orgCert || {};
      if (c.certified) return '组织已认证';
      if (c.reason === 'expired') return '已过期';
      if (c.reason === 'departed') return '已离职';
      return '未认证';
    }
  },
  async onShow() {
    if (!userStore.token) {
      uni.reLaunch({ url: '/pages/login/login' });
      return;
    }
    await refreshProfile();
  },
  methods: {
    formatDate(iso) {
      return iso ? new Date(iso).toLocaleDateString('zh-CN') : '';
    },
    goOwnProfile() {
      const id = this.profile.id;
      if (!id) return;
      uni.navigateTo({ url: `/pages/user-profile/user-profile?userId=${id}` });
    },
    goOrgCert() { uni.navigateTo({ url: '/pages/cert-org/cert-org' }); },
    goRealnameCert() { uni.navigateTo({ url: '/pages/cert-realname/cert-realname' }); },
    goOrders() { uni.showToast({ title: '订单页开发中，V1 经“实名认证”页管理', icon: 'none' }); },
    goPrivacy() { uni.showModal({ title: '文档位置', content: '服务条款与隐私权政策见仓库 docs/ 目录，上架前需部署为可公开访问 URL', showCancel: false }); },
    goPrivacySettings() { uni.navigateTo({ url: '/pages/privacy-settings/privacy-settings' }); },
    goAccount() { uni.navigateTo({ url: '/pages/account-delete/account-delete' }); },
    doLogout() { logout(); }
  }
};
</script>

<style>
.me-cells { margin-top: 40rpx; }
.me-row { padding: 30rpx; }
.avatar-sq.big { width: 128rpx; height: 128rpx; font-size: 54rpx; }
.me-main { margin-left: 28rpx; }
.name { font-size: 36rpx; margin-bottom: 10rpx; }
.sub { font-size: 26rpx; color: #888; }
.ico { width: 52rpx; height: 52rpx; border-radius: 16rpx; color: #fff; font-size: 26rpx; display: flex; align-items: center; justify-content: center; margin-right: 26rpx; }
.logout { margin: 60rpx 30rpx 60rpx; }
</style>
