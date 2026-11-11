<template>
  <view class="container">
    <!-- 早期微信通讯录：灰色搜索条 + 功能入口 + 分组通栏列表 -->
    <view class="search-bar">
      <view class="search-inner">
        <view class="mag"></view>
        <input v-model="keyword" placeholder="搜索同事姓名" class="search-input" confirm-type="search" @confirm="doSearch" />
      </view>
      <text v-if="keyword" class="search-act" @tap="doSearch">搜索</text>
    </view>

    <!-- 搜索结果 -->
    <block v-if="searched">
      <view class="cells-title">搜索结果（{{ results.length }}）</view>
      <view class="cells">
        <view v-for="u in results" :key="u.id" class="cell person access" @tap="openProfile(u)">
          <view class="avatar-sq small" :style="{ background: u.avatarColor }" @tap.stop="openProfile(u)">{{ u.displayName[0] }}</view>
          <view class="cell-bd person-main">
            <view class="row1">
              <text class="name">{{ u.displayName }}</text>
              <text class="badge badge-org" :class="{ expired: !u.orgCertified }">{{ u.orgCertified ? '组织已认证' : '未认证' }}</text>
              <text v-if="u.realnameCertified" class="badge badge-realname">实名</text>
            </view>
            <view class="sub">{{ u.company }} · {{ u.department }} · {{ relationLabel(u.relation) }}</view>
            <view v-if="u.chatPermission.reason" class="sub warn">{{ u.chatPermission.reason }}</view>
          </view>
        </view>
        <view v-if="!results.length" class="cell"><text class="muted">没有找到相关同事</text></view>
      </view>
      <view class="cells-tips link" @tap="clearSearch">返回组织架构</view>
    </block>

    <!-- 组织架构 -->
    <block v-else>
      <view class="cells">
        <view class="cell access" @tap="focusSearch">
          <view class="func-ico green"><view class="fi-person"></view></view>
          <view class="cell-bd">按姓名找同事</view>
        </view>
        <view class="cell access" @tap="goCert">
          <view class="func-ico blue"><view class="fi-badge"></view></view>
          <view class="cell-bd">组织认证</view>
        </view>
      </view>
      <block v-for="g in displayTree" :key="g.id">
        <view class="section-letter">{{ g.name }}</view>
        <view class="cells flat">
          <block v-for="c in g.companies" :key="c.id">
            <view class="cell company"><text>{{ c.name }}</text></view>
            <view v-for="d in c.departments" :key="d.id" class="cell dept access" @tap="searchDept">
              <view class="dept-ico">{{ d.name.slice(0, 1) }}</view>
              <view class="cell-bd">{{ d.name }}</view>
              <text class="cell-ft">{{ d.memberCount }}人</text>
            </view>
          </block>
        </view>
      </block>
    </block>
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
    openProfile(u) {
      if (!u || !u.id) return;
      uni.navigateTo({ url: `/pages/user-profile/user-profile?userId=${u.id}` });
    },
    async doSearch() {
      if (!this.keyword.trim()) return;
      const res = await api.searchUsers(this.keyword);
      this.results = res.data;
      this.searched = true;
    },
    clearSearch() { this.keyword = ''; this.searched = false; this.results = []; },
    focusSearch() { uni.showToast({ title: '在上方输入同事姓名', icon: 'none' }); },
    goCert() { uni.navigateTo({ url: '/pages/cert-org/cert-org' }); },
    async searchDept() {
      // 部门人员查看：复用搜索接口（V1 简化为提示按姓名搜索）
      uni.showToast({ title: '请按姓名搜索同事', icon: 'none' });
    },

  }
};
</script>

<style>
.search-bar { display: flex; align-items: center; padding: 16rpx 20rpx; background: #EDEDED; border-bottom: 1rpx solid #D9D9D9; }
.search-inner { flex: 1; display: flex; align-items: center; background: #fff; border-radius: 16rpx; height: 64rpx; padding: 0 16rpx; border: 1rpx solid #E0E0E0; }
.mag { width: 22rpx; height: 22rpx; border: 3rpx solid #B2B2B2; border-radius: 50%; position: relative; margin-right: 14rpx; flex-shrink: 0; }
.mag::after { content: ''; position: absolute; width: 3rpx; height: 12rpx; background: #B2B2B2; right: -6rpx; bottom: -10rpx; transform: rotate(-45deg); }
.search-input { flex: 1; font-size: 28rpx; }
.search-act { color: #09BB07; font-size: 30rpx; margin-left: 20rpx; }
.cells.flat { margin-top: 0; }
.section-letter { padding: 8rpx 30rpx; font-size: 24rpx; color: #888; background: #EDEDED; }
.func-ico { width: 72rpx; height: 72rpx; border-radius: 20rpx; margin-right: 24rpx; display: flex; align-items: center; justify-content: center; }
.func-ico.green { background: #F9A33A; }
.func-ico.blue { background: #3C83D6; }
.fi-person { width: 26rpx; height: 26rpx; border-radius: 50%; border: 4rpx solid #fff; box-sizing: border-box; box-shadow: 0 22rpx 0 -4rpx #fff; margin-top: -14rpx; }
.fi-badge { width: 34rpx; height: 28rpx; border: 4rpx solid #fff; border-radius: 8rpx; box-sizing: border-box; }
.company { font-size: 26rpx; color: #888; min-height: 60rpx; background: #F7F7F7; }
.dept-ico { width: 72rpx; height: 72rpx; border-radius: 20rpx; background: #7EA6D9; color: #fff; display: flex; align-items: center; justify-content: center; margin-right: 24rpx; font-size: 30rpx; }
.person { align-items: flex-start; }
.avatar-sq.small { width: 80rpx; height: 80rpx; font-size: 34rpx; }
.person-main { margin: 0 20rpx; }
.row1 { display: flex; align-items: center; margin-bottom: 6rpx; }
.name { font-size: 32rpx; }
.sub { font-size: 24rpx; color: #888; }
.warn { color: #B26A00; margin-top: 4rpx; }
.mini-btn { background: #1AAD19; color: #fff; border-radius: 16rpx; padding: 10rpx 20rpx; font-size: 26rpx; flex-shrink: 0; align-self: center; border: 1rpx solid #179B16; }
.mini-btn.disabled { background: #F8F8F8; color: #B2B2B2; border-color: #D9D9D9; }
</style>
