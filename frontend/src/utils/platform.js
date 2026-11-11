/**
 * 平台识别与服务端功能开关
 * iOS 端不渲染“付费查看姓名”入口（服务端开关兜底）
 */

/** 当前运行平台标识（与服务端 flags.disabledPlatforms 对齐） */
export function currentPlatform() {
  // #ifdef APP-IOS || APP-IOS+Nvue
  return 'ios';
  // #endif
  // #ifdef APP-ANDROID || APP-ANDROID+Nvue
  return 'android';
  // #endif
  // #ifdef APP-HARMONY
  return 'harmony';
  // #endif
  // #ifdef MP-WEIXIN
  return 'mp-weixin';
  // #endif
  // #ifdef H5
  return 'h5';
  // #endif
  return 'unknown';
}

/** iOS 端付费查看姓名入口隐藏（V1 硬约束） */
export function isPaidNameViewAvailable() {
  return currentPlatform() !== 'ios';
}
