# Beta 上线逐步操作清单

## 第 1 步：创建 Supabase 后端

1. 打开 Supabase，创建新项目。
2. 选择离你和学生较近的区域。
3. 记下数据库密码，后续少量手工维护时会用到。
4. 等项目创建完成后，进入 Project Settings -> API。
5. 复制 Project URL。
6. 复制 publishable key 或 anon public key。
7. service role key 只留在你本机使用，不要放进前端文件。

## 第 2 步：初始化数据库

1. 进入 Supabase SQL Editor。
2. 新建 Query。
3. 复制 `beta-mvp/supabase/schema.sql` 的全部内容。
4. 点击 Run。
5. 如果没有红色报错，数据库表和权限就建好了。

## 第 3 步：注册教师账号

1. 暂时打开本地或部署后的 beta 前端。
2. 用“学生注册”先注册你的邮箱。
3. 回到 Supabase SQL Editor。
4. 运行：

```sql
update public.profiles
set role = 'teacher', display_name = 'Teacher'
where email = '你的邮箱';
```

## 第 4 步：导入题库

在本机运行：

```bash
cd /Users/simonlee/Documents/Codex/2026-06-15/files-mentioned-by-the-user-with/beta-mvp

SUPABASE_URL="你的 Supabase Project URL" \
SUPABASE_SERVICE_ROLE_KEY="你的 service role key" \
node scripts/import-questions.mjs ../online-upgrade/question-bank.raw.json
```

成功后会看到导入进度，最终应该是 156 道题。

## 第 5 步：填写前端配置

编辑 `beta-mvp/config.js`：

```js
window.BETA_CONFIG = {
  supabaseUrl: '你的 Supabase Project URL',
  supabasePublishableKey: '你的 publishable 或 anon public key',
  appName: 'TOEFL Writing Beta',
  teacherName: 'Teacher'
};
```

注意：这里不能填写 service role key。

## 第 6 步：部署到 Cloudflare Pages

1. 把 `beta-mvp` 目录放进一个 GitHub 仓库。
2. 打开 Cloudflare Dashboard -> Workers & Pages -> Create application -> Pages。
3. 连接 GitHub 仓库。
4. Framework preset 选择 None。
5. Build command 留空。
6. Build output directory 填 `/` 或留空，取决于 Cloudflare 当前界面提示。
7. 部署。

如果仓库根目录不是 `beta-mvp`，可以把项目根目录设置成 `beta-mvp`。

## 第 7 步：第一轮测试

1. 打开 Cloudflare Pages 分配的网址。
2. 注册 1 个学生账号。
3. 用教师账号登录。
4. 看教师端是否能看到学生。
5. 给学生分发一道题。
6. 学生登录后写作并提交。
7. 教师端查看提交并发布反馈。
8. 学生端确认能看到反馈消息。

这 8 步跑通后，beta 的教学闭环就成立了。

