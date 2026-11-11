<template>
  <view class="container">
    <view class="search-box">
      <input v-model="keyword" placeholder="搜索同事姓名" class="input" @confirm="doSearch" />
      <view class="btn-primary small" @tap="doSearch">搜索</view>
    </view>

    <view v-if="!keyword && orgTree.length" class="muted org-title">组织架构</view>
    <view v-for="g in displayTree" :key="g.id" class="card">
      <view class="group-name">{{ g.name }}</view>
      <view v-for="c in g.companies" :key="c.id">
        <view class="company-name">{{ c.name }}</view>
        <view v-for="d in c.departments" :key="d.id" class="muted dept">
          {{ d.name }}（{{ d.memberCount }}人）
        <text class="link" @tap="searchDept">查看</text>
        </view>
      </view>
    </view>

    <!-- 搜索结果 -->
    <view v-for="u in results" :key="u.id" class="card chat-item">
      <view class="avatar" :style="{ background: u.avatarColor }">{{ u.displayName[0] }}</view>
      <view class="chat-main">
        <view class="row1">
          <text class="name">{{ u.displayName }}</text>
          <text class="badge badge-org" :class="{ expired: !u.orgCertified }">{{ u.orgCertified ? '组织已认证' : '未认证' }}</text>
          <text v-if="u.realnameCertified" class="badge badge-realname">实名已认证</text>
        </view>
        <view class="muted">{{ u.company }} · {{ u.department }} · {{ relationLabel(u.relation) }}</view>
        <view v-if="u.chatPermission.reason" class="muted warn">{{ u.chatPermission.reason }}</view>
      </view>
      <view
        class="btn-primary small"
        :class="{ disabled: !u.chatPermission.canInitiate }"
        @tap="initiate(u)"
      >{{ initiateLabel(u) }}</view>
    </view>
  </view>
</template>

<script>
import { api } from '@/api';

export default {
  data() {
    return { keyword: '', orgTree: [], results: [], searched: false };
  },
  computed: {
    displayTree() {
      return this.searched ? [] : this.orgTree;
    }
  },
  onShow() {
    if (!this.orgTree.length) api.orgStructure().then(r => { this.orgTree = r.data; });
  },
  methods: {
    relationLabel(r) {
      return { same_company: '同公司', same_group_cross_company: '同集团·不同公司', cross_group: '跨集团' }[r] || r;
    },
    initiateLabel(u) {
      if (!u.chatPermission.canInitiate) return '不可发起';
      return u.chatPermission.needRequest ? '申请聊天' : '直接聊天';
    },
    async doSearch() {
      const res = await api.searchUsers(this.keyword);
      this.results = res.data;
      this.searched = true;
    },
    async searchDept() {
      // 部门人员查看：复用搜索接口（V1 简化为提示按姓名搜索）
      uni.showToast({ title: '请按姓名搜索同事', icon: 'none' });
    },
    async initiate(u) {
      if (!u.chatPermission.canInitiate) {
        uni.showModal({ title: '暂不能发起', content: u.chatPermission.reason || '不满足条件', showCancel: false });
        return;
      }
      const res = await api.chatRequest(u.id, '你好');
      uni.showModal({ title: '已发起', content: res.data?.message || res.message || '操作成功', showCancel: false });
    }
  }
};
</script>

<style>
.search-box { display: flex; gap: 16rpx; margin-bottom: 24rpx; }
.search-box .input { flex: 1; background: #fff; border-radius: 16rpx; padding: 20rpx 24rpx; font-size: 28rpx; }
.search-box .btn-primary { margin-top: 0; padding: 14rpx 28rpx; }
.org-title { margin: 8rpx 0 16rpx; }
.group-name { font-size: 30rpx; font-weight: 700; margin-bottom: 12rpx; }
.company-name { font-size: 28rpx; font-weight: 600; color: #445; margin: 16rpx 0 8rpx; }
.dept { padding: 6rpx 0 6rpx 16rpx; }
.link { color: #4c7dff; margin-left: 16rpx; }
.warn { color: #b25e00; margin-top: 6rpx; }
.chat-item { display: flex; align-items: center; }
.avatar { width: 88rpx; height: 88rpx; border-radius: 20rpx; color: #fff; font-size: 36rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.chat-main { flex: 1; margin: 0 16rpx; overflow: hidden; }
.row1 { display: flex; align-items: center; margin-bottom: 8rpx; }
.name { font-size: 32rpx; font-weight: 600; }
.chat-item .btn-primary { margin-top: 0; padding: 12rpx 20rpx; font-size: 24rpx; flex-shrink: 0; }
</style>
