<template>
  <view class="login-page">
    <view class="hero">
      <view class="logo">午</view>
      <view class="title">午间岛</view>
      <view class="subtitle">组织身份 · 即时通信 · 实名互认</view>
    </view>

    <view class="card">
      <view class="field">
        <input v-model="phone" type="number" maxlength="11" placeholder="手机号" class="input" />
      </view>
      <view class="field row">
        <input v-model="code" type="number" maxlength="6" placeholder="短信验证码" class="input" />
        <view class="sms-btn" :class="{ disabled: counting > 0 }" @tap="sendCode">{{ counting > 0 ? `${counting}s` : '获取验证码' }}</view>
      </view>
      <view class="btn-primary" :class="{ disabled: !canSubmit }" @tap="doLogin">登录</view>
      <view class="muted agreement">
        登录即表示同意
        <text class="link">《服务条款》</text>与
        <text class="link">《隐私权政策》</text>
      </view>
    </view>

    <view class="muted demo-tip">联调种子账号：13800000001~04 / 13900000000(管理员)</view>
  </view>
</template>

<script>
import { api, setToken } from '@/api';
import { userStore } from '@/store/user';

export default {
  data() {
    return { phone: '', code: '', counting: 0, devCode: '' };
  },
  computed: {
    canSubmit() {
      return /^1\d{10}$/.test(this.phone) && /^\d{6}$/.test(this.code);
    }
  },
  methods: {
    async sendCode() {
      if (this.counting > 0 || !/^1\d{10}$/.test(this.phone)) return;
      const res = await api.smsCode(this.phone);
      if (res.devCode) {
        this.devCode = res.devCode;
        uni.showModal({ title: '开发模式', content: `验证码：${res.devCode}（生产环境仅短信下发）`, showCancel: false });
        this.code = res.devCode;
      }
      this.counting = 60;
      const timer = setInterval(() => {
        this.counting--;
        if (this.counting <= 0) clearInterval(timer);
      }, 1000);
    },
    async doLogin() {
      if (!this.canSubmit) return;
      const res = await api.login(this.phone, this.code);
      setToken(res.data.token);
      userStore.token = res.data.token;
      uni.reLaunch({ url: '/pages/index/index' });
    }
  }
};
</script>

<style>
.login-page { padding: 120rpx 48rpx 48rpx; }
.hero { text-align: center; margin-bottom: 80rpx; }
.logo {
  width: 140rpx; height: 140rpx; border-radius: 36rpx;
  background: #4c7dff; color: #fff; font-size: 72rpx; font-weight: 700;
  display: flex; align-items: center; justify-content: center; margin: 0 auto 24rpx;
}
.title { font-size: 44rpx; font-weight: 700; }
.subtitle { color: #8f959e; font-size: 26rpx; margin-top: 12rpx; }
.field { margin-bottom: 24rpx; }
.field.row { display: flex; align-items: center; }
.input {
  background: #f5f6fa; border-radius: 16rpx; padding: 22rpx 24rpx;
  font-size: 30rpx; flex: 1;
}
.sms-btn {
  margin-left: 16rpx; color: #4c7dff; font-size: 26rpx; white-space: nowrap;
  background: #e8f3ff; border-radius: 12rpx; padding: 16rpx 20rpx;
}
.sms-btn.disabled { color: #999; background: #f0f1f3; }
.agreement { text-align: center; margin-top: 24rpx; }
.link { color: #4c7dff; }
.demo-tip { text-align: center; margin-top: 60rpx; }
</style>
