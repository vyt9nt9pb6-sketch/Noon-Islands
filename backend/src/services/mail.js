/**
 * 阿里云邮件推送（DirectMail）发送登录/注册验证码。
 *
 * 官方资料（动手前已查阅）：
 * - SDK 手册：https://help.aliyun.com/zh/direct-mail/sdk-manual
 * - OpenAPI SingleSendMail（2015-11-23）：https://next.api.aliyun.com/api/Dm/2015-11-23/SingleSendMail
 * - 官方 Node.js SDK：@alicloud/dm20151123（Apache-2.0，当前 1.11.0）
 * - 身份：环境变量 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET（官方约定，禁止写进代码）
 *
 * 发信还需在阿里云邮件推送控制台自行开通、验证发信域名/地址后，通过环境变量提供：
 * - ALIDM_ACCOUNT_NAME  已验证的发信地址，如 noreply@yourdomain.com
 * - ALIDM_FROM_ALIAS    可选，发信人显示名，默认「午间岛」
 * - ALIDM_ENDPOINT      可选，默认 dm.aliyuncs.com（新加坡等地域见控制台）
 *
 * 生产环境未配置完整凭证时：抛出 mail_not_configured，调用方必须返回失败，不得假装已发送。
 */
const Dm20151123 = require('@alicloud/dm20151123');
const { $OpenApiUtil } = require('@alicloud/openapi-core');

function mailConfigured() {
  return !!(
    process.env.ALIBABA_CLOUD_ACCESS_KEY_ID
    && process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
    && process.env.ALIDM_ACCOUNT_NAME
  );
}

async function sendLoginCode(toAddress, code) {
  if (!mailConfigured()) {
    const err = new Error('阿里云邮件推送未配置：请设置 ALIBABA_CLOUD_ACCESS_KEY_ID、ALIBABA_CLOUD_ACCESS_KEY_SECRET、ALIDM_ACCOUNT_NAME');
    err.code = 'mail_not_configured';
    throw err;
  }
  const client = new Dm20151123.default(new $OpenApiUtil.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    endpoint: process.env.ALIDM_ENDPOINT || 'dm.aliyuncs.com'
  }));
  const req = new Dm20151123.SingleSendMailRequest({
    accountName: process.env.ALIDM_ACCOUNT_NAME,
    fromAlias: process.env.ALIDM_FROM_ALIAS || '午间岛',
    addressType: 1,
    replyToAddress: false,
    toAddress,
    subject: '午间岛登录验证码',
    textBody: `你的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略本邮件。`
  });
  await client.singleSendMail(req);
}

module.exports = { mailConfigured, sendLoginCode };
