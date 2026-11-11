/**
 * 一键测试：用临时数据目录 + 缩短的实时计时启动后端，运行 smoke-test.js，结束后关闭服务。
 * 不读取、不打印任何真实密钥；地图相关用假的测试值验证“不泄露”。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = String(3100 + Math.floor(Math.random() * 500));
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wjd-test-'));
const env = {
  ...process.env,
  PORT, DATA_DIR, NODE_ENV: 'test',
  RT_LOC_TIME_SCALE: '0.002',   // 位置相关计时倍率：断线宽限 60 秒 → 0.12 秒
  RT_PTT_MAX_MS: '1500', RT_PTT_IDLE_MS: '600',
  MAP_STYLE_URL: '', MAP_PMTILES_URL: ''
};
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false;
srv.stdout.on('data', (d) => { if (!ready && /已启动/.test(String(d))) { ready = true; run(); } });
srv.stderr.on('data', (d) => process.stderr.write(d));
setTimeout(() => { if (!ready) { console.error('后端启动超时'); srv.kill(); process.exit(1); } }, 10000);

function run() {
  const t = spawn(process.execPath, [path.join(__dirname, '..', 'smoke-test.js')], { env: { ...env, BASE: `http://localhost:${PORT}` }, stdio: 'inherit' });
  t.on('exit', (code) => {
    srv.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    if (code) process.exit(code);
    const mail = spawn(process.execPath, [path.join(__dirname, '..', 'mail-unit-test.js')], { stdio: 'inherit' });
    mail.on('exit', (c) => process.exit(c));
  });
}
