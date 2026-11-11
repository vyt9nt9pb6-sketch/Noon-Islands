/**
 * 位置共享隐私提示（只在第一次使用时弹出；“我 → 隐私”可随时查看与撤回）
 * 修改要点内容时，同步提升后端 LOCATION_PRIVACY_VERSION（backend/src/services/consent.js），所有用户会重新看到一次。
 */
export const LOCATION_NOTICE_TITLE = '位置共享隐私提示';

export const LOCATION_NOTICE_POINTS = [
  { k: '谁能看到', v: '只有当前单聊的对方能看到你的实时位置，其他人（包括群、通讯录里的同事）都看不到。' },
  { k: '位置不保存', v: '位置只在服务器内存中转发，仅保留“最后一个点”给对方显示；不写入数据库、不做历史轨迹。' },
  { k: '退出即删除', v: '共享没有时间限制，一直持续到你点地图页左上角“退出共享”（点“收起”则在后台继续共享，聊天页顶部可随时停止）。退出共享或断线超过 60 秒后，内存中的位置立即删除。' },
  { k: '地图', v: 'App / 网页版底图使用 OpenStreetMap 开放数据；微信小程序使用微信自带地图。地图服务不会收到你的账号信息。' },
  { k: '随时撤回', v: '可在“我 → 隐私 → 位置共享”查看或撤回本授权；撤回后正在进行的共享立即结束。' }
];

export const LOCATION_NOTICE_CONFIRM = '点击“确认并开始共享”即表示你已阅读并同意本提示和《隐私权政策》中关于实时位置的说明。此提示只出现这一次。';

export function noticePlainText() {
  return LOCATION_NOTICE_POINTS.map(p => `【${p.k}】${p.v}`).join('\n');
}
