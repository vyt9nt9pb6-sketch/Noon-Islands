/**
 * 午间岛 API 服务入口
 * 组织身份即时通信与实名互认服务（V1）
 * V1.1：新增实时通道 /ws（按住说话对讲机 + 实时位置共享），见 docs/对讲与位置共享设计.md
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { load } = require('./db');
const { createHub } = require('./realtime/hub');
const realtime = require('./realtime');

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '8mb' })); // 组织认证材料（劳动合同/工牌）以 Base64 上传

app.use((req, res, next) => {
  res.setHeader('Server', 'wujian-dao/1.4');
  next();
});

// 底图静态资源（公开数据）用独立 CORS，必须在全局 CORS 之前（全局 CORS 会直接回应 OPTIONS）
app.use('/tiles', require('./routes/map').tilesCors);

// CORS：H5 联调（vite dev server）与配置的前端域名。生产用 CORS_ORIGINS 白名单（逗号分隔）
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const devLocal = process.env.NODE_ENV !== 'production' && origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && (devLocal || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-platform');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ code: 0, data: { name: '午间岛', version: '1.4.0', realtime: '/ws', time: new Date().toISOString() } }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/org', require('./routes/org'));
app.use('/api/chats', require('./routes/chat'));
const { router: certRouter, ordersRouter } = require('./routes/cert');
app.use('/api/cert', certRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/name-view', require('./routes/nameview'));
app.use('/api/account', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));
const { apiRouter: mapRouter, tilesStatic } = require('./routes/map');
app.use('/api', mapRouter);
app.use('/tiles', tilesStatic); // PMTiles 底图与字形（OSM 数据，ODbL）

// 可选：同源托管 H5 构建产物（frontend/dist/build/h5），便于手机浏览器直接访问
const H5_DIR = process.env.H5_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist', 'build', 'h5');
if (fs.existsSync(path.join(H5_DIR, 'index.html'))) {
  app.use(express.static(H5_DIR, { index: 'index.html', maxAge: '1h' }));
}

// 统一错误处理
app.use((err, req, res, next) => {
  // 静态文件（/tiles）的 404/403 属于正常客户端错误，不当成 500
  if (err && err.status && err.status < 500) return res.status(err.status).json({ code: err.status, message: err.status === 404 ? '找不到资源' : '请求被拒绝' });
  console.error('[error]', err && err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const PORT = process.env.PORT || 3000;
load();
const server = http.createServer(app);
const hub = createHub();
hub.attach(server, '/ws');
realtime.setHub(hub);
server.listen(PORT, () => {
  console.log(`[wujian-dao] 午间岛 API 已启动: http://localhost:${PORT}  实时通道: ws://localhost:${PORT}/ws`);
  console.log('[wujian-dao] 平台合规提示：提审前需完成 ICP B25 许可证与《安全评估报告》');
});

function shutdown() { hub.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
