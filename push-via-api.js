/**
 * 午间岛 → GitHub 上传器（Git Data API 版）
 *
 * 适用场景：github.com 主站被网络阻断、无法使用 git push / gh CLI 时，
 * 通过 api.github.com 的 Git Data API 重建本地提交历史并推送。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node push-via-api.js [repo-name]
 *   或：node push-via-api.js <token> <repo-name>
 *
 * 说明：
 *  - token 仅在进程内存中使用，不写入任何文件、不打印、不写入 git remote
 *  - 完整保留本地 commit 历史（含多条 commit 的父子关系）
 *  - 目标仓库不存在则自动创建；已存在且为空（或仅自动生成的 README）则复用
 *  - 已存在且包含实质内容时拒绝覆盖，避免破坏用户数据
 *  - 注意：fine-grained PAT（github_pat_ 开头）无法创建仓库，
 *    此时需在 GitHub 网页手动创建空仓库，或改用 classic PAT（ghp_ 开头，勾选 repo）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || process.argv[2];
const REPO = process.env.GITHUB_REPO || process.argv[3] || 'Noon-Islands';
const DESCRIPTION = '午间岛 - 组织身份即时通信与实名互认服务（Android/iOS/HarmonyOS/微信小程序, uni-app + Express）';

if (!TOKEN) {
  console.error('缺少 token。用法：GITHUB_TOKEN=ghp_xxx node push-via-api.js [repo-name]');
  process.exit(1);
}

function git(args, binary = false) {
  return execFileSync('git', args, {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
    encoding: binary ? undefined : 'utf8'
  });
}

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'wujian-dao-uploader'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (res.status >= 400) {
    const err = new Error(`${method} ${url} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

(async () => {
  console.log('[1/6] 校验 token ...');
  const me = await api('GET', '/user');
  const owner = me.login;
  console.log(`      账号：${owner}`);

  console.log(`[2/6] 创建/检查仓库 ${owner}/${REPO} ...`);
  let created = false;
  try {
    await api('POST', '/user/repos', {
      name: REPO, description: DESCRIPTION, private: false,
      has_issues: true, has_wiki: false, auto_init: false
    });
    created = true;
    console.log('      已新建空仓库');
  } catch (e) {
    // 422 = 同名已存在；403 = fine-grained PAT 无建仓权限（仓库可能已由用户手动创建）
    if (![422, 403].includes(e.status)) throw e;
    let existing;
    try {
      existing = await api('GET', `/repos/${owner}/${REPO}`);
    } catch (e2) {
      throw new Error(
        `无法创建仓库（HTTP ${e.status}），且 ${owner}/${REPO} 不存在。\n` +
        `   fine-grained PAT 不能创建仓库：请在 https://github.com/new 手动创建空仓库 ${REPO}，\n` +
        `   或改用 classic PAT（ghp_ 开头，勾选 repo 权限）后重跑本脚本。`
      );
    }
    // size 为 KB 取整；0/1 视为空仓库或仅含自动生成的 README
    if (existing.size > 1) {
      throw new Error(`仓库 ${owner}/${REPO} 已存在且含实质内容（${existing.size} KB），为避免覆盖请指定新仓库名`);
    }
    console.log('      复用已存在的空仓库');
  }
  const base = `/repos/${owner}/${REPO}`;

  // GitHub 的 Git Data API 在完全空的仓库上会返回 409 "Git Repository is empty"，
  // 因此先用 Contents API 写入一个初始 commit 完成 git 存储初始化。
  console.log('      检查 git 存储是否已初始化 ...');
  try {
    await api('GET', `${base}/commits?per_page=1`);
    console.log('      已初始化');
  } catch (e) {
    if (![404, 409].includes(e.status)) throw e;
    const seed = fs.readFileSync(path.join(ROOT, 'README.md'));
    await api('PUT', `${base}/contents/README.md`, {
      message: 'chore: initialize repository',
      content: seed.toString('base64'),
      branch: 'main'
    });
    console.log('      空仓库已通过 Contents API 初始化（main）');
  }

  console.log('[3/6] 读取本地提交历史 ...');
  const commits = git(['rev-list', '--reverse', 'HEAD']).trim().split('\n').filter(Boolean);
  console.log(`      共 ${commits.length} 个 commit`);

  const blobCache = new Set();
  let parentSha = null;
  let count = 0;

  for (const localSha of commits) {
    count++;
    const message = git(['log', '-1', '--format=%B', localSha]).trim();
    const treeRaw = git(['ls-tree', '-r', '-z', localSha], true);
    const entries = [];
    for (const rec of treeRaw.toString('utf8').split('\0')) {
      if (!rec) continue;
      const [meta, filePath] = rec.split('\t');
      const [mode, type, sha] = meta.split(' ');
      if (type !== 'blob') continue;
      entries.push({ mode, path: filePath, sha });
    }

    // 上传本次提交涉及的新 blob（内容寻址，跨 commit 去重）
    let uploaded = 0;
    for (const e of entries) {
      if (blobCache.has(e.sha)) continue;
      const content = git(['cat-file', 'blob', e.sha], true);
      const r = await api('POST', `${base}/git/blobs`, {
        content: content.toString('base64'), encoding: 'base64'
      });
      if (r.sha !== e.sha) throw new Error(`blob sha 不一致：${e.path}`);
      blobCache.add(e.sha);
      uploaded++;
    }

    const tree = await api('POST', `${base}/git/trees`, {
      tree: entries.map(e => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha }))
    });
    const commit = await api('POST', `${base}/git/commits`, {
      message, tree: tree.sha, parents: parentSha ? [parentSha] : []
    });
    parentSha = commit.sha;
    console.log(`      [${count}/${commits.length}] ${localSha.slice(0, 7)} → ${commit.sha.slice(0, 7)}（${entries.length} 文件，新增 ${uploaded} blob）`);
  }

  console.log('[4/6] 写入 main 分支引用 ...');
  let refExists = false;
  try {
    const cur = await api('GET', `${base}/git/ref/heads/main`);
    refExists = !!cur.object && !!cur.object.sha;
  } catch (e) {
    if (![404, 409].includes(e.status)) throw e; // 空仓库返回 404/409，属正常
  }
  if (refExists) {
    await api('PATCH', `${base}/git/refs/heads/main`, { sha: parentSha, force: true });
  } else {
    await api('POST', `${base}/git/refs`, { ref: 'refs/heads/main', sha: parentSha });
  }

  console.log('[5/6] 设置默认分支 ...');
  await api('PATCH', base, { default_branch: 'main' }).catch(e => {
    console.log(`      默认分支设置失败（HTTP ${e.status}），代码仍在 main 分支`);
  });

  console.log('[6/6] 校验 ...');
  const repo = await api('GET', base);
  const ref = await api('GET', `${base}/git/ref/heads/main`);
  if (ref.object.sha !== parentSha) throw new Error('分支引用校验失败');

  console.log('\n✅ 上传完成');
  console.log(`   仓库：${repo.html_url}`);
  console.log(`   分支：main（默认分支 ${repo.default_branch}），${commits.length} 个 commit，${blobCache.size} 个文件对象`);
  console.log(`   大小：${repo.size} KB${created ? '（新建）' : '（复用空仓库）'}`);
})().catch(e => {
  console.error('\n❌ 上传失败：', e.message);
  if (/401/.test(e.message)) console.error('   token 无效或已过期，请检查是否具备 repo 权限。');
  if (/404|resource not found/i.test(e.message)) console.error('   token 需要 classic PAT 并勾选 repo 权限（fine-grained PAT 需授予该仓库 Contents 读写）。');
  process.exit(1);
});
