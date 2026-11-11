<template>
  <view class="container">
    <view class="card">
      <view class="title">组织认证</view>
      <view class="muted">
        认证用于解锁跨公司聊天、解除受限会话。有效期 6 个月，到期前 30 天提醒续认证。
        离职后组织认证立即失效。
      </view>
      <view class="divider" />
      <view class="row"><text>状态</text><text :class="status.certified ? 'ok' : 'bad'">{{ statusText }}</text></view>
      <view v-if="status.certified && status.validUntil" class="muted sub">有效期至 {{ fmt(status.validUntil) }}（剩 {{ status.daysLeft }} 天）</view>
      <view v-if="!status.certified" class="muted sub">今日剩余核验机会：{{ status.attemptsLeft }}/3</view>
    </view>

    <view v-if="!status.certified" class="card">
      <view class="title">方式一：定位核验（推荐）</view>
      <view class="muted">
        仅做一次性距离核验：核对当前位置是否在 {{ company.name }} 注册地址（{{ company.addressLabel }}）允许半径内。
        <text class="em">不保存经纬度、不记录轨迹</text>，仅保存“是否在半径内”与核验时间。
      </view>
      <view class="btn-primary" :class="{ disabled: status.attemptsLeft <= 0 }" @tap="verifyLocation">
        一次性定位核验
      </view>
      <view class="muted center">拒绝定位？可使用下方企业邮箱替代路径，不因拒绝定位而阻断认证</view>
    </view>

    <view v-if="!status.certified" class="card">
      <view class="title">方式二：企业邮箱 + 管理员确认（替代路径）</view>
      <view class="field">
        <input v-model="companyEmail" placeholder="name@dawn-tech.example.cn" class="input" />
      </view>
      <view class="btn-primary" @tap="fallbackRequest">发送邮箱验证码</view>
      <view v-if="fallbackSent" class="field">
        <input v-model="emailCode" type="number" maxlength="6" placeholder="邮箱验证码" class="input" />
      </view>
      <view v-if="fallbackSent" class="btn-primary" @tap="fallbackVerify">验证</view>
      <view class="muted sub">邮箱验证通过后，需企业管理员在后台确认，确认后认证生效 6 个月</view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';

export default {
  data() {
    return {
      status: { certified: false, attemptsLeft: 3 },
      company: { name: '', addressLabel: '' },
      companyEmail: '', emailCode: '', fallbackSent: false
    };
  },
  computed: {
    statusText() {
      if (this.status.certified) return '已认证';
      if (this.status.reason === 'expired') return '已过期（新消息发送被阻断）';
      if (this.status.reason === 'departed') return '已离职（组织关系失效）';
      return '未认证';
    }
  },
  async onShow() {
    const [s, c] = await Promise.all([api.orgCertStatus(), api.myCompany()]);
    this.status = s.data;
    this.company = c.data;
  },
  methods: {
    fmt(iso) { return iso ? new Date(iso).toLocaleDateString('zh-CN') : ''; },
    verifyLocation() {
      if (this.status.attemptsLeft <= 0) {
        uni.showToast({ title: '今日次数已用完，请走邮箱路径', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '位置权限说明',
        content: '仅在使用期间获取一次位置用于距离核验，不保存坐标、不记录轨迹。你也可以选择拒绝并改用企业邮箱路径。',
        confirmText: '继续核验',
        success: (m) => { if (m.confirm) this.doLocate(); }
      });
    },
    doLocate() {
      uni.getLocation({
        type: 'gcj02',
        success: async (pos) => {
          const res = await api.orgVerifyLocation(pos.latitude, pos.longitude);
          if (res.data.passed) {
            uni.showModal({ title: '核验通过', content: `组织认证已生效，有效期至 ${this.fmt(res.data.validUntil)}`, showCancel: false });
          } else {
            uni.showModal({
              title: '未通过',
              content: `${res.data.reason}。剩余机会 ${res.data.attemptsLeft}/3。也可改用企业邮箱路径。`,
              showCancel: false
            });
          }
          const s = await api.orgCertStatus();
          this.status = s.data;
        },
        fail: () => {
          uni.showModal({
            title: '未授权定位',
            content: '你已拒绝定位授权。这不影响认证：请使用下方“企业邮箱 + 管理员确认”替代路径完成组织认证。',
            showCancel: false
          });
        }
      });
    },
    async fallbackRequest() {
      const res = await api.orgFallbackRequest(this.companyEmail);
      this.fallbackSent = true;
      if (res.devCode) this.emailCode = res.devCode;
      uni.showToast({ title: '验证邮件已发送', icon: 'success' });
    },
    async fallbackVerify() {
      const res = await api.orgFallbackVerify(this.emailCode);
      uni.showModal({ title: '邮箱验证通过', content: (res.message || '') + '，等待企业管理员确认', showCancel: false });
    }
  }
};
</script>

<style>
.title { font-size: 32rpx; font-weight: 700; margin-bottom: 12rpx; }
.row { display: flex; justify-content: space-between; align-items: center; }
.ok { color: #27ba6e; }
.bad { color: #e64a3a; }
.sub { margin-top: 12rpx; }
.center { text-align: center; margin-top: 16rpx; }
.em { color: #b25e00; }
.field { margin-top: 20rpx; }
.input { background: #f5f6fa; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
</style>
