# 午间岛 (WuJian Island)

> 组织身份 · 即时通信 · 实名互认 —— 一套代码，四端交付：**Android App / iOS App / HarmonyOS（鸿蒙）/ 微信小程序**

午间岛是面向组织身份场景的即时通信服务：

- **同公司** → 直接聊
- **同集团、跨公司** → 双方完成组织认证后方可申请聊天
- **跨集团** → 先聊（受限模式：仅文字），后增强信任
- **实名认证**是信任增强徽章，**不是**聊天前置门槛；姓名展示需被查看方**逐次单独同意**
- **V1.1 新增（仅单聊）**：**按住说话实时对讲**（像对讲机，同一时间只一人讲）+ **实时位置共享**（无时长限制，地图上实时移动，共享时也能按住说话；退出即删除）——设计与调研见 [docs/对讲与位置共享设计.md](docs/对讲与位置共享设计.md)
- **V1.2**：全站**早期微信风格**；1v1 聊天里的**模拟对讲机**（天线 / 网罩 / LED / PTT 大键，无液晶屏和多余按键，输入栏对讲机键替代语音键）；地图改用 **OpenStreetMap 数据 + MapLibre GL**（自带 PMTiles 底图，不再使用高德）；位置共享**隐私提示只在首次使用时弹出**，**没有时间限制**，位置不保存、退出即删除——见 [docs/V1.2-界面与地图改版.md](docs/V1.2-界面与地图改版.md)
- **V1.3**：对讲模式隐藏文字输入栏、右上角“退出对讲”；位置共享页“退出”与“停止共享”合并为左上角“退出共享”，取消底部提示条；全部页面截图 `screenshots/v1.3-*.png`
- **V1.4**：邮箱验证码登录/注册（阿里云邮件推送）；登录页微信 / Apple ID / 支付宝入口（未开通则明确提示，不会登录）；「我」页不再直接展示注销文字；组织认证方式二改为上传劳动合同与工牌（只认证不核验）；好友/自己资料页（从头衔头像或「我」进入，名字不可点）；举报与屏蔽移到对方资料；截图 `screenshots/v1.4-*.png`

本仓库包含完整可运行的全栈实现：

```
wujian-dao/
├── README.md                # 本文件
├── docs/                     # 产品需求（PRD）与合规文档
│   ├── PRD.md                # 开发需求文档 V1.0（含合规映射基线）
│   ├── 服务条款.md            # 法务撰写基线 → 正式条款
│   ├── 隐私权政策.md          # 法务撰写基线 → 正式政策
│   ├── 合规与上架清单.md       # 微信小程序 / App Store / 安卓商店卡点
│   ├── 部署指南.md            # 后端部署与四端构建说明
│   ├── 对讲与位置共享设计.md   # V1.1 实时功能：开源调研、方案选择、协议、限制
│   └── V1.2-界面与地图改版.md  # V1.2：早期微信风格、模拟对讲机、OSM 地图选型、首次隐私提示
├── backend/                  # Node.js + Express API 服务
│   ├── smoke-test.js         # 冒烟测试（含 smoke-realtime.js 实时通道；另有 mail-unit-test.js；npm test）
│   └── src/
│       ├── index.js
│       ├── db.js             # JSON 持久化（生产换 PostgreSQL）
│       ├── middleware/auth.js
│       ├── services/         # 权限矩阵 / 实时权限 / 坐标转换 / 功能开关
│       ├── realtime/         # WebSocket /ws：对讲话权 + 音频中继 + 位置共享（内存、不落盘）
│       └── routes/           # auth / org / chat / cert / nameview / account(含位置授权) / admin / map(OSM 底图配置 + /tiles)
└── frontend/                 # uni-app (Vue3) 前端 —— 编译四端
    └── src/
        ├── manifest.json     # Android/iOS/鸿蒙/微信小程序 平台配置
        ├── pages.json
        ├── api/  store/  utils/
        ├── realtime/         # 实时客户端、μ-law 编解码、可插拔音频 / 定位提供者、会话控制器
        ├── components/       # walkie-talkie（模拟对讲机）/ live-map（MapLibre + OSM · 小程序 <map>）
        └── pages/            # 登录/消息/会话/资料/实时位置/通讯录/我/隐私/组织认证/实名认证/姓名查看授权/账号与安全
```

## 快速开始

### 1. 启动后端

```bash
cd backend
npm install
npm start          # http://localhost:3000
npm run dev        # 热重载

# 冒烟测试（推荐：自动起临时服务，跑完即关）
npm test
# 或对已运行的服务（另开终端，先重置数据）
rm -f data/db.json && node smoke-test.js
```

联调种子账号（开发模式短信 / 邮箱验证码接口返回 `devCode` 并自动填入；生产环境不会回传）：

| 账号 | 手机号 | 邮箱 | 组织 | 预置状态 |
|---|---|---|---|---|
| Alice | 13800000001 | alice@dawn-tech.example.cn | 晨曦集团·晨曦科技·研发部 | 未组织认证 |
| Bob | 13800000002 | bob@dawn-tech.example.cn | 晨曦集团·晨曦科技·人事部 | 组织认证✓ 实名认证✓ |
| Carol | 13800000003 | carol@dawn-media.example.cn | 晨曦集团·晨曦传媒·编辑部 | 均未认证 |
| Dave | 13800000004 | dave@ocean-logi.example.cn | 远洋集团·远洋物流·运营部 | 均未认证 |
| Admin | 13900000000 | admin@dawn-tech.example.cn | 晨曦科技 | 管理员（离职联动） |

### 2. 运行前端（四端）

> 截图（iPhone 390×844 @3x）：V1.4 见 `screenshots/v1.4-*.png` 与 `screenshots/v1.4-截图清单.md`；亦保留 V1.3 / V1.2 / V1.1。地图底图：`backend/scripts/fetch-tiles.sh` 生成 PMTiles（不入库，没有时自动用 OpenFreeMap）。前端单元测试 `cd frontend && npm test`；
> 端到端截图：`VITE_API_BASE= npm run build:h5`，后端同源托管后 `PREFIX=v1.4 node scripts/e2e-screenshots.mjs`。

```bash
cd frontend
npm install

# 微信小程序（用微信开发者工具导入 dist/dev/mp-weixin）
npm run dev:mp-weixin

# H5（浏览器联调）
npm run dev:h5

# Android / iOS App（配合 HBuilderX 或 uni-app CLI 云打包）
npm run dev:app
npm run build:app

# HarmonyOS（需 HBuilderX 4.x，选择 app-harmony 运行/发行目标）
npm run dev:app-harmony
npm run build:app-harmony
```

> 小程序/H5 联调时，把 `frontend/src/api/index.js` 的 `BASE_URL` 改为后端局域网地址。
> 首次构建前，请在 `frontend/src/manifest.json` 填入微信小程序 `appid`。

## 核心规则实现一览（对应 PRD）

| PRD 要求 | 实现位置 | 冒烟测试 |
|---|---|---|
| 同公司直聊 / 同集团认证前置 / 跨集团先聊 | `backend/src/services/permissions.js` | ✅ 2.聊天权限矩阵 |
| 跨集团受限模式（仅文字，持续提示条） | chat 路由 + `chat.vue` | ✅ 3.受限模式 |
| 组织认证 6 个月有效、到期阻断发送、离职立即失效 | `getOrgCertStatus` + admin 路由 | ✅ 4/5 |
| 一次性定位核验：仅存布尔结果，不存经纬度 | cert 路由 `verify-location` | ✅ 4 |
| 拒绝定位 → 上传劳动合同与工牌（只认证不核验，立即生效） | cert 路由 `documents`；旧 `fallback/*` 返回 410 | ✅ 4 |
| 24h 内失败 3 次限流 | `orgCertAttempts` | ✅ 4 |
| 邮箱验证码登录/注册（无密码）；生产未配置不得假发送 | `routes/auth.js` + `services/mail.js`（阿里云 DirectMail 官方 SDK） | ✅ 1b + mail-unit-test |
| 微信 / Apple / 支付宝入口未开通则 503，不登录 | `POST /api/auth/oauth/:provider` | ✅ 1b |
| 资料页（头衔进入；举报/屏蔽在对方资料） | `pages/user-profile` + `GET/POST /api/org/users/:id` | ✅ 7b |
| 实名认证：代付人直付平台、主动勾选不可撤销、提交后关闭退款 | cert 路由订单状态机 | ✅ 6 |
| 退款规则（成功不退/平台故障全退/信息不实首次可退） | `ORDER_STATUS` | ✅ 6 |
| 付费查看姓名：逐次授权、拒绝自动退款、审计日志 | nameview 路由 | ✅ 7 |
| **iOS 端付费查看整体关闭（服务端开关）** | `services/flags.js` + `x-platform` 头 | ✅ 7 |
| App 内账号注销 + 数据导出 | account 路由 | ✅ 8 |
| iOS 仅申请 While In Use 定位权限 | `manifest.json` `NSLocationWhenInUseUsageDescription` | — |
| 微信小程序 `requiredPrivateInfos` 声明 getLocation | `manifest.json` mp-weixin 节点 | — |
| **V1.1 按住说话对讲**：仅单聊、话权控制（busy）、对方离线拒绝、60 秒上限 | `backend/src/realtime/hub.js` + `walkie-talkie`（V1.2） | ✅ 10/11 |
| **V1.1 受限模式**：对讲与位置共享默认不可用 | `services/realtime-permissions.js` + `flags.restrictedModeRealtime` | ✅ 10 |
| **V1.1 实时位置共享**：时长、到期、一键停止、仅发给对方、不落盘；**V1.2 首次同意（按账号记录）、可撤回、退出即删除** | `hub.js` + `services/consent.js` + `pages/live-location` + `pages/privacy-settings` | ✅ 12 |
| **V1.2 地图**：OpenStreetMap 数据（PMTiles / OpenFreeMap），无任何 key，坐标统一 WGS-84；高德代理已移除 | `routes/map.js` + `components/live-map` | ✅ 13 |

## 技术选型

- **后端**：Node.js + Express + ws（MIT），零原生依赖（V1 JSON 持久化，生产切 PostgreSQL）
- **实时**：WebSocket 中继 G.711 μ-law 8kHz 音频分片（四端可用、不依赖境外 STUN/TURN）；生产化路线（Opus / 自建 SFU）见设计文档
- **前端**：uni-app + Vue 3 —— 同一套业务代码编译 Android / iOS / HarmonyOS / 微信小程序
- **地图（V1.2）**：MapLibre GL JS 5（BSD-3）+ pmtiles（BSD-3）+ Protomaps basemaps 样式（BSD-3 / CC0），数据 © OpenStreetMap contributors（ODbL）；字形 Noto Sans（OFL）
- **支付/实名/短信**：V1 为 Mock 实现，接口边界已按持牌服务商接入设计（见 docs/部署指南.md）
- **邮件**：阿里云邮件推送官方 SDK `@alicloud/dm20151123`（Apache-2.0）；需运营方自行开通并配置环境变量，仓库不包含密钥

## ⚠️ 上架前置卡点（务必阅读 docs/合规与上架清单.md）

1. **ICP B25 类增值电信业务经营许可证**（微信小程序社交-即时通信类目强制）
2. **《安全评估报告》**（安卓商店社交类应用必备）
3. **“付费查看姓名”在 iOS 端 V1 关闭**（代码已实现，勿在提审前打开）
4. 《服务条款》《隐私权政策》需部署为可公开访问的 URL

## License

MIT
