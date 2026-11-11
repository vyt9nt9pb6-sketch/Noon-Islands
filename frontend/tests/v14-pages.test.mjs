import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('V1.4 页面约定', () => {
  it('登录页提供邮箱验证码与未开通的第三方入口', () => {
    const s = read('src/pages/login/login.vue');
    assert.match(s, /mode === 'email'/);
    assert.match(s, /登录 \/ 注册/);
    assert.match(s, /tryOauth\('wechat'\)/);
    assert.match(s, /tryOauth\('apple'\)/);
    assert.match(s, /tryOauth\('alipay'\)/);
    assert.match(s, /尚未开通/);
    assert.doesNotMatch(s, /联调种子|13800000001|demo-tip/);
  });

  it('「我」页头像行进入自己的资料，账号与安全行不再直接写注销', () => {
    const s = read('src/pages/profile/profile.vue');
    assert.match(s, /goOwnProfile/);
    assert.match(s, /user-profile\/user-profile/);
    const accountRow = s.slice(s.indexOf('账号与安全') - 200, s.indexOf('账号与安全') + 200);
    assert.doesNotMatch(accountRow, /注销账号/);
    assert.match(read('src/pages/account-delete/account-delete.vue'), /注销账号/);
  });

  it('组织认证方式二为材料上传，不再走企业邮箱+管理员确认', () => {
    const s = read('src/pages/cert-org/cert-org.vue');
    assert.match(s, /劳动合同/);
    assert.match(s, /工牌/);
    assert.doesNotMatch(s, /企业邮箱 \+ 管理员确认/);
    assert.doesNotMatch(s, /orgFallbackRequest/);
  });

  it('聊天头衔（头像）进入资料，名字与标题不可点；+面板不含举报屏蔽', () => {
    const s = read('src/pages/chat/chat.vue');
    assert.match(s, /@tap\.stop="openProfile\(m\.fromMe\)"/);
    assert.doesNotMatch(s, /@tap=.*peerName/);
    assert.doesNotMatch(s, /setNavigationBarTitle[\s\S]{0,80}@tap/);
    assert.match(s, /对讲机/);
    assert.match(s, /位置共享/);
    assert.match(s, /查看实名/);
    assert.doesNotMatch(s, /showReport|showBlock|>举报<|>屏蔽</);
  });

  it('通讯录与自己/好友资料共用同一页，自己的资料不出现举报屏蔽', () => {
    const pages = read('src/pages.json');
    assert.match(pages, /pages\/user-profile\/user-profile/);
    const contacts = read('src/pages/contacts/contacts.vue');
    assert.match(contacts, /openProfile\(u\)/);
    assert.match(contacts, /user-profile\/user-profile/);
    const prof = read('src/pages/user-profile/user-profile.vue');
    assert.match(prof, /v-if="!u\.self"/);
    assert.match(prof, />举报</);
    assert.match(prof, /屏蔽/);
  });
});
