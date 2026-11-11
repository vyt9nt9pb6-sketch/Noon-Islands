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

    <!-- 实时：位置共享状态条 -->
    <view v-if="rt && rt.state.myShare" class="rt-bar mine" @tap="openMap">
      <view class="live-dot"></view>
      <text class="rt-text">你正在共享实时位置</text>
      <text class="rt-act stop" @tap.stop="rt.stopShare()">停止</text>
    </view>
    <view v-if="rt && rt.state.peerShare" class="rt-bar peer" @tap="openMap">
      <view class="pin-dot"></view>
      <text class="rt-text">{{ peerName }} 正在共享实时位置</text>
      <text class="rt-act">查看</text>
    </view>

    <!-- 消息区（早期微信：方形头像 + 带小尾巴的气泡，我方绿色、对方白色） -->
    <scroll-view class="messages" scroll-y :scroll-top="scrollTop" scroll-with-animation @tap="closePanels">
      <view v-for="m in messages" :key="m.id" :class="['msg-row', m.fromMe ? 'mine' : '', m.type === 'system' ? 'sys' : '']">
        <view v-if="m.type === 'system'" class="sys-msg">{{ m.content }}</view>
        <block v-else>
          <view class="avatar-sq msg-avatar" :style="{ background: m.fromMe ? myColor : peerColor }" @tap.stop="openProfile(m.fromMe)">{{ (m.fromMe ? myName : peerName).slice(0, 1) }}</view>
          <view class="bubble">{{ m.content }}</view>
        </block>
      </view>
      <view class="msg-bottom-pad"></view>
    </scroll-view>

    <!-- 已授权展示的实名姓名 -->
    <view v-if="revealedName" class="reveal-bar">
      对方实名姓名（本次授权展示）：{{ revealedName }}
      <text class="muted"> · 同意仅本次生效</text>
    </view>

    <!-- 对讲浮层（面板收起时提示对方在讲话） -->
    <view v-if="rt && rt.state.peerTalking && panel !== 'walkie'" class="talk-float" @tap="panel = 'walkie'">
      <view class="tf-led orange"></view>
      <text>{{ peerName }} 正在讲话</text>
    </view>
    <view v-else-if="rt && rt.state.audioLocked" class="talk-float" @tap="rt.unlockAudio()">轻点这里开启声音</view>
    <view v-if="rt && rt.state.notice" class="rt-toast">{{ rt.state.notice }}</view>

    <!-- 输入区：[对讲机键] [输入框] [+ / 发送]；对讲模式下整行隐藏（对讲时不需要文字输入） -->
    <view v-if="panel !== 'walkie'" class="input-bar">
      <view :class="['wt-key-btn', panel === 'walkie' ? 'on' : '', walkieAllowed ? '' : 'off', rt && rt.state.peerTalking ? 'rx' : '', rt && rt.state.pttPhase === 'talking' ? 'tx' : '']" @tap="toggleWalkie">
        <view class="wk-ant"></view>
        <view class="wk-body"><view class="wk-led"></view><view class="wk-grille"></view><view class="wk-ptt"></view></view>
      </view>
      <input v-model="draft" class="input" :placeholder="sendBlocked ? '' : ''" :disabled="!!sendBlocked" confirm-type="send" @confirm="send" @focus="panel = ''" />
      <view v-if="draft.trim()" class="send-btn" :class="{ disabled: !!sendBlocked }" @tap="send">发送</view>
      <view v-else :class="['plus-btn', panel === 'plus' ? 'on' : '']" @tap="togglePlus"><view class="plus-h"></view><view class="plus-v"></view></view>
    </view>

    <!-- 对讲机面板 -->
    <view v-if="panel === 'walkie' && rt" class="chat-panel walkie-panel">
      <view class="wt-exit" @tap="exitWalkie">退出对讲</view>
      <walkie-talkie :session="rt" variant="panel" :peer-name="peerName" />
      <view class="wt-caption">按住 PTT 说话，松开结束 · 实时对讲，不留录音</view>
    </view>

    <!-- “+” 功能面板（早期微信样式：方格图标 + 文字） -->
    <view v-if="panel === 'plus'" class="chat-panel plus-panel">
      <view class="grid">
        <view class="g-item" @tap="toggleWalkie">
          <view :class="['g-ico', walkieAllowed ? '' : 'off']"><view class="gi-walkie"><view class="gw-ant"></view><view class="gw-body"></view></view></view>
          <text>对讲机</text>
        </view>
        <view class="g-item" @tap="openLocation">
          <view :class="['g-ico', locationAllowed || (rt && rt.state.peerShare) ? '' : 'off']"><view class="gi-pin"></view></view>
          <text>位置共享</text>
        </view>
        <view v-if="nameViewAvailable" class="g-item" @tap="requestNameView">
          <view class="g-ico"><text class="gi-txt">名</text></view>
          <text>查看实名</text>
        </view>
      </view>
    </view>
  </view>
</template>
<script>
import { api } from '@/api';
import { userStore, refreshProfile } from '@/store/user';
import { isPaidNameViewAvailable } from '@/utils/platform';
import { getChatRealtime } from '@/realtime/session';
import WalkieTalkie from '@/components/walkie-talkie/walkie-talkie.vue';

export default {
  components: { WalkieTalkie },
  data() {
    return {
      chatId: '', chat: null, messages: [], draft: '',
      restricted: false, sendBlocked: null, revealedName: '',
      scrollTop: 0, nameViewAvailable: false,
      rt: null, panel: ''
    };
  },
  computed: {
    peerName() { return (this.chat && this.chat.peer && this.chat.peer.displayName) || '对方'; },
    peerColor() { return (this.chat && this.chat.peer && this.chat.peer.avatarColor) || '#576B95'; },
    myName() { return (userStore.profile && userStore.profile.displayName) || '我'; },
    myColor() { return (userStore.profile && userStore.profile.avatarColor) || '#09BB07'; },
    walkieAllowed() { return !!(this.rt && this.rt.state.perms.walkieTalkie.allowed); },
    locationAllowed() { return !!(this.rt && this.rt.state.perms.locationShare.allowed); },
  },
  onLoad(options) {
    this.chatId = options.chatId;
    this.nameViewAvailable = isPaidNameViewAvailable() && userStore.nameViewEnabled;
    this.rt = getChatRealtime(this.chatId);
    if (options.voice === '1') this.panel = 'walkie';
  },
  async onShow() {
    this.rt.attach();
    if (!userStore.profile) refreshProfile();
    await this.refresh();
    this.poll = setInterval(() => this.refresh(), 5000);
  },
  onHide() {
    clearInterval(this.poll);
    this.rt.detach();
  },
  onUnload() {
    clearInterval(this.poll);
  },
  methods: {
    toggleWalkie() {
      if (this.panel !== 'walkie' && !this.walkieAllowed) {
        const p = this.rt.state.perms.walkieTalkie;
        return uni.showToast({ title: p.reason || '对讲暂不可用', icon: 'none' });
      }
      if (this.panel !== 'walkie' && uni.vibrateShort) uni.vibrateShort({ type: 'light', fail: () => {} });
      this.panel = this.panel === 'walkie' ? '' : 'walkie';
      if (this.panel) uni.hideKeyboard && uni.hideKeyboard();
      if (this.panel === 'walkie' && this.rt) this.rt.prepareTalk();
    },
    // 退出对讲：收起对讲机，回到文字聊天（输入栏恢复）；若仍按着 PTT，组件卸载时会自动松开
    exitWalkie() { this.panel = ''; },
    togglePlus() {
      this.panel = this.panel === 'plus' ? '' : 'plus';
      if (this.panel) uni.hideKeyboard && uni.hideKeyboard();
    },
    closePanels() { if (this.panel === 'plus') this.panel = ''; },
    openLocation() {
      if (!this.locationAllowed && !(this.rt && this.rt.state.peerShare)) {
        const p = this.rt.state.perms.locationShare;
        return uni.showToast({ title: p.reason || '位置共享暂不可用', icon: 'none' });
      }
      this.openMap();
    },
    openMap() { if (this.panel === 'plus') this.panel = ''; uni.navigateTo({ url: `/pages/live-location/live-location?chatId=${this.chatId}` }); },
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
    openProfile(fromMe) {
      const id = fromMe
        ? (userStore.profile && userStore.profile.id)
        : (this.chat && this.chat.peer && this.chat.peer.id);
      if (!id) return;
      uni.navigateTo({ url: `/pages/user-profile/user-profile?userId=${id}` });
    }
  }
};
</script>

<style>
.chat-page { display: flex; flex-direction: column; height: 100vh; background: #EBEBEB; }
.tip-bar.blocked { background: #FDECEC; color: #E64340; border-bottom-color: #F5C6C5; }
.link { color: #576B95; margin-left: 16rpx; }
.messages { flex: 1; padding: 20rpx 0 0; box-sizing: border-box; min-height: 0; }
.msg-row { display: flex; align-items: flex-start; padding: 14rpx 24rpx; }
.msg-row.mine { flex-direction: row-reverse; }
.msg-row.sys { justify-content: center; }
.msg-bottom-pad { height: 20rpx; }
.sys-msg { color: #fff; font-size: 24rpx; background: #CECECE; border-radius: 16rpx; padding: 6rpx 16rpx; max-width: 80%; text-align: center; }
.msg-avatar { width: 80rpx; height: 80rpx; font-size: 34rpx; border-radius: 16rpx; }
.bubble { position: relative; max-width: 66%; background: #fff; border: 1rpx solid #DCDCDC; border-radius: 12rpx; padding: 18rpx 22rpx; font-size: 32rpx; line-height: 1.45; color: #000; margin: 0 22rpx; word-break: break-all; }
/* 气泡小尾巴：外层边框色三角 + 内层填充色三角 */
.bubble::before, .bubble::after { content: ''; position: absolute; top: 24rpx; width: 0; height: 0; border-style: solid; }
.bubble::before { left: -14rpx; border-width: 12rpx 14rpx 12rpx 0; border-color: transparent #DCDCDC transparent transparent; }
.bubble::after { left: -12rpx; border-width: 11rpx 13rpx 11rpx 0; border-color: transparent #fff transparent transparent; top: 25rpx; }
.msg-row.mine .bubble { background: #A0E75A; border-color: #8CCB4E; }
.msg-row.mine .bubble::before { left: auto; right: -14rpx; border-width: 12rpx 0 12rpx 14rpx; border-color: transparent transparent transparent #8CCB4E; }
.msg-row.mine .bubble::after { left: auto; right: -12rpx; border-width: 11rpx 0 11rpx 13rpx; border-color: transparent transparent transparent #A0E75A; }
.reveal-bar { background: #E8F8E8; color: #179B16; font-size: 26rpx; padding: 14rpx 24rpx; border-top: 1rpx solid #C9EBC9; }
.input-bar { display: flex; align-items: center; gap: 16rpx; padding: 14rpx 16rpx; background: #F5F5F7; border-top: 1rpx solid #D3D3D3; }
.input { flex: 1; height: 72rpx; background: #fff; border: 1rpx solid #D3D3D3; border-radius: 16rpx; padding: 0 16rpx; font-size: 32rpx; }
.send-btn { background: #1AAD19; color: #fff; border-radius: 16rpx; padding: 0 24rpx; height: 66rpx; line-height: 66rpx; font-size: 30rpx; border: 1rpx solid #179B16; }
.send-btn.disabled { opacity: 0.5; }
/* 对讲机键（输入栏左侧）：小号对讲机外形，替代原来的麦克风/语音键 */
.wt-key-btn { width: 66rpx; height: 66rpx; border-radius: 50%; border: 3rpx solid #7F7F7F; box-sizing: border-box; display: flex; align-items: flex-end; justify-content: center; position: relative; flex-shrink: 0; padding-bottom: 9rpx; }
.wt-key-btn.on { border-color: #09BB07; background: #E9F8E9; }
.wt-key-btn.off { opacity: 0.4; }
.wk-ant { position: absolute; left: 20rpx; top: 8rpx; width: 5rpx; height: 14rpx; background: #555; border-radius: 3rpx; }
.wk-body { width: 26rpx; height: 34rpx; border-radius: 8rpx; background: #555; display: flex; flex-direction: column; align-items: center; padding-top: 4rpx; box-sizing: border-box; gap: 3rpx; }
.wk-led { width: 6rpx; height: 6rpx; border-radius: 50%; background: #9a9a9a; }
.wk-grille { width: 16rpx; height: 7rpx; background: repeating-linear-gradient(180deg, #333 0 2rpx, #777 2rpx 3rpx); }
.wk-ptt { width: 16rpx; height: 7rpx; border-radius: 3rpx; background: #E64340; }
.wt-key-btn.on .wk-body, .wt-key-btn.on .wk-ant { background: #2f7d2e; }
.wt-key-btn.tx .wk-led { background: #ff2d20; box-shadow: 0 0 6rpx #ff2d20; }
.wt-key-btn.rx .wk-led { background: #ff9500; box-shadow: 0 0 6rpx #ff9500; }
.plus-btn { width: 66rpx; height: 66rpx; border-radius: 50%; border: 3rpx solid #7F7F7F; box-sizing: border-box; position: relative; flex-shrink: 0; }
.plus-btn.on { transform: rotate(45deg); }
.plus-h, .plus-v { position: absolute; left: 50%; top: 50%; background: #7F7F7F; border-radius: 2rpx; }
.plus-h { width: 32rpx; height: 4rpx; margin: -2rpx 0 0 -16rpx; }
.plus-v { width: 4rpx; height: 32rpx; margin: -16rpx 0 0 -2rpx; }
.chat-panel { background: #F5F5F7; border-top: 1rpx solid #D3D3D3; }
.walkie-panel { position: relative; padding: 30rpx 0 calc(20rpx + env(safe-area-inset-bottom)); background: linear-gradient(180deg, #E4E4E6, #D6D6D9); }
.wt-exit { position: absolute; right: 24rpx; top: 22rpx; z-index: 5; padding: 10rpx 24rpx; border-radius: 30rpx; font-size: 26rpx; color: #353535; background: #fff; border: 1rpx solid #C8C8CC; }
.wt-exit:active { background: #ECECEC; }
.wt-caption { text-align: center; font-size: 22rpx; color: #888; margin-top: 18rpx; }
.plus-panel { padding: 30rpx 20rpx calc(30rpx + env(safe-area-inset-bottom)); }
.grid { display: flex; flex-wrap: wrap; }
.g-item { width: 25%; display: flex; flex-direction: column; align-items: center; margin-bottom: 30rpx; font-size: 24rpx; color: #888; }
.g-ico { width: 118rpx; height: 118rpx; border: 1rpx solid #D3D3D3; border-radius: 32rpx; background: #FBFBFB; display: flex; align-items: center; justify-content: center; margin-bottom: 12rpx; }
.g-ico.off { opacity: 0.4; }
.gi-txt { font-size: 50rpx; color: #7F7F7F; font-weight: 600; }
.gi-walkie { position: relative; width: 40rpx; height: 62rpx; }
.gw-ant { position: absolute; left: 6rpx; top: 0; width: 7rpx; height: 20rpx; border-radius: 4rpx; background: #7F7F7F; }
.gw-body { position: absolute; left: 0; bottom: 0; width: 40rpx; height: 46rpx; border-radius: 12rpx; background: #7F7F7F; box-shadow: inset 0 -12rpx 0 -4rpx #7F7F7F, inset 0 10rpx 0 -4rpx #7F7F7F; }
.gw-body::after { content: ''; position: absolute; left: 8rpx; top: 8rpx; width: 24rpx; height: 12rpx; background: repeating-linear-gradient(180deg, #FBFBFB 0 3rpx, transparent 3rpx 6rpx); }
.gi-pin { width: 40rpx; height: 40rpx; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 7rpx solid #7F7F7F; box-sizing: border-box; margin-top: -10rpx; }
.gi-block { width: 44rpx; height: 44rpx; border-radius: 50%; border: 6rpx solid #7F7F7F; box-sizing: border-box; position: relative; }
.gi-block::after { content: ''; position: absolute; left: 50%; top: -4rpx; width: 6rpx; height: 44rpx; margin-left: -3rpx; background: #7F7F7F; transform: rotate(45deg); }
/* 实时状态条 */
.rt-bar { display: flex; align-items: center; gap: 14rpx; padding: 16rpx 24rpx; font-size: 26rpx; border-bottom: 1rpx solid #D9D9D9; background: #fff; }
.rt-bar.mine { color: #000; }
.rt-bar.peer { color: #000; }
.rt-text { flex: 1; }
.rt-act { color: #576B95; }
.rt-act.stop { color: #E64340; }
.live-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #09BB07; box-shadow: 0 0 0 6rpx rgba(9, 187, 7, 0.2); }
.pin-dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #576B95; box-shadow: 0 0 0 6rpx rgba(87, 107, 149, 0.2); }
.talk-float { position: fixed; left: 50%; top: 38%; transform: translateX(-50%); display: flex; align-items: center; gap: 16rpx; padding: 22rpx 34rpx; border-radius: 32rpx; font-size: 28rpx; color: #fff; background: rgba(17, 17, 17, 0.72); z-index: 20; }
.tf-led { width: 22rpx; height: 22rpx; border-radius: 50%; }
.tf-led.orange { background: #ff9500; box-shadow: 0 0 12rpx 4rpx rgba(255, 149, 0, 0.7); }
.rt-toast { position: fixed; left: 50%; top: 46%; transform: translateX(-50%); background: rgba(17, 17, 17, 0.75); color: #fff; padding: 20rpx 30rpx; border-radius: 16rpx; font-size: 28rpx; z-index: 30; max-width: 80%; text-align: center; }
</style>
