<template>
  <view class="container">
    <view class="card user-card">
      <view class="avatar" :style="{ background: profile.avatarColor }">{{ profile.displayName[0] }}</view>
      <view>
        <view class="name">{{ profile.displayName }}</view>
        <view class="muted">{{ profile.org.company }} · {{ profile.org.department }}</view>
      </view>
    </view>

    <view class="card">
      <view class="row">
        <text>组织认证</text>
        <text class="badge" :class="profile.orgCert.certified ? 'badge-org' : 'badge-org expired'">
          {{ orgCertText }}
        </text>
        <text class="link" @tap="goOrgCert">{{ profile.orgCert.certified ? '查看/续认证' : '去认证' }}</text>
      </view>
      <view v-if="profile.orgCert.certified && profile.orgCert.validUntil" class="muted sub">
        有效期至 {{ formatDate(profile.orgCert.validUntil) }}，到期前 30 天将提醒续认证
      </view>
      <view class="divider" />
      <view class="row">
        <text>实名认证</text>
        <text class="badge" :class="profile.realnameCertified ? 'badge-realname' : 'badge-org expired'">
          {{ profile.realnameCertified ? '实名已认证' : '未实名' }}
        </text>
        <text class="link" @tap="goRealnameCert">{{ profile.realnameCertified ? '查看' : '去认证' }}</text>
      </view>
      <view class="muted sub">实名认证是信任增强，不是聊天门槛；姓名默认不展示</view>
    </view>

    <view class="card">
      <view class="row" @tap="goOrders">
        <text>我的订单（认证服务费/退款）</text>
        <text class="muted">›</text>
      </view>
    </view>

    <view class="card">
      <view class="row" @tap="goPrivacy">
        <text>服务条款 / 隐私权政策</text>
        <text class="muted">›</text>
      </view>
      <view class="divider" />
      <view class="row" @tap="goAccount">
        <text>账号与安全（注销账号）</text>
        <text class="muted">›</text>
      </view>
    </view>

    <view class="btn-warn" @tap="doLogout">退出登录</view>
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
    orgCertText() {
      const c = this.profile.orgCert;
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
    goOrgCert() { uni.navigateTo({ url: '/pages/cert-org/cert-org' }); },
    goRealnameCert() { uni.navigateTo({ url: '/pages/cert-realname/cert-realname' }); },
    goOrders() { uni.showToast({ title: '订单页开发中，V1 经“实名认证”页管理', icon: 'none' }); },
    goPrivacy() { uni.showModal({ title: '文档位置', content: '服务条款与隐私权政策见仓库 docs/ 目录，上架前需部署为可公开访问 URL', showCancel: false }); },
    goAccount() { uni.navigateTo({ url: '/pages/account-delete/account-delete' }); },
    doLogout() { logout(); }
  }
};
</script>

<style>
.user-card { display: flex; align-items: center; }
.avatar { width: 110rpx; height: 110rpx; border-radius: 28rpx; color: #fff; font-size: 44rpx; display: flex; align-items: center; justify-content: center; margin-right: 24rpx; }
.name { font-size: 36rpx; font-weight: 700; margin-bottom: 8rpx; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.sub { margin-top: 10rpx; }
</style>
