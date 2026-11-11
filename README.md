# 午间岛 (WuJian Island)

> 组织身份 · 即时通信 · 实名互认 —— 一套代码，四端交付：**Android App / iOS App / HarmonyOS（鸿蒙）/ 微信小程序**

午间岛是面向组织身份场景的即时通信服务：

- **同公司** → 直接聊
- **同集团、跨公司** → 双方完成组织认证后方可申请聊天
- **跨集团** → 先聊（受限模式：仅文字），后增强信任
- **实名认证**是信任增强徽章，**不是**聊天前置门槛；姓名展示需被查看方**逐次单独同意**

本仓库包含完整可运行的全栈实现：

```
wujian-dao/
├── README.md
├── docs/                     # 产品需求与合规文档
├── backend/                  # Node.js + Express API 服务
└── frontend/                 # uni-app (Vue3) 前端
```

## 快速开始

### 后端

```bash
cd backend
npm install
npm start          # http://localhost:3000
```

### 前端

```bash
cd frontend
npm install
npm run dev:mp-weixin   # 微信小程序
npm run dev:h5          # H5
npm run dev:app         # Android / iOS
```

## 技术选型

- **后端**：Node.js + Express
- **前端**：uni-app + Vue 3（同一套代码编译 Android / iOS / HarmonyOS / 微信小程序）

## 上架注意事项

详见 `docs/合规与上架清单.md`：

1. ICP B25 类增值电信业务经营许可证
2. 《安全评估报告》
3. iOS 端付费查看姓名功能需关闭
4. 服务条款与隐私政策需公开可访问

## License

MIT
