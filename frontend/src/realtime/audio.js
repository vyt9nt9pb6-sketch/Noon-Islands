/**
 * 对讲音频提供者（可插拔）。统一接口：
 *
 *   capture = provider.createCapture({ onFrame(arrayBuffer), onLevel(0..1), onError(err) })
 *     await capture.start()   // 按下：开始采集，每 40ms 回调一帧（已打包：4 字节头 + 320 字节 μ-law）
 *     capture.stop()          // 松开：停止发送（H5 会保持麦克风 15 秒热启动，之后释放）
 *     capture.dispose()
 *   player = provider.createPlayer()
 *     player.unlock()          // 需在用户手势中调用（iOS / 浏览器自动播放策略）
 *     player.push(arrayBuffer) // 收到对方音频帧
 *     player.reset()           // 对方松开
 *     player.dispose()
 *
 * 平台实现：
 *   H5        getUserMedia + WebAudio（ScriptProcessor 采集、AudioBufferSource 排队播放）
 *   微信小程序  RecorderManager（PCM 8k + frameSize 分片） + wx.createWebAudioContext 播放
 *   App(iOS/Android/鸿蒙)  uni.getRecorderManager 在 App 端不支持 onFrameRecorded（官方文档“App 暂不支持”），
 *             需要原生实时录音插件：调用 registerAudioProvider() 注入，接口同上。未注入时返回不可用说明。
 */
import { encodeFloat32, encodeInt16, decodeToFloat32, createDownsampler, createFramer, packFrame, unpackFrame, CODEC_MULAW_8K } from './codec';

export const SAMPLE_RATE = 8000;
export const FRAME_SAMPLES = 320; // 40ms @ 8kHz
const PREBUFFER_S = 0.12;         // 抖动缓冲：首帧延后 120ms 播放

let injected = null;
/** 原生插件注入点（iOS / Android / 鸿蒙 原生实现接入这里） */
export function registerAudioProvider(provider) { injected = provider; }

/* ---------------- 通用：WebAudio 排队播放（H5 与小程序共用） ---------------- */
function createQueuedPlayer(getCtx) {
  let ctx = null;
  let nextTime = 0;
  let lastSeq = -1;
  const stats = { frames: 0, underruns: 0, gaps: 0 };
  const ensure = () => { if (!ctx) ctx = getCtx(); return ctx; };
  return {
    stats,
    get unlocked() { return !!ctx && ctx.state === 'running'; },
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended' && c.resume) c.resume();
      // iOS：在手势中播放一个静音 buffer 解锁音频
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      } catch (e) { /* */ }
    },
    push(arrayBuffer) {
      const f = unpackFrame(arrayBuffer);
      if (!f || f.codec !== CODEC_MULAW_8K) return;
      const c = ensure();
      if (!c) return;
      if (lastSeq >= 0 && ((f.seq - lastSeq) & 0xffff) > 1) stats.gaps++;
      lastSeq = f.seq;
      const pcm = decodeToFloat32(f.payload);
      const buf = c.createBuffer(1, pcm.length, SAMPLE_RATE);
      if (buf.copyToChannel) buf.copyToChannel(pcm, 0); else buf.getChannelData(0).set(pcm);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      const now = c.currentTime;
      if (nextTime < now) { if (nextTime > 0) stats.underruns++; nextTime = now + PREBUFFER_S; }
      src.start(nextTime);
      nextTime += buf.duration;
      stats.frames++;
    },
    reset() { nextTime = 0; lastSeq = -1; },
    dispose() { try { ctx && ctx.close && ctx.close(); } catch (e) { /* */ } ctx = null; }
  };
}

/* ---------------- H5：getUserMedia + WebAudio ---------------- */
// #ifdef H5
const h5Provider = {
  name: 'h5-webaudio',
  supported() {
    if (typeof window === 'undefined') return { ok: false, reason: '当前环境不支持音频' };
    if (!window.isSecureContext) return { ok: false, reason: '浏览器只允许在 HTTPS 页面使用麦克风' };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: false, reason: '此浏览器不支持麦克风采集' };
    return { ok: true };
  },
  createCapture({ onFrame, onLevel, onError }) {
    let stream = null, ctx = null, node = null, src = null, sink = null;
    let sending = false, seq = 0, coolTimer = null;
    let down = null;
    const framer = createFramer(FRAME_SAMPLES, (f) => {
      onFrame(packFrame(seq, encodeFloat32(f)));
      seq = (seq + 1) & 0xffff;
    });
    async function open() {
      if (stream) return;
      // 先在按下手势里同步创建并 resume AudioContext（iOS Safari / Chrome 自动播放策略要求在用户手势内），再等麦克风授权
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (e) { try { ctx.close(); } catch (e2) { /* */ } ctx = null; throw e; }
      down = createDownsampler(ctx.sampleRate, SAMPLE_RATE);
      src = ctx.createMediaStreamSource(stream);
      // ScriptProcessor 已被标记弃用，但 iOS Safari / 微信内置浏览器兼容性最好；AudioWorklet 见设计文档“后续”
      node = ctx.createScriptProcessor(1024, 1, 1);
      sink = ctx.createGain(); sink.gain.value = 0;
      node.onaudioprocess = (e) => {
        if (!sending) return;
        const input = e.inputBuffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < input.length; i += 8) peak = Math.max(peak, Math.abs(input[i]));
        onLevel && onLevel(Math.min(1, peak * 1.6));
        framer.push(down(input));
      };
      src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    }
    function release() {
      try { node && node.disconnect(); src && src.disconnect(); sink && sink.disconnect(); } catch (e) { /* */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      try { ctx && ctx.close(); } catch (e) { /* */ }
      stream = ctx = node = src = sink = null;
    }
    return {
      // 打开对讲机面板时（用户手势内）预热 AudioContext，首次按下 PTT 不必等音频设备启动；不申请麦克风
      prepare() {
        if (stream || ctx) return;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          clearTimeout(coolTimer);
          coolTimer = setTimeout(() => { if (!stream) release(); }, 15000);
        } catch (e) { ctx = null; }
      },
      async start() {
        clearTimeout(coolTimer);
        try {
          await open();
          if (ctx.state === 'suspended') await ctx.resume();
          framer.reset();
          sending = true;
        } catch (e) {
          onError && onError(e && e.name === 'NotAllowedError' ? new Error('麦克风权限被拒绝，请在浏览器设置中允许') : e);
          throw e;
        }
      },
      stop() {
        sending = false;
        onLevel && onLevel(0);
        clearTimeout(coolTimer);
        coolTimer = setTimeout(release, 15000); // 15 秒内再按无需重新打开麦克风
      },
      dispose() { sending = false; clearTimeout(coolTimer); release(); }
    };
  },
  createPlayer() {
    return createQueuedPlayer(() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      return AC ? new AC() : null;
    });
  }
};
// #endif

/* ---------------- 微信小程序：RecorderManager + WebAudioContext ---------------- */
// #ifdef MP-WEIXIN
const mpProvider = {
  name: 'mp-weixin-recorder',
  supported() {
    if (!wx.createWebAudioContext) return { ok: false, reason: '微信版本过低（需基础库 2.19.0+）' };
    return { ok: true };
  },
  createCapture({ onFrame, onLevel, onError }) {
    const rm = wx.getRecorderManager();
    let seq = 0, active = false;
    const framer = createFramer(FRAME_SAMPLES, (f) => {
      // framer 输入为 Float32，这里把 Int16 归一化后再切帧
      onFrame(packFrame(seq, encodeFloat32(f)));
      seq = (seq + 1) & 0xffff;
    });
    rm.onFrameRecorded((res) => {
      if (!active || !res.frameBuffer) return;
      const i16 = new Int16Array(res.frameBuffer);
      const f32 = new Float32Array(i16.length);
      let peak = 0;
      for (let i = 0; i < i16.length; i++) { f32[i] = i16[i] / 32768; if (i % 8 === 0) peak = Math.max(peak, Math.abs(f32[i])); }
      onLevel && onLevel(Math.min(1, peak * 1.6));
      framer.push(f32);
    });
    rm.onError((e) => onError && onError(new Error((e && e.errMsg) || '录音失败')));
    rm.onInterruptionBegin && rm.onInterruptionBegin(() => onError && onError(new Error('录音被系统中断（来电或其他语音）')));
    return {
      start() {
        return new Promise((resolve, reject) => {
          wx.authorize({
            scope: 'scope.record',
            success: () => {
              active = true; framer.reset();
              // frameSize 单位 KB：PCM 8k/16bit = 16KB/s，1KB ≈ 64ms 一片
              rm.start({ format: 'PCM', sampleRate: 8000, numberOfChannels: 1, encodeBitRate: 16000, frameSize: 1, duration: 60000 });
              resolve();
            },
            fail: () => { const e = new Error('麦克风权限被拒绝，请在小程序设置中允许'); onError && onError(e); reject(e); }
          });
        });
      },
      stop() { active = false; onLevel && onLevel(0); try { rm.stop(); } catch (e) { /* */ } },
      dispose() { this.stop(); }
    };
  },
  createPlayer() { return createQueuedPlayer(() => wx.createWebAudioContext()); }
};
// #endif

/* ---------------- App：需原生插件 ---------------- */
const unsupportedProvider = (reason) => ({
  name: 'unsupported',
  supported: () => ({ ok: false, reason }),
  createCapture: () => ({ start: () => Promise.reject(new Error(reason)), stop() {}, dispose() {} }),
  createPlayer: () => ({ unlocked: true, unlock() {}, push() {}, reset() {}, dispose() {}, stats: {} })
});

export function getAudioProvider() {
  if (injected) return injected;
  // #ifdef H5
  return h5Provider;
  // #endif
  // #ifdef MP-WEIXIN
  return mpProvider;
  // #endif
  // #ifdef APP-PLUS || APP-HARMONY
  return unsupportedProvider('App 端实时对讲需要原生实时录音插件（uni.getRecorderManager 在 App 不支持分片回调），详见 docs/对讲与位置共享设计.md');
  // #endif
  return unsupportedProvider('当前平台不支持实时对讲');
}

export { encodeInt16 };
