<template>
  <!--
    模拟对讲机（全部用 CSS 原创绘制，无图片素材）：天线、旋钮、扬声器网罩、指示灯、大号 PTT 按键。
    不设液晶屏、不设 CH/MON/VOL 等装饰按键。按住 PTT 说话、松开结束（话权控制、对方忙、离线均由 session 处理）。
    variant = panel（聊天页面板，竖版整机） | compact（地图页，横版小机身）
    指示灯：发射 = 红；接收 = 橙；连接中 = 红灯闪烁；待机 = 熄灭
  -->
  <view :class="['wt', variant, phase]">
    <view class="wt-antenna"><view class="wt-antenna-tip"></view></view>
    <view class="wt-knob"></view>
    <view class="wt-body">
      <view class="wt-side-ptt" :class="{ pressed: pressed }"></view>
      <view class="wt-top">
        <view class="wt-grille">
          <view v-for="i in grilleRows" :key="i" class="wt-slot"></view>
        </view>
        <view class="wt-led-wrap">
          <view :class="['wt-led', ledClass]"></view>
          <text class="wt-led-label">{{ ledLabel }}</text>
        </view>
      </view>
      <view
        :class="['wt-ptt', pressed ? 'pressed' : '']"
        @touchstart.stop.prevent="down"
        @touchend.stop.prevent="up"
        @touchcancel.stop.prevent="up"
        @mousedown.stop.prevent="mouseDown"
        @mouseup.stop.prevent="up"
        @mouseleave="mouseLeave"
      >
        <view class="wt-ptt-ridges"><view></view><view></view><view></view></view>
        <text class="wt-ptt-text">PTT</text>
        <text class="wt-ptt-sub">{{ pttHint }}</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'WalkieTalkie',
  props: {
    session: { type: Object, required: true },
    variant: { type: String, default: 'panel' },
    peerName: { type: String, default: '对方' }
  },
  data() { return { mouseHeld: false, pressed: false }; },
  computed: {
    s() { return this.session.state; },
    grilleRows() { return this.variant === 'panel' ? 6 : 4; },
    disabled() { return !this.s.perms.walkieTalkie.allowed || !this.s.audioSupport.ok; },
    phase() {
      if (this.s.pttPhase === 'talking') return 'tx';
      if (this.s.pttPhase === 'requesting') return 'req';
      if (this.s.peerTalking) return 'rx';
      if (this.disabled) return 'off';
      if (!this.s.peerOnline) return 'offline';
      return 'idle';
    },
    ledClass() { return { tx: 'red', req: 'red blink', rx: 'orange' }[this.phase] || ''; },
    ledLabel() { return { tx: 'TX', req: 'TX', rx: 'RX' }[this.phase] || 'TX/RX'; },
    pttHint() {
      return { tx: '松开 结束', req: '连接中', rx: '对方讲话中', offline: '对方不在线', off: '不可用' }[this.phase] || '按住 说话';
    }
  },
  beforeUnmount() { if (this.pressed) this.session.pttUp(); },
  methods: {
    vibrate() { if (uni.vibrateShort) uni.vibrateShort({ type: 'medium', fail: () => {} }); },
    down() {
      this.pressed = true;
      this.vibrate();
      this.session.pttDown();
    },
    up() {
      this.mouseHeld = false;
      if (!this.pressed) return;
      this.pressed = false;
      this.vibrate();
      this.session.pttUp();
    },
    mouseDown(e) { if (e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return; this.mouseHeld = true; this.down(); },
    mouseLeave() { if (this.mouseHeld) this.up(); }
  }
};
</script>

<style>
.wt { position: relative; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
/* ---------- 竖版整机（聊天页面板） ---------- */
.wt.panel { width: 400rpx; padding-top: 70rpx; margin: 0 auto; }
.wt-antenna { position: absolute; left: 60rpx; top: 0; width: 30rpx; height: 86rpx; border-radius: 12rpx 12rpx 4rpx 4rpx; background: linear-gradient(90deg, #2b2b2b, #4a4a4a 45%, #222); z-index: 1; }
.wt-antenna-tip { position: absolute; left: 4rpx; top: -6rpx; width: 22rpx; height: 18rpx; border-radius: 10rpx; background: #1a1a1a; }
.wt-knob { position: absolute; right: 70rpx; top: 36rpx; width: 56rpx; height: 44rpx; border-radius: 10rpx 10rpx 0 0; background: repeating-linear-gradient(90deg, #333 0 6rpx, #555 6rpx 10rpx); z-index: 1; }
.wt-body { position: relative; z-index: 2; border-radius: 40rpx 40rpx 56rpx 56rpx; padding: 26rpx 30rpx 30rpx; background: linear-gradient(160deg, #4b4f55 0%, #33363b 45%, #26282c 100%); box-shadow: 0 16rpx 36rpx rgba(0, 0, 0, 0.35), inset 0 2rpx 0 rgba(255, 255, 255, 0.18), inset 0 -4rpx 0 rgba(0, 0, 0, 0.35); }
.wt-side-ptt { position: absolute; left: -12rpx; top: 150rpx; width: 14rpx; height: 120rpx; border-radius: 8rpx 0 0 8rpx; background: linear-gradient(90deg, #1b1b1b, #3a3a3a); transition: transform 0.08s; }
.wt-side-ptt.pressed { transform: translateX(6rpx); }
.wt-top { display: flex; align-items: center; gap: 20rpx; }
.wt-grille { flex: 1; display: flex; flex-direction: column; gap: 9rpx; padding: 16rpx 18rpx; border-radius: 18rpx; background: #1f2124; box-shadow: inset 0 3rpx 6rpx rgba(0, 0, 0, 0.6); }
.wt-slot { height: 7rpx; border-radius: 4rpx; background: linear-gradient(180deg, #0c0c0c, #2c2e31); }
.wt-led-wrap { display: flex; flex-direction: column; align-items: center; gap: 6rpx; width: 64rpx; }
.wt-led { width: 30rpx; height: 30rpx; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #6b6b6b, #2a2a2a 70%); box-shadow: inset 0 2rpx 4rpx rgba(0, 0, 0, 0.6); }
.wt-led.red { background: radial-gradient(circle at 35% 30%, #ffb3ad, #ff2d20 55%, #a10e06); box-shadow: 0 0 18rpx 6rpx rgba(255, 45, 32, 0.65); }
.wt-led.orange { background: radial-gradient(circle at 35% 30%, #ffe0a8, #ff9500 55%, #a35a00); box-shadow: 0 0 18rpx 6rpx rgba(255, 149, 0, 0.6); }
.wt-led.blink { animation: wtblink 0.5s steps(2) infinite; }
@keyframes wtblink { 50% { opacity: 0.25; } }
.wt-led-label { font-size: 18rpx; color: #9a9da2; font-family: monospace; letter-spacing: 1rpx; }
/* PTT 大按键 */
.wt-ptt { margin: 28rpx auto 0; width: 300rpx; height: 150rpx; border-radius: 75rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; touch-action: none;
  background: linear-gradient(180deg, #f5544a, #d9281d 60%, #b51a10); color: #fff;
  box-shadow: 0 10rpx 0 #7d0f08, 0 16rpx 22rpx rgba(0, 0, 0, 0.45), inset 0 3rpx 0 rgba(255, 255, 255, 0.35);
  transition: transform 0.06s ease, box-shadow 0.06s ease; }
.wt-ptt.pressed { transform: translateY(8rpx) scale(0.985); box-shadow: 0 2rpx 0 #7d0f08, 0 4rpx 8rpx rgba(0, 0, 0, 0.4), inset 0 4rpx 10rpx rgba(0, 0, 0, 0.3); }
.wt.rx .wt-ptt, .wt.offline .wt-ptt, .wt.off .wt-ptt { background: linear-gradient(180deg, #8d8f93, #6b6d71 60%, #55575b); box-shadow: 0 10rpx 0 #303236, 0 16rpx 22rpx rgba(0, 0, 0, 0.4), inset 0 3rpx 0 rgba(255, 255, 255, 0.25); color: #e3e3e3; }
.wt-ptt-ridges { position: absolute; top: 18rpx; display: flex; gap: 10rpx; }
.wt-ptt-ridges view { width: 46rpx; height: 5rpx; border-radius: 3rpx; background: rgba(0, 0, 0, 0.2); }
.wt-ptt-text { font-size: 44rpx; font-weight: 800; letter-spacing: 6rpx; text-shadow: 0 2rpx 0 rgba(0, 0, 0, 0.3); margin-top: 8rpx; }
.wt-ptt-sub { font-size: 22rpx; opacity: 0.92; margin-top: 2rpx; }

/* ---------- 横版小机身（地图页） ---------- */
.wt.compact { width: 100%; padding-top: 0; }
.wt.compact .wt-antenna { left: 44rpx; top: -50rpx; width: 22rpx; height: 64rpx; }
.wt.compact .wt-antenna-tip { width: 16rpx; left: 3rpx; }
.wt.compact .wt-knob { display: none; }
.wt.compact .wt-body { display: flex; align-items: center; gap: 20rpx; padding: 20rpx 22rpx; border-radius: 40rpx; }
.wt.compact .wt-side-ptt { display: none; }
.wt.compact .wt-top { flex-direction: column; gap: 12rpx; width: 70rpx; }
.wt.compact .wt-grille { width: 70rpx; box-sizing: border-box; padding: 10rpx 10rpx; gap: 7rpx; flex: none; }
.wt.compact .wt-slot { height: 5rpx; }
.wt.compact .wt-led-wrap { flex-direction: row; width: auto; }
.wt.compact .wt-led { width: 22rpx; height: 22rpx; }
.wt.compact .wt-ptt { margin: 0 0 0 auto; width: 240rpx; height: 132rpx; border-radius: 66rpx; flex-shrink: 0; }
.wt.compact .wt-ptt-text { font-size: 36rpx; letter-spacing: 4rpx; }
.wt.compact .wt-ptt-sub { font-size: 20rpx; }
.wt.compact .wt-ptt-ridges { top: 12rpx; }
.wt.compact .wt-ptt-ridges view { width: 30rpx; }
</style>
