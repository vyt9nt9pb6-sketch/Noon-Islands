/**
 * 邮件推送与生产环境发信失败单元测试。
 * 不读取、不打印任何密钥；只断言缺失配置时不得假装发送成功。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mailConfigured, sendLoginCode } = require('./src/services/mail');

function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} ${extra}`);
    process.exitCode = 1;
  }
}

(async () => {
  const saved = {
    id: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    secret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    account: process.env.ALIDM_ACCOUNT_NAME,
    nodeEnv: process.env.NODE_ENV
  };
  try {
    delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    delete process.env.ALIDM_ACCOUNT_NAME;
    process.env.NODE_ENV = 'production';
    check('凭证缺失时 mailConfigured() 为 false', mailConfigured() === false);
    let threw = null;
    try {
      await sendLoginCode('nobody@example.com', '123456');
    } catch (e) { threw = e; }
    check('生产发送在凭证缺失时抛出 mail_not_configured', threw && threw.code === 'mail_not_configured');

    const PORT = String(3200 + Math.floor(Math.random() * 400));
    const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wjd-mail-'));
    const env = {
      ...process.env,
      PORT, DATA_DIR, NODE_ENV: 'production',
      ALIBABA_CLOUD_ACCESS_KEY_ID: '',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: '',
      ALIDM_ACCOUNT_NAME: ''
    };
    const srv = spawn(process.execPath, [path.join(__dirname, 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('生产测试服务启动超时')), 10000);
      srv.stdout.on('data', (d) => { if (/已启动/.test(String(d))) { clearTimeout(t); resolve(); } });
      srv.stderr.on('data', () => {});
    });
    try {
      const res = await fetch(`http://localhost:${PORT}/api/auth/email-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com' })
      });
      const json = await res.json().catch(() => ({}));
      check('生产环境未配置邮件推送 → 503，不返回 devCode，不假装已发送',
        res.status === 503 && json.code === 503 && !json.devCode && !/已发送/.test(json.message || ''),
        JSON.stringify({ status: res.status, code: json.code, message: json.message, hasDev: !!json.devCode }));
    } finally {
      srv.kill();
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    }
  } finally {
    if (saved.id !== undefined) process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = saved.id;
    else delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    if (saved.secret !== undefined) process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = saved.secret;
    else delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    if (saved.account !== undefined) process.env.ALIDM_ACCOUNT_NAME = saved.account;
    else delete process.env.ALIDM_ACCOUNT_NAME;
    if (saved.nodeEnv !== undefined) process.env.NODE_ENV = saved.nodeEnv;
    else delete process.env.NODE_ENV;
  }
  if (process.exitCode) process.exit(1);
  console.log('邮件单元测试通过');
})().catch((e) => { console.error('邮件单元测试异常:', e.message); process.exit(1); });
