<script>
export default {
  onLaunch() {
    console.log('[午间岛] App Launch');
  }
};
</script>

<style>
/* 全局样式 */
page {
  background-color: #f5f6fa;
  color: #1f2329;
  font-size: 28rpx;
}
.container {
  padding: 24rpx;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 20rpx;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
}
.badge-org {
  background: #e8f3ff;
  color: #2b7fff;
}
.badge-org.expired {
  background: #f0f1f3;
  color: #999;
}
.badge-realname {
  background: #e8fff2;
  color: #27ba6e;
}
.btn-primary {
  background: #4c7dff;
  color: #fff;
  border-radius: 16rpx;
  font-size: 30rpx;
  padding: 20rpx 0;
  text-align: center;
  margin-top: 24rpx;
}
.btn-primary.disabled {
  opacity: 0.5;
}
.btn-warn {
  background: #fff;
  color: #e64a3a;
  border: 1rpx solid #e64a3a;
  border-radius: 16rpx;
  font-size: 30rpx;
  padding: 20rpx 0;
  text-align: center;
  margin-top: 24rpx;
}
.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.tip-bar {
  background: #fff7e8;
  color: #b25e00;
  font-size: 24rpx;
  padding: 16rpx 24rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}
.divider {
  height: 1rpx;
  background: #eee;
  margin: 24rpx 0;
}
.muted {
  color: #8f959e;
  font-size: 24rpx;
}
</style>
