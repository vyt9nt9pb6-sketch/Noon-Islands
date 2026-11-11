/**
 * 午间岛 API 服务入口
 * 组织身份即时通信与实名互认服务（V1）
 */
const express = require('express');
const { load } = require('./db');

const app = express();
app.use(express.json());

// 平台识别透传（功能开关依赖）
app.use((req, res, next) => {
  res.setHeader('Server', 'wujian-dao/1.0');
  next();
});

app.get('/api/health', (req, res) => res.json({ code: 0, data: { name: '午间岛', version: '1.0.0', time: new Date().toISOString() } }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/org', require('./routes/org'));
app.use('/api/chats', require('./routes/chat'));
const { router: certRouter, ordersRouter } = require('./routes/cert');
app.use('/api/cert', certRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/name-view', require('./routes/nameview'));
app.use('/api/account', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const PORT = process.env.PORT || 3000;
load();
app.listen(PORT, () => {
  console.log(`[wujian-dao] 午间岛 API 已启动: http://localhost:${PORT}`);
  console.log('[wujian-dao] 平台合规提示：提审前需完成 ICP B25 许可证与《安全评估报告》');
});
