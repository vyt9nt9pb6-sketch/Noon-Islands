<template>
  <view class="chat-page">
    <!-- 受限模式持续提示条（PRD 2.3） -->
    <view v-if="restricted" class="tip-bar">
      双方组织身份均未认证，请注意核实对方身份。仅支持文字消息。
      <text class="link" @tap="askPeerCert">请求对方完成组织认证</text>
      <text class="link" @tap="goMyCert">我去认证</text>
    </view>
    <!-- 发送阻断提示（PRD 2.4 到期/离职） -->
    <view v-if="sendBlocked" class="tip-bar blocked">{{ sendBlocked }}</view>

    <!-- 消息区 -->
    <scroll-view class="messages" scroll-y :scroll-top="scrollTop" scroll-with-animation>
      <view v-for="m in messages" :key="m.id" :class="['msg-row', m.fromMe ? 'mine' : '', m.type === 'system' ? 'sys' : '']">
        <view v-if="m.type === 'system'" class="sys-msg">{{ m.content }}</view>
        <view v-else class="bubble">{{ m.content }}</view>
      </view>
    </scroll-view>

    <!-- 已授权展示的实名姓名 -->
    <view v-if="revealedName" class="reveal-bar">
      对方实名姓名（本次授权展示）：{{ revealedName }}
      <text class="muted"> · 同意仅本次生效</text>
    </view>

    <!-- 输入区 -->
    <view class="input-bar">
      <input v-model="draft" class="input" placeholder="输入消息…" :disabled="!!sendBlocked" confirm-type="send" @confirm="send" />
      <view class="send-btn" :class="{ disabled: !draft.trim() || !!sendBlocked }" @tap="send">发送</view>
    </view>

    <!-- 会话操作 -->
    <view class="ops">
      <text class="link" @tap="requestNameView" v-if="nameViewAvailable">付费查看实名姓名</text>
      <text class="link" @tap="showReport">举报</text>
      <text class="link" @tap="showBlock">屏蔽</text>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';
import { userStore } from '@/store/user';
import { isPaidNameViewAvailable } from '@/utils/platform';

export default {
  data() {
    return {
      chatId: '', chat: null, messages: [], draft: '',
      restricted: false, sendBlocked: null, revealedName: '',
      scrollTop: 0, nameViewAvailable: false
    };
  },
  onLoad(options) {
    this.chatId = options.chatId;
    this.nameViewAvailable = isPaidNameViewAvailable() && userStore.nameViewEnabled;
  },
  async onShow() {
    await this.refresh();
    this.poll = setInterval(() => this.refresh(), 5000);
  },
  onHide() {
    clearInterval(this.poll);
  },
  onUnload() {
    clearInterval(this.poll);
  },
  methods: {
    async refresh() {
      const res = await api.chatMessages(this.chatId);
      this.chat = res.data;
      this.messages = res.data.messages;
      this.restricted = res.data.restricted;
      this.sendBlocked = res.data.mySendBlocked;
      uni.setNavigationBarTitle({ title: res.data.peer.displayName });
      // 已授权姓名（逐次授权，本次会话内展示）
      if (this.nameViewAvailable) {
        try {
          const rv = await api.nameViewRevealed(this.chatId);
          this.revealedName = rv.data.revealed ? rv.data.realName : '';
        } catch (e) { /* 忽略 */ }
      }
      this.scrollTop = this.messages.length * 200;
    },
    async send() {
      if (!this.draft.trim() || this.sendBlocked) return;
      await api.sendMessage(this.chatId, 'text', this.draft.trim());
      this.draft = '';
      this.refresh();
    },
    askPeerCert() {
      api.requestOrgCert(this.chatId);
      uni.showToast({ title: '已发送请求', icon: 'success' });
    },
    goMyCert() {
      uni.navigateTo({ url: '/pages/cert-org/cert-org' });
    },
    async requestNameView() {
      const fee = userStore.nameViewEnabled ? '' : '';
      uni.showModal({
        title: '付费查看实名姓名',
        content: '支付后将向对方发送查看请求。对方逐次授权：同意则本次会话展示姓名；拒绝则费用自动全额退回。该功能在 iOS 端暂不开放。',
        success: async (m) => {
          if (!m.confirm) return;
          const res = await api.nameViewRequest(this.chatId);
          uni.showToast({ title: res.data.message || '请求已送达', icon: 'none' });
        }
      });
    },
    showReport() {
      uni.showModal({
        title: '举报该会话',
        editable: true,
        placeholderText: '举报原因',
        success: async (m) => {
          if (!m.confirm) return;
          await api.reportChat(this.chatId, m.content || '');
          uni.showToast({ title: '举报已受理', icon: 'success' });
        }
      });
    },
    showBlock() {
      uni.showModal({
        title: '屏蔽该会话',
        content: '屏蔽后你将无法继续向对方发送消息，可在设置中管理。',
        success: async (m) => {
          if (!m.confirm) return;
          await api.blockChat(this.chatId);
          uni.showToast({ title: '已屏蔽', icon: 'success' });
        }
      });
    }
  }
};
</script>

<style>
.chat-page { display: flex; flex-direction: column; height: 100vh; }
.chat-page .tip-bar { margin: 12rpx 24rpx 0; }
.tip-bar.blocked { background: #feecec; color: #c0392b; }
.link { color: #4c7dff; margin-left: 16rpx; }
.messages { flex: 1; padding: 24rpx; box-sizing: border-box; }
.msg-row { display: flex; margin-bottom: 20rpx; }
.msg-row.mine { justify-content: flex-end; }
.msg-row.sys { justify-content: center; }
.sys-msg { color: #8f959e; font-size: 22rpx; background: #f0f1f3; border-radius: 8rpx; padding: 8rpx 16rpx; }
.bubble {
  max-width: 70%; background: #fff; border-radius: 4rpx 20rpx 20rpx 20rpx;
  padding: 18rpx 24rpx; font-size: 28rpx;
}
.msg-row.mine .bubble { background: #4c7dff; color: #fff; border-radius: 20rpx 4rpx 20rpx 20rpx; }
.reveal-bar {
  background: #e8fff2; color: #1a7f4b; font-size: 26rpx;
  padding: 16rpx 24rpx; border-radius: 12rpx; margin: 0 24rpx 12rpx;
}
.input-bar { display: flex; gap: 16rpx; padding: 16rpx 24rpx; background: #fff; }
.input { flex: 1; background: #f5f6fa; border-radius: 999rpx; padding: 16rpx 28rpx; font-size: 28rpx; }
.send-btn {
  background: #4c7dff; color: #fff; border-radius: 999rpx;
  padding: 16rpx 36rpx; font-size: 28rpx;
}
.send-btn.disabled { opacity: 0.5; }
.ops {
  display: flex; justify-content: space-around; background: #fff;
  padding: 16rpx 24rpx 32rpx; font-size: 24rpx;
}
.ops .link { margin: 0; }
</style>
