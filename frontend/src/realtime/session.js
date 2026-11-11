/**
 * 单聊实时会话控制器（每个 chatId 一个单例，跨页面共享）
 * 聊天页与位置共享地图页用同一个实例：离开地图页不会中断位置共享，按住说话两页都能用。
 */
import { reactive } from 'vue';
import { getRealtimeClient } from './client';
import { getAudioProvider } from './audio';
import { getLocationProvider, createSendGate } from './location';
import { gcj02ToWgs84 } from '@/utils/coords';

const sessions = new Map();

const DENY_TEXT = {
  peer_offline: '对方不在线，暂时无法对讲',
  busy: '对方正在讲话，请稍候',
  restricted: '受限模式下仅支持文字消息',
  blocked: '会话已被屏蔽'
};
const STOP_TEXT = {
  disconnected: '连接中断，位置共享已停止',
  permission: '权限变化，位置共享已停止',
  user: '已停止共享位置',
  logout: '已退出登录'
};

function vibrate() {
  try { if (typeof uni !== 'undefined' && uni.vibrateShort) uni.vibrateShort({ type: 'light', fail: () => {} }); } catch (e) { /* 不支持震动的平台忽略 */ }
}

function createSession(chatId) {
  const client = getRealtimeClient();
  const provider = getAudioProvider();
  const state = reactive({
    chatId,
    connection: client.state,
    peerId: null,
    peerOnline: false,
    perms: { walkieTalkie: { allowed: false, reason: '连接中…' }, locationShare: { allowed: false, reason: '连接中…' } },
    audioSupport: provider.supported(),
    // 对讲
    pttPhase: 'idle',      // idle | requesting | talking
    talkStartedAt: 0,
    pttMaxMs: 60000,
    level: 0,
    peerTalking: false,
    audioLocked: false,    // 收到音频但播放器未解锁（需轻点）
    notice: '',
    // 位置
    myShare: null,         // { startedAt }
    peerShare: null,       // { startedAt, last }
    myFix: null,           // 本机最新位置（WGS-84，与 OSM 底图一致；仅本机内存）
    locError: '',
    sentCount: 0,
    // 位置共享隐私提示：按账号记录在服务端，只在第一次使用（或撤回 / 提示改版后）弹出
    locationConsent: { accepted: null, version: '' }, // accepted: null=未知（尚未连上）
    consentPrompt: 0       // 服务端要求先确认隐私提示时 +1，页面据此弹出提示
  });

  let capture = null;
  let player = null;
  let wantTalking = false;
  let stopWatch = null;
  let gate = null;
  let noticeTimer = null;
  let attached = 0;
  const stats = { framesCaptured: 0, framesSent: 0 };

  const notify = (text) => {
    state.notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { state.notice = ''; }, 2600);
  };

  function ensurePlayer() { if (!player) player = provider.createPlayer(); return player; }

  /* ---------- 服务端消息 ---------- */
  function onMsg(m) {
    if (m.t === 'socket.closed') {
      state.peerOnline = false;
      if (state.pttPhase !== 'idle') endTalk(false);
      state.peerTalking = false;
      return;
    }
    if (m.chatId !== chatId && m.t !== 'presence') return;
    switch (m.t) {
      case 'chat.state':
        state.peerId = m.peerId;
        state.peerOnline = m.peerOnline;
        state.perms = m.permissions;
        state.pttMaxMs = m.limits.pttMaxMs;
        state.peerTalking = !!(m.floor && m.floor.holderId === m.peerId);
        state.myShare = m.myShare;
        state.peerShare = m.peerShare;
        if (m.locationConsent) state.locationConsent = m.locationConsent;
        if (m.myShare && !stopWatch) startWatch();
        if (!m.myShare && stopWatch) stopWatching();
        break;
      case 'presence':
        if (m.chatId === chatId) state.peerOnline = m.online;
        break;
      case 'ptt.granted':
        if (!wantTalking) { client.send({ t: 'ptt.stop', chatId }); break; } // 已松开
        state.pttPhase = 'talking';
        state.talkStartedAt = Date.now();
        state.pttMaxMs = m.maxMs;
        break;
      case 'ptt.denied':
        endTalk(false);
        notify(m.message || DENY_TEXT[m.code] || '暂时无法对讲');
        break;
      case 'ptt.released':
        if (state.pttPhase !== 'idle') {
          endTalk(false);
          if (m.reason === 'max_duration') notify('单次最长 60 秒，已自动松开');
          else if (m.reason === 'peer_offline') notify('对方已离线');
          else if (m.reason === 'idle') notify('网络不稳定，已自动松开');
        }
        break;
      case 'ptt.peer_start':
        state.peerTalking = true;
        vibrate(); // 像对讲机“咔哒”一声：对方开始讲话时轻震
        ensurePlayer();
        if (player && player.reset) player.reset();
        break;
      case 'ptt.peer_stop':
        state.peerTalking = false;
        if (player) player.reset();
        break;
      case 'loc.started':
        state.myShare = { startedAt: m.startedAt };
        if (m.consent) state.locationConsent = m.consent;
        startWatch();
        break;
      case 'loc.denied':
        if (m.code === 'consent_required') {
          state.locationConsent = m.consent || { accepted: false, version: '' };
          state.consentPrompt++;
          break;
        }
        notify(m.message || '无法开始共享');
        break;
      case 'loc.stopped':
        state.myShare = null;
        stopWatching();
        notify(STOP_TEXT[m.reason] || '位置共享已停止');
        break;
      case 'loc.peer_started':
        state.peerShare = { startedAt: m.startedAt, last: m.last || null };
        break;
      case 'loc.peer_update':
        if (!state.peerShare) state.peerShare = { startedAt: null, last: null };
        state.peerShare.last = { lng: m.lng, lat: m.lat, accuracy: m.accuracy, heading: m.heading, speed: m.speed, ts: m.ts };
        break;
      case 'loc.peer_stopped':
        state.peerShare = null;
        break;
      case 'loc.ack':
        state.sentCount++;
        break;
      default:
    }
  }

  function onBin(data) {
    if (!state.peerTalking) return;
    const p = ensurePlayer();
    if (!p.unlocked) state.audioLocked = true;
    p.push(data);
  }

  const offMsg = client.on(onMsg);
  const offBin = client.onBinary(onBin);
  const offState = client.onState((s) => { state.connection = s; });

  /* ---------- 对讲 ---------- */
  async function pttDown() {
    ensurePlayer().unlock(); // 借用这次手势解锁播放
    state.audioLocked = false;
    if (!state.perms.walkieTalkie.allowed) return notify(state.perms.walkieTalkie.reason || '暂时无法对讲');
    if (!state.audioSupport.ok) return notify(state.audioSupport.reason);
    if (state.peerTalking) return notify(DENY_TEXT.busy);
    if (!state.peerOnline) return notify(DENY_TEXT.peer_offline);
    if (state.pttPhase !== 'idle') return;
    wantTalking = true;
    state.pttPhase = 'requesting';
    ensureCapture();
    try {
      await capture.start();
    } catch (e) {
      wantTalking = false;
      state.pttPhase = 'idle';
      return;
    }
    if (!wantTalking) { capture.stop(); state.pttPhase = 'idle'; return; }
    client.send({ t: 'ptt.start', chatId });
  }

  function ensureCapture() {
    if (!capture) {
      capture = provider.createCapture({
        onFrame: (buf) => {
          stats.framesCaptured++;
          if (state.pttPhase === 'talking' && client.sendBinary(buf)) stats.framesSent++;
        },
        onLevel: (l) => { state.level = l; },
        onError: (e) => notify(e.message || '麦克风不可用')
      });
    }
    return capture;
  }

  // 对讲机面板打开时调用（须在用户手势内）：预热采集端音频
  function prepareTalk() {
    if (!state.audioSupport.ok || !state.perms.walkieTalkie.allowed) return;
    const c = ensureCapture();
    if (c && c.prepare) c.prepare();
  }

  function endTalk(sendStop = true) {
    wantTalking = false;
    if (capture) capture.stop();
    if (sendStop && state.pttPhase !== 'idle') client.send({ t: 'ptt.stop', chatId });
    state.pttPhase = 'idle';
    state.level = 0;
  }

  function pttUp() { endTalk(true); }

  function unlockAudio() { ensurePlayer().unlock(); state.audioLocked = false; }

  /* ---------- 位置共享 ---------- */
  function startShare(consent) {
    if (!state.perms.locationShare.allowed) return notify(state.perms.locationShare.reason || '暂时无法共享位置');
    client.send({ t: 'loc.start', chatId, consent: consent === true });
  }
  function stopShare() {
    client.send({ t: 'loc.stop', chatId });
    // 立即停止本机定位（不等服务端回包）
    stopWatching();
    state.myShare = null;
  }
  function startWatch() {
    if (stopWatch) return;
    gate = createSendGate();
    state.locError = '';
    stopWatch = getLocationProvider().watch((fix) => {
      const [lng, lat] = fix.coord === 'gcj02' ? gcj02ToWgs84(fix.lng, fix.lat) : [fix.lng, fix.lat];
      state.myFix = { lng, lat, accuracy: fix.accuracy, heading: fix.heading, ts: fix.ts };
      if (state.myShare && gate(fix)) client.send({ t: 'loc.update', chatId, ...fix });
    }, (e) => { state.locError = e.message; notify(e.message); });
  }
  function stopWatching() {
    if (stopWatch) { stopWatch(); stopWatch = null; }
    state.myFix = null;
  }

  return {
    state,
    attach() { attached++; client.join(chatId); },
    detach() {
      attached = Math.max(0, attached - 1);
      if (attached === 0) {
        endTalk(true);
        if (capture) { capture.dispose(); capture = null; }
        // 位置共享在离开页面后继续（直到停止或退出共享页），所以不 leave 会话订阅
        if (!state.myShare && !state.peerShare) client.leave(chatId);
      }
    },
    pttDown, pttUp, unlockAudio, startShare, stopShare,
    playerStats() { return player && player.stats ? { ...player.stats } : null; },
    prepareTalk,
    captureStats() { return { ...stats, phase: state.pttPhase }; },
    dispose() {
      endTalk(true); stopWatching();
      if (capture) capture.dispose();
      if (player) player.dispose();
      offMsg(); offBin(); offState();
      sessions.delete(chatId);
    }
  };
}

export function getChatRealtime(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, createSession(chatId));
  return sessions.get(chatId);
}

// #ifdef H5
// 仅 H5：暴露只读调试入口，供 Playwright 端到端测试检查播放统计（不含任何密钥或位置历史）
if (typeof window !== 'undefined') window.__wjdRealtime = { sessions };
// #endif

/** 退出登录时调用：结束全部实时会话 */
export function disposeAllRealtime() {
  for (const s of [...sessions.values()]) s.dispose();
  getRealtimeClient().close();
}

export function distanceMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371008.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} 米`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} 公里`;
}
