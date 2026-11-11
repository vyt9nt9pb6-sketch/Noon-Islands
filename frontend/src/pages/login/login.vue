<template>
  <view class="login-page">
    <view class="hero">
      <view class="logo">午</view>
      <view class="title">午间岛</view>
      <view class="subtitle">组织身份 · 即时通信 · 实名互认</view>
    </view>

    <view class="card">
      <view class="tabs">
        <view :class="['tab', mode === 'phone' ? 'on' : '']" @tap="mode = 'phone'">手机号</view>
        <view :class="['tab', mode === 'email' ? 'on' : '']" @tap="mode = 'email'">邮箱</view>
      </view>

      <view v-if="mode === 'phone'">
        <view class="field">
          <input v-model="phone" type="number" maxlength="11" placeholder="手机号" class="input" />
        </view>
        <view class="field row">
          <input v-model="code" type="number" maxlength="6" placeholder="短信验证码" class="input" />
          <view class="sms-btn" :class="{ disabled: counting > 0 }" @tap="sendCode">{{ counting > 0 ? `${counting}s` : '获取验证码' }}</view>
        </view>
        <view class="btn-primary" :class="{ disabled: !canSubmitPhone }" @tap="doPhoneLogin">登录</view>
      </view>

      <view v-else>
        <view class="field">
          <input v-model="email" type="text" placeholder="邮箱" class="input" />
        </view>
        <view class="field row">
          <input v-model="emailCode" type="number" maxlength="6" placeholder="邮箱验证码" class="input" />
          <view class="sms-btn" :class="{ disabled: counting > 0 }" @tap="sendEmailCode">{{ counting > 0 ? `${counting}s` : '获取验证码' }}</view>
        </view>
        <view class="btn-primary" :class="{ disabled: !canSubmitEmail }" @tap="doEmailLogin">登录 / 注册</view>
        <view class="muted tip">使用验证码登录；若邮箱尚未注册将自动创建账号（无密码）</view>
      </view>

      <view class="muted agreement">
        登录即表示同意
        <text class="link">《服务条款》</text>与
        <text class="link">《隐私权政策》</text>
      </view>
    </view>

    <view class="oauth">
      <view class="oauth-line"><view class="hr"></view><text>其他登录方式</text><view class="hr"></view></view>
      <view class="oauth-row">
        <view class="oauth-item" @tap="tryOauth('wechat')">
          <view class="oauth-ico wechat">微</view>
          <text>微信</text>
        </view>
        <view class="oauth-item" @tap="tryOauth('apple')">
          <view class="oauth-ico apple">A</view>
          <text>Apple ID</text>
        </view>
        <view class="oauth-item" @tap="tryOauth('alipay')">
          <view class="oauth-ico alipay">支</view>
          <text>支付宝</text>
        </view>
      </view>
    </view>

  </view>
</template>

<script>
import { api, setToken } from '@/api';
import { userStore } from '@/store/user';

export default {
  data() {
    return { mode: 'phone', phone: '', code: '', email: '', emailCode: '', counting: 0 };
  },
  computed: {
    canSubmitPhone() { return /^1\d{10}$/.test(this.phone) && /^\d{6}$/.test(this.code); },
    canSubmitEmail() { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email) && /^\d{6}$/.test(this.emailCode); }
  },
  methods: {
    startCount() {
      this.counting = 60;
      const timer = setInterval(() => {
        this.counting--;
        if (this.counting <= 0) clearInterval(timer);
      }, 1000);
    },
    showDevCode(code) {
      if (!code) return;
      uni.showModal({ title: '开发模式', content: `验证码：${code}（生产环境仅发送到手机或邮箱，不会在此显示）`, showCancel: false });
    },
    afterLogin(res) {
      setToken(res.data.token);
      userStore.token = res.data.token;
      uni.reLaunch({ url: '/pages/index/index' });
    },
    async sendCode() {
      if (this.counting > 0 || !/^1\d{10}$/.test(this.phone)) return;
      const res = await api.smsCode(this.phone);
      this.showDevCode(res.devCode);
      if (res.devCode) this.code = res.devCode;
      this.startCount();
    },
    async sendEmailCode() {
      if (this.counting > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) return;
      const res = await api.emailCode(this.email);
      this.showDevCode(res.devCode);
      if (res.devCode) this.emailCode = res.devCode;
      this.startCount();
    },
    async doPhoneLogin() {
      if (!this.canSubmitPhone) return;
      const res = await api.login(this.phone, this.code);
      this.afterLogin(res);
    },
    async doEmailLogin() {
      if (!this.canSubmitEmail) return;
      const res = await api.emailLogin(this.email, this.emailCode);
      this.afterLogin(res);
    },
    async tryOauth(provider) {
      const closed = { title: '尚未开通', content: '该登录方式尚未开通。开通后需由管理员配置相应开放平台凭证。', showCancel: false };
      try {
        const m = await api.loginMethods();
        if (!(m.data && m.data[provider])) {
          return uni.showModal(closed);
        }
      } catch (e) {
        return uni.showModal(closed);
      }
      try {
        await api.oauthLogin(provider, {});
      } catch (e) { /* request() 已 toast */ }
    }
  }
};
</script>

<style>
.login-page { padding: 100rpx 0 48rpx; min-height: 100vh; box-sizing: border-box; background: #EDEDED; }
.login-page .card { padding: 10rpx 30rpx 40rpx; }
.login-page .btn-primary { margin: 40rpx 0 0; }
.hero { text-align: center; margin-bottom: 60rpx; }
.logo {
  width: 140rpx; height: 140rpx; border-radius: 32rpx;
  background: #09BB07; color: #fff; font-size: 72rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center; margin: 0 auto 24rpx;
}
.title { font-size: 44rpx; font-weight: 600; }
.subtitle { color: #8f959e; font-size: 26rpx; margin-top: 12rpx; }
.tabs { display: flex; margin: 10rpx 0 20rpx; }
.tab { flex: 1; text-align: center; padding: 18rpx 0; font-size: 30rpx; color: #888; border-bottom: 4rpx solid transparent; }
.tab.on { color: #09BB07; font-weight: 600; border-bottom-color: #09BB07; }
.field { margin-bottom: 24rpx; }
.field.row { display: flex; align-items: center; }
.input { background: #fff; border-bottom: 1rpx solid #E5E5E5; padding: 26rpx 0; font-size: 32rpx; flex: 1; }
.sms-btn {
  margin-left: 16rpx; color: #576B95; font-size: 26rpx; white-space: nowrap;
  background: #F8F8F8; border: 1rpx solid #D9D9D9; border-radius: 16rpx; padding: 14rpx 20rpx;
}
.sms-btn.disabled { color: #999; background: #f0f1f3; }
.agreement { text-align: center; margin-top: 24rpx; }
.tip { text-align: center; margin-top: 16rpx; }
.link { color: #576B95; }
.oauth { margin: 70rpx 40rpx 0; }
.oauth-line { display: flex; align-items: center; gap: 16rpx; color: #B2B2B2; font-size: 22rpx; }
.oauth-line .hr { flex: 1; height: 1rpx; background: #D9D9D9; }
.oauth-row { display: flex; justify-content: center; gap: 70rpx; margin-top: 36rpx; }
.oauth-item { display: flex; flex-direction: column; align-items: center; font-size: 22rpx; color: #888; }
.oauth-ico { width: 80rpx; height: 80rpx; border-radius: 50%; color: #fff; font-size: 32rpx; display: flex; align-items: center; justify-content: center; margin-bottom: 10rpx; }
.oauth-ico.wechat { background: #09BB07; }
.oauth-ico.apple { background: #111; }
.oauth-ico.alipay { background: #1677FF; }
</style>
