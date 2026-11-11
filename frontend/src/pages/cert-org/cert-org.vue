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
      <view v-if="!status.certified" class="muted sub">今日剩余定位核验机会：{{ status.attemptsLeft }}/3</view>
    </view>

    <view v-if="!status.certified" class="card">
      <view class="title">方式一：定位核验（推荐）</view>
      <view class="muted">
        仅做一次性距离核验：核对当前位置是否在 {{ company.name || '所属公司' }} 注册地址（{{ company.addressLabel || '注册地址' }}）允许半径内。
        <text class="em">不保存经纬度、不记录轨迹</text>，仅保存“是否在半径内”与核验时间。
      </view>
      <view class="btn-primary" :class="{ disabled: status.attemptsLeft <= 0 }" @tap="verifyLocation">
        一次性定位核验
      </view>
      <view class="muted center">拒绝定位？可使用下方材料上传完成认证，不因拒绝定位而阻断认证</view>
    </view>

    <view v-if="!status.certified" class="card">
      <view class="title">方式二：上传劳动合同、工牌等材料</view>
      <view class="muted">
        请至少上传劳动合同和工牌各一份，也可附加其他证明。本方式只做认证、不做内容核验，也不经企业管理员审核；材料提交后认证立即生效，有效期 6 个月。
      </view>
      <view class="doc-block">
        <view class="doc-h">劳动合同（至少 1 份）</view>
        <view v-for="(f, i) in contracts" :key="'c'+i" class="doc-item">
          <text class="doc-name">{{ f.name }}</text>
          <text class="doc-del" @tap="removeFile('contract', i)">删除</text>
        </view>
        <view class="btn-primary ghost" @tap="pick('contract')">添加劳动合同</view>
      </view>
      <view class="doc-block">
        <view class="doc-h">工牌（至少 1 份）</view>
        <view v-for="(f, i) in badges" :key="'b'+i" class="doc-item">
          <text class="doc-name">{{ f.name }}</text>
          <text class="doc-del" @tap="removeFile('badge', i)">删除</text>
        </view>
        <view class="btn-primary ghost" @tap="pick('badge')">添加工牌</view>
      </view>
      <view class="doc-block">
        <view class="doc-h">其他证明（可选）</view>
        <view v-for="(f, i) in others" :key="'o'+i" class="doc-item">
          <text class="doc-name">{{ f.name }}</text>
          <text class="doc-del" @tap="removeFile('other', i)">删除</text>
        </view>
        <view class="btn-primary ghost" @tap="pick('other')">添加其他材料</view>
      </view>
      <view class="btn-primary" :class="{ disabled: !canSubmitDocs }" @tap="submitDocs">提交并完成认证</view>
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
      files: []
    };
  },
  computed: {
    statusText() {
      if (this.status.certified) return '已认证';
      if (this.status.reason === 'expired') return '已过期（新消息发送被阻断）';
      if (this.status.reason === 'departed') return '已离职（组织关系失效）';
      return '未认证';
    },
    contracts() { return this.files.filter(f => f.kind === 'contract'); },
    badges() { return this.files.filter(f => f.kind === 'badge'); },
    others() { return this.files.filter(f => f.kind === 'other'); },
    canSubmitDocs() { return this.contracts.length >= 1 && this.badges.length >= 1 && this.files.length <= 6; }
  },
  async onShow() {
    const [s, c] = await Promise.all([api.orgCertStatus(), api.myCompany()]);
    this.status = s.data;
    this.company = c.data || { name: '', addressLabel: '' };
  },
  onReady() { this.mountH5Inputs(); },
  onUnload() { this.unmountH5Inputs(); },
  methods: {
    fmt(iso) { return iso ? new Date(iso).toLocaleDateString('zh-CN') : ''; },
    verifyLocation() {
      if (this.status.attemptsLeft <= 0) {
        uni.showToast({ title: '今日次数已用完，请上传证明材料', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '位置权限说明',
        content: '仅在使用期间获取一次位置用于距离核验，不保存坐标、不记录轨迹。你也可以选择拒绝并改用上传劳动合同和工牌。',
        confirmText: '继续核验',
        success: (m) => { if (m.confirm) this.doLocate(); }
      });
    },
    doLocate() {
      uni.getLocation({
        type: 'wgs84',
        success: async (pos) => {
          const res = await api.orgVerifyLocation(pos.latitude, pos.longitude);
          if (res.data.passed) {
            uni.showModal({ title: '核验通过', content: `组织认证已生效，有效期至 ${this.fmt(res.data.validUntil)}`, showCancel: false });
          } else {
            uni.showModal({
              title: '未通过',
              content: `${res.data.reason}。剩余机会 ${res.data.attemptsLeft}/3。也可改用上传劳动合同和工牌。`,
              showCancel: false
            });
          }
          const s = await api.orgCertStatus();
          this.status = s.data;
        },
        fail: () => {
          uni.showModal({
            title: '未授权定位',
            content: '你已拒绝定位授权。这不影响认证：请使用下方“上传劳动合同、工牌等材料”完成组织认证。',
            showCancel: false
          });
        }
      });
    },
    mountH5Inputs() {
      // uni-app 的 <input> 会编译成 uni-input，H5 上不是原生 file。这里挂真实 input 供选文件和 e2e。
      if (typeof document === 'undefined') return;
      this.unmountH5Inputs();
      this._docInputs = ['contract', 'badge', 'other'].map((kind) => {
        const el = document.createElement('input');
        el.type = 'file';
        el.accept = 'image/*,.pdf,application/pdf';
        el.id = 'doc-' + kind;
        el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
        el.addEventListener('change', (e) => this.onH5File(e, kind));
        document.body.appendChild(el);
        return el;
      });
    },
    unmountH5Inputs() {
      (this._docInputs || []).forEach((el) => el.remove());
      this._docInputs = [];
    },
    pick(kind) {
      // H5：触发隐藏原生 file input；App / 小程序走 chooseImage
      if (typeof document !== 'undefined') {
        const el = document.getElementById('doc-' + kind);
        if (el) { el.value = ''; el.click(); return; }
      }
      uni.chooseImage({
        count: 1,
        success: (res) => {
          const path = (res.tempFilePaths && res.tempFilePaths[0]) || '';
          this.readLocal(path, kind);
        }
      });
    },
    onH5File(e, kind) {
      const file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        this.files.push({ kind, name: file.name, mime: file.type || 'application/octet-stream', data });
      };
      reader.readAsDataURL(file);
    },
    readLocal(filePath, kind) {
      const name = String(filePath).split('/').pop() || kind + '.jpg';
      const done = (data, mime) => {
        this.files.push({ kind, name, mime: mime || 'image/jpeg', data });
      };
      if (typeof plus !== 'undefined' && plus.io) {
        plus.io.resolveLocalFileSystemURL(filePath, (entry) => {
          entry.file((f) => {
            const reader = new plus.io.FileReader();
            reader.onloadend = (ev) => {
              const dataUrl = String((ev.target && ev.target.result) || '');
              done(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl, f.type);
            };
            reader.readAsDataURL(f);
          });
        });
        return;
      }
      const fs = uni.getFileSystemManager && uni.getFileSystemManager();
      if (fs && fs.readFile) {
        fs.readFile({
          filePath,
          encoding: 'base64',
          success: (r) => done(r.data, 'image/jpeg')
        });
      }
    },
    removeFile(kind, indexInKind) {
      let seen = 0;
      this.files = this.files.filter((f) => {
        if (f.kind !== kind) return true;
        if (seen === indexInKind) { seen++; return false; }
        seen++;
        return true;
      });
    },
    async submitDocs() {
      if (!this.canSubmitDocs) {
        return uni.showToast({ title: '请至少上传劳动合同和工牌各一份', icon: 'none' });
      }
      const res = await api.orgSubmitDocuments(this.files);
      if (res.code === 0 && res.data && res.data.passed) {
        uni.showModal({
          title: '认证已生效',
          content: `材料已提交（不做真伪核验）。组织认证有效期至 ${this.fmt(res.data.validUntil)}`,
          showCancel: false
        });
        const s = await api.orgCertStatus();
        this.status = s.data;
        this.files = [];
      }
    }
  }
};
</script>

<style>
.title { font-size: 32rpx; font-weight: 600; margin-bottom: 12rpx; }
.row { display: flex; justify-content: space-between; align-items: center; }
.ok { color: #09BB07; }
.bad { color: #E64340; }
.sub { margin-top: 12rpx; }
.center { text-align: center; margin-top: 16rpx; }
.em { color: #B26A00; }
.doc-block { margin-top: 24rpx; }
.doc-h { font-size: 28rpx; margin-bottom: 8rpx; }
.doc-item { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 0; font-size: 26rpx; }
.doc-name { color: #353535; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-del { color: #E64340; margin-left: 16rpx; }
.ghost { background: #F8F8F8; color: #576B95; margin-top: 8rpx; }
.file-input { position: fixed; left: -9999px; width: 1px; height: 1px; opacity: 0; }
</style>
