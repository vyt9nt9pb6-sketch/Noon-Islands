/**
 * 实时通道客户端（全局单例）：uni.connectSocket —— H5 / App / 鸿蒙 / 微信小程序 统一 API
 *
 * - 首条消息鉴权 {t:'auth', token, platform}（不把 token 放 URL）
 * - 断线指数退避重连（1s → 2s → 4s … 最长 15s），重连后自动重新订阅会话
 * - 应用层心跳：每 20s 发 ping，40s 无任何消息则主动断开重连
 *   （参考 websockets/ws issue #1467：客户端也要能发现“半开”连接）
 */
import { wsUrl, getToken } from '@/api';
import { currentPlatform } from '@/utils/platform';

class RealtimeClient {
  constructor() {
    this.task = null;
    this.state = 'idle'; // idle | connecting | open | authed | closed
    this.listeners = new Set();
    this.binListeners = new Set();
    this.stateListeners = new Set();
    this.joined = new Set();
    this.retry = 0;
    this.lastRx = 0;
    this.manualClose = false;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onBinary(fn) { this.binListeners.add(fn); return () => this.binListeners.delete(fn); }
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  _setState(s) { this.state = s; this.stateListeners.forEach(fn => fn(s)); }

  connect() {
    if (this.task && (this.state === 'connecting' || this.state === 'open' || this.state === 'authed')) return;
    const token = getToken();
    if (!token) return;
    this.manualClose = false;
    this._setState('connecting');
    const task = uni.connectSocket({ url: wsUrl(), complete: () => {} });
    this.task = task;
    task.onOpen(() => {
      if (this.task !== task) return;
      this._setState('open');
      this.lastRx = Date.now();
      this._sendRaw(JSON.stringify({ t: 'auth', token, platform: currentPlatform() }));
    });
    task.onMessage((res) => {
      if (this.task !== task) return;
      this.lastRx = Date.now();
      const data = res.data;
      if (typeof data !== 'string') {
        this.binListeners.forEach(fn => fn(data));
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.t === 'auth.ok') {
        this.retry = 0;
        this.userId = msg.userId;
        this._setState('authed');
        this.joined.forEach(chatId => this.send({ t: 'chat.join', chatId }));
        this._startHeartbeat();
      }
      this.listeners.forEach(fn => fn(msg));
    });
    task.onClose((res) => {
      if (this.task !== task) return;
      this._cleanup();
      this._setState('closed');
      this.listeners.forEach(fn => fn({ t: 'socket.closed', code: res && res.code }));
      if (res && res.code === 4401) return; // 登录失效：不重连
      if (!this.manualClose) this._scheduleReconnect();
    });
    task.onError(() => { /* onClose 会接着触发 */ });
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(15000, 1000 * Math.pow(2, this.retry++));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _startHeartbeat() {
    clearInterval(this.hb);
    this.hb = setInterval(() => {
      if (Date.now() - this.lastRx > 40000) { try { this.task.close({ code: 1000 }); } catch (e) { /* */ } return; }
      this.send({ t: 'ping' });
    }, 20000);
  }

  _cleanup() { clearInterval(this.hb); this.task = null; }

  _sendRaw(data) {
    if (!this.task) return false;
    this.task.send({ data, fail: () => {} });
    return true;
  }

  send(obj) {
    if (this.state !== 'authed' && obj.t !== 'auth') return false;
    return this._sendRaw(JSON.stringify(obj));
  }

  sendBinary(arrayBuffer) {
    if (this.state !== 'authed') return false;
    return this._sendRaw(arrayBuffer);
  }

  join(chatId) {
    this.joined.add(chatId);
    this.connect();
    if (this.state === 'authed') this.send({ t: 'chat.join', chatId });
  }

  leave(chatId) {
    this.joined.delete(chatId);
    this.send({ t: 'chat.leave', chatId });
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    if (this.task) { try { this.task.close({ code: 1000 }); } catch (e) { /* */ } }
    this._cleanup();
    this.joined.clear();
    this._setState('idle');
  }
}

let instance = null;
export function getRealtimeClient() {
  if (!instance) instance = new RealtimeClient();
  return instance;
}
