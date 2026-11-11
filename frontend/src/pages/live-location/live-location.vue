<template>
  <view class="ll-page">
    <live-map :markers="markers" :map-cfg="mapCfg" :focus="focus" :focus-seq="focusSeq" />

    <!-- 顶部（早期微信“共享实时位置”样式）：深色半透明条，左“退出”，中间参与者头像，右“收起” -->
    <view class="ll-top" :style="{ paddingTop: safeTop + 'px' }">
      <view class="top-row">
        <!-- “退出共享”= 停止共享 + 删除位置 + 离开页面（原“退出”和“停止共享”合并为一个） -->
        <view class="top-btn exit" @tap="exitPage">退出共享</view>
        <view class="people">
          <view :class="['p-avatar', s.myShare ? 'live' : '']" :style="{ background: myColor }">{{ myName.slice(0, 1) }}</view>
          <view :class="['p-avatar', s.peerShare ? 'live' : '', s.peerTalking ? 'talking' : '']" :style="{ background: peerColor }">{{ peerInitial }}</view>
        </view>
        <view class="top-btn" @tap="minimize">收起</view>
      </view>
      <view class="top-status">
        <text :class="['dot', s.peerOnline ? 'on' : 'off']"></text>{{ peerName }} · {{ peerStatus }}<text v-if="distanceText"> · 相距 {{ distanceText }}</text>
      </view>
    </view>

    <view v-if="s.audioLocked && !s.peerTalking" class="pill" @tap="session.unlockAudio()">轻点这里开启声音</view>
    <view v-if="s.notice" class="toast">{{ s.notice }}</view>
    <view v-if="s.myShare && s.locError" class="pill err-pill">{{ s.locError }}</view>

    <!-- 视角切换 -->
    <view class="side">
      <view :class="['side-btn', focus === 'both' ? 'on' : '']" @tap="setFocus('both')"><view class="fi-both"></view></view>
      <view :class="['side-btn', focus === 'me' ? 'on' : '']" @tap="setFocus('me')"><view class="fi-me"></view></view>
    </view>

    <!-- 底部：对讲机 + 共享控制 -->
    <view class="ll-bottom">
      <view class="attrib">{{ attribution }}</view>
      <view class="wt-wrap"><walkie-talkie v-if="session" :session="session" variant="compact" :peer-name="peerName" /></view>
      <!-- 尚未共享：开始入口；共享中不显示底部提示条（停止 = 左上“退出共享”） -->
      <view v-if="!s.myShare" class="sheet">
        <view :class="['start-btn', s.perms.locationShare.allowed ? '' : 'disabled']" @tap="start">{{ startLabel }}</view>
      </view>
      <view v-else class="sheet-pad"></view>
    </view>

    <!-- 首次使用：位置共享隐私提示（确认即开始共享并视为同意；之后不再弹出） -->
    <view v-if="noticeOpen" class="mask">
      <view class="dialog">
        <view class="d-title">{{ noticeTitle }}</view>
        <scroll-view scroll-y class="d-body">
          <view v-for="p in noticePoints" :key="p.k" class="d-pt"><text class="d-k">{{ p.k }}</text><text class="d-v">{{ p.v }}</text></view>
          <view class="d-confirm">{{ noticeConfirm }}</view>
        </scroll-view>
        <view class="d-ft">
          <view class="d-btn" @tap="noticeOpen = false">取消</view>
          <view class="d-btn primary" @tap="acceptAndStart">确认并开始共享</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { api, absoluteUrl } from '@/api';
import { userStore, refreshProfile } from '@/store/user';
import { getChatRealtime, distanceMeters, formatDistance } from '@/realtime/session';
import { LOCATION_NOTICE_TITLE, LOCATION_NOTICE_POINTS, LOCATION_NOTICE_CONFIRM } from '@/realtime/privacy-notice';
import LiveMap from '@/components/live-map/live-map.vue';
import WalkieTalkie from '@/components/walkie-talkie/walkie-talkie.vue';

// onLoad 之前（session 尚未创建）渲染用的占位状态
const EMPTY_STATE = { perms: { walkieTalkie: { allowed: false }, locationShare: { allowed: false } }, audioSupport: { ok: false }, myShare: null, peerShare: null, myFix: null, peerOnline: false, peerTalking: false, pttPhase: 'idle', level: 0, pttMaxMs: 60000, connection: 'idle', locationConsent: { accepted: null }, consentPrompt: 0 };
const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export default {
  components: { LiveMap, WalkieTalkie },
  data() {
    return {
      chatId: '', session: null, peer: null, mapCfg: null,
      focus: 'both', focusSeq: 0, now: Date.now(), safeTop: 8,
      noticeOpen: false, noticeTitle: LOCATION_NOTICE_TITLE, noticePoints: LOCATION_NOTICE_POINTS, noticeConfirm: LOCATION_NOTICE_CONFIRM,
      minimized: false
    };
  },
  computed: {
    s() { return this.session ? this.session.state : EMPTY_STATE; },
    peerName() { return (this.peer && this.peer.displayName) || '对方'; },
    peerInitial() { return this.peerName.slice(0, 1); },
    peerColor() { return (this.peer && this.peer.avatarColor) || '#576B95'; },
    myName() { return (userStore.profile && userStore.profile.displayName) || '我'; },
    myColor() { return (userStore.profile && userStore.profile.avatarColor) || '#09BB07'; },
    markers() {
      const list = [];
      if (this.s.myFix) list.push({ id: 'me', self: true, label: '我', initial: this.myName.slice(0, 1), color: '#09BB07', ...this.s.myFix });
      const last = this.s.peerShare && this.s.peerShare.last;
      if (last) list.push({ id: 'peer', self: false, label: this.peerName, color: '#576B95', ...last });
      return list;
    },
    peerStatus() {
      if (this.s.peerTalking) return '正在讲话';
      if (this.s.peerShare) {
        const parts = ['正在共享位置'];
        if (!this.s.peerShare.last) parts.push('等待位置…');
        else { const ago = this.agoText(this.s.peerShare.last.ts); if (ago) parts.push(ago); }
        return parts.join(' · ');
      }
      return this.s.peerOnline ? '在线 · 未共享位置' : '离线';
    },
    distanceText() {
      const d = distanceMeters(this.s.myFix, this.s.peerShare && this.s.peerShare.last);
      return d == null ? '' : formatDistance(d);
    },
    startLabel() {
      if (!this.s.perms.locationShare.allowed) return this.s.perms.locationShare.reason || '暂不可用';
      return '共享我的实时位置';
    },
    attribution() {
      // #ifdef MP-WEIXIN
      return '';
      // #endif
      return this.mapCfg && this.mapCfg.source !== 'none' ? stripTags(this.mapCfg.attribution) : '';
    }
  },
  onLoad(options) {
    this.chatId = options.chatId;
    this.session = getChatRealtime(this.chatId);
    try { this.safeTop = (uni.getSystemInfoSync().statusBarHeight || 0) + 6; } catch (e) { /* */ }
  },
  async onShow() {
    this.minimized = false;
    this.session.attach();
    this.timer = setInterval(() => { this.now = Date.now(); }, 15000);
    if (!userStore.profile) refreshProfile();
    try {
      const res = await api.chatMessages(this.chatId);
      this.peer = res.data.peer;
    } catch (e) { /* */ }
    if (!this.mapCfg) {
      try {
        const c = (await api.mapConfig()).data;
        const abs = (u) => (u && u.startsWith('/') ? absoluteUrl(u) : u);
        this.mapCfg = { ...c, pmtilesUrl: abs(c.pmtilesUrl), glyphs: abs(c.glyphs), styleUrl: abs(c.styleUrl), fallbackStyleUrl: abs(c.fallbackStyleUrl) };
      } catch (e) { this.mapCfg = { source: 'none' }; }
    }
  },
  watch: {
    's.myShare'() { this.now = Date.now(); },
    's.peerShare'() { this.now = Date.now(); },
    // 服务端判定尚未同意（首次 / 已撤回 / 提示改版）→ 弹出隐私提示
    's.consentPrompt'() { this.noticeOpen = true; }
  },
  onHide() { clearInterval(this.timer); this.session.detach(); },
  onUnload() {
    clearInterval(this.timer);
    // 退出页面 = 退出共享：停止并删除位置（“收起”则继续在后台共享）
    if (!this.minimized && this.s.myShare) this.session.stopShare();
  },
  methods: {
    exitPage() {
      if (this.s.myShare) this.session.stopShare();
      this.minimized = false;
      this.back();
    },
    minimize() { this.minimized = true; this.back(); },
    back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index' }) }); },
    setFocus(f) { this.focus = f; this.focusSeq++; },
    agoText(ts) {
      if (!ts) return '';
      const s = Math.max(0, Math.round((this.now - new Date(ts).getTime()) / 1000));
      return s < 60 ? '' : `${Math.round(s / 60)} 分钟前更新`;
    },
    start() {
      if (!this.s.perms.locationShare.allowed) return uni.showToast({ title: this.startLabel, icon: 'none' });
      this.session.prepareTalk();
      // 只在第一次（或撤回后）弹出隐私提示；已同意则直接开始
      if (this.s.locationConsent && this.s.locationConsent.accepted === true) this.session.startShare(false);
      else this.noticeOpen = true;
    },
    acceptAndStart() {
      this.noticeOpen = false;
      this.session.startShare(true);
    }
  }
};
</script>

<style>
.ll-page { position: fixed; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; background: #f2efe9; }
.ll-top { position: absolute; left: 0; right: 0; top: 0; z-index: 10; background: rgba(40, 41, 45, 0.88); color: #fff; padding-bottom: 16rpx; }
.top-row { display: flex; align-items: center; justify-content: space-between; padding: 10rpx 24rpx 0; }
.top-btn { font-size: 30rpx; padding: 10rpx 8rpx; color: #fff; }
.top-btn.exit { color: #FF7A73; }
.people { display: flex; gap: 22rpx; }
.p-avatar { width: 84rpx; height: 84rpx; border-radius: 18rpx; color: #fff; font-size: 36rpx; display: flex; align-items: center; justify-content: center; border: 3rpx solid rgba(255, 255, 255, 0.25); opacity: 0.55; }
.p-avatar.live { opacity: 1; border-color: #09BB07; }
.p-avatar.talking { border-color: #FF9500; box-shadow: 0 0 0 6rpx rgba(255, 149, 0, 0.35); }
.top-status { text-align: center; font-size: 24rpx; color: rgba(255, 255, 255, 0.82); margin-top: 12rpx; padding: 0 24rpx; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 14rpx; height: 14rpx; border-radius: 50%; display: inline-block; margin-right: 10rpx; vertical-align: middle; }
.dot.on { background: #09BB07; } .dot.off { background: #888; }
.pill { position: absolute; top: 270rpx; left: 50%; transform: translateX(-50%); padding: 14rpx 28rpx; border-radius: 32rpx; font-size: 26rpx; color: #fff; background: rgba(0, 0, 0, 0.7); z-index: 9; }
.toast { position: absolute; top: 40%; left: 50%; transform: translateX(-50%); padding: 20rpx 30rpx; border-radius: 16rpx; font-size: 28rpx; color: #fff; background: rgba(17, 17, 17, 0.75); z-index: 11; max-width: 80%; text-align: center; }
.side { position: absolute; right: 20rpx; top: 300rpx; display: flex; flex-direction: column; gap: 16rpx; z-index: 8; }
.side-btn { width: 76rpx; height: 76rpx; border-radius: 50%; background: #fff; border: 1rpx solid #D9D9D9; box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.15); display: flex; align-items: center; justify-content: center; }
.side-btn.on { border-color: #09BB07; }
.fi-both { width: 30rpx; height: 30rpx; border: 4rpx solid #555; border-radius: 8rpx; box-sizing: border-box; }
.side-btn.on .fi-both { border-color: #09BB07; }
.fi-me { width: 28rpx; height: 28rpx; border-radius: 50%; border: 4rpx solid #555; box-sizing: border-box; position: relative; }
.fi-me::after { content: ''; position: absolute; left: 6rpx; top: 6rpx; width: 8rpx; height: 8rpx; border-radius: 50%; background: #555; }
.side-btn.on .fi-me { border-color: #09BB07; } .side-btn.on .fi-me::after { background: #09BB07; }
.ll-bottom { position: absolute; left: 0; right: 0; bottom: 0; z-index: 10; }
.attrib { text-align: right; font-size: 20rpx; color: #555; padding: 0 16rpx 8rpx; text-shadow: 0 0 4rpx #fff, 0 0 4rpx #fff; }
.wt-wrap { padding: 50rpx 24rpx 20rpx; }
.sheet { background: #F7F7F7; border-top: 1rpx solid #D9D9D9; padding: 24rpx 30rpx calc(24rpx + env(safe-area-inset-bottom)); }
.start-btn { background: #1AAD19; color: #fff; text-align: center; border-radius: 44rpx; height: 88rpx; line-height: 88rpx; font-size: 32rpx; border: 1rpx solid #179B16; }
.start-btn.disabled { background: #9ED99D; border-color: #9ED99D; }
.sheet-pad { height: env(safe-area-inset-bottom); }
.err-pill { top: 200rpx; background: rgba(230, 67, 64, 0.92); }
/* 早期微信风格对话框 */
.mask { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); z-index: 50; display: flex; align-items: center; justify-content: center; }
.dialog { width: 600rpx; background: #fff; border-radius: 20rpx; overflow: hidden; }
.d-title { font-size: 34rpx; text-align: center; padding: 36rpx 30rpx 16rpx; color: #000; font-weight: 600; }
.d-body { max-height: 760rpx; padding: 0 36rpx; box-sizing: border-box; }
.d-pt { display: flex; flex-direction: column; padding: 10rpx 0; font-size: 26rpx; line-height: 1.5; }
.d-k { color: #000; font-weight: 600; }
.d-v { color: #555; }
.d-confirm { font-size: 24rpx; color: #888; padding: 14rpx 0 26rpx; line-height: 1.5; }
.d-ft { display: flex; border-top: 1rpx solid #D5D5D6; }
.d-btn { flex: 1; text-align: center; height: 100rpx; line-height: 100rpx; font-size: 34rpx; color: #353535; }
.d-btn + .d-btn { border-left: 1rpx solid #D5D5D6; }
.d-btn.primary { color: #09BB07; font-weight: 600; }
</style>
