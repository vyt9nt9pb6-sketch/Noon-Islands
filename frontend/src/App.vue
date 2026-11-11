<script>
export default {
  onLaunch() {
    console.log('[午间岛] App Launch');
  }
};
</script>

<style>
/*
 * 全局样式（V1.2：早期微信风格 —— 浅灰底 #EDEDED、深色标题栏、绿色强调色、通栏列表 + 细分隔线）
 * 全部为自写 CSS，未使用任何腾讯图片 / 字体素材。
 */
page {
  background-color: #EDEDED;
  color: #000000;
  font-size: 32rpx;
  font-family: -apple-system, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  --wx-green: #09BB07;
  --wx-green-btn: #1AAD19;
  --wx-link: #576B95;
  --wx-line: #D9D9D9;
}
.container { padding: 0; }

/* 列表分组 + 单元格（早期微信“设置”页样式） */
.cells { background: #fff; margin-top: 40rpx; border-top: 1rpx solid #D9D9D9; border-bottom: 1rpx solid #D9D9D9; }
.cells-title { margin-top: 30rpx; padding: 0 30rpx 12rpx; font-size: 26rpx; color: #888; }
.cells-title + .cells { margin-top: 0; }
.cell { position: relative; display: flex; align-items: center; min-height: 92rpx; padding: 18rpx 30rpx; box-sizing: border-box; font-size: 32rpx; background: #fff; }
.cell:active { background: #ECECEC; }
.cell + .cell::before { content: ''; position: absolute; left: 30rpx; right: 0; top: 0; height: 1rpx; background: #E5E5E5; }
.cell-bd { flex: 1; min-width: 0; }
.cell-ft { color: #888; font-size: 28rpx; display: flex; align-items: center; }
.cell-ft.access::after, .cell.access::after { content: ''; width: 16rpx; height: 16rpx; border-top: 3rpx solid #C8C8CD; border-right: 3rpx solid #C8C8CD; transform: rotate(45deg); margin-left: 14rpx; }
.cells-tips { padding: 14rpx 30rpx 0; font-size: 26rpx; color: #888; line-height: 1.5; }

/* 头像：早期微信的圆角方形头像 */
.avatar-sq { width: 96rpx; height: 96rpx; border-radius: 18rpx; color: #fff; font-size: 40rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

.badge { display: inline-flex; align-items: center; font-size: 20rpx; border-radius: 8rpx; padding: 0 8rpx; margin-left: 12rpx; line-height: 32rpx; border: 1rpx solid; }
.badge-org { color: #576B95; border-color: #576B95; background: #fff; }
.badge-org.expired { color: #999; border-color: #ccc; }
.badge-realname { color: #09BB07; border-color: #09BB07; background: #fff; }

/* 按钮：早期微信绿色主按钮 / 白色默认按钮 / 红色警示按钮 */
.btn-primary { background: #1AAD19; color: #fff; border-radius: 20rpx; font-size: 34rpx; height: 92rpx; line-height: 92rpx; text-align: center; margin: 40rpx 30rpx 0; border: 1rpx solid #179B16; }
.btn-primary:active { background: #179B16; color: rgba(255, 255, 255, 0.6); }
.btn-primary.disabled { background: #9ED99D; border-color: #9ED99D; color: rgba(255, 255, 255, 0.6); }
.btn-default { background: #F8F8F8; color: #000; border-radius: 20rpx; font-size: 34rpx; height: 92rpx; line-height: 92rpx; text-align: center; margin: 30rpx 30rpx 0; border: 1rpx solid #D9D9D9; }
.btn-warn { background: #E64340; color: #fff; border-radius: 20rpx; font-size: 34rpx; height: 92rpx; line-height: 92rpx; text-align: center; margin: 30rpx 30rpx 0; border: 1rpx solid #CE3C39; }

.card { background: #fff; padding: 28rpx 30rpx; margin-top: 30rpx; border-top: 1rpx solid #D9D9D9; border-bottom: 1rpx solid #D9D9D9; }
.tip-bar { background: #FFF8E1; color: #8A6D3B; font-size: 26rpx; padding: 16rpx 30rpx; border-bottom: 1rpx solid #F0E2B6; }
.divider { height: 1rpx; background: #E5E5E5; margin: 24rpx 0; }
.muted { color: #888; font-size: 26rpx; }
.link { color: #576B95; }
input { font-size: 32rpx; }
.card .btn-primary, .card .btn-warn, .card .btn-default { margin-left: 0; margin-right: 0; }
.ghost { background: #F8F8F8 !important; color: #000 !important; border: 1rpx solid #D9D9D9 !important; }
</style>
