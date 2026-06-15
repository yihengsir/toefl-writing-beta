# TOEFL 写作工具 Beta MVP

这是一个低成本、小范围测试版本，适合前期少于 10 个学生使用。

## 推荐部署

- 前端：Cloudflare Pages 免费层，或 GitHub 仓库托管静态文件后接 Cloudflare Pages。
- 后端：Supabase 免费层，使用 Auth、Postgres、RLS、Realtime，可选 Edge Function。
- 支付：beta 阶段不接正式支付网关。学生提交付款申请，你线下确认收款后，在教师端手动发放 AI 次数或题目权限。

## 为什么这样做

这个版本故意不做复杂后端服务，也不依赖本机常驻运行。你只需要维护：

- 一个静态前端目录。
- 一个 Supabase 项目。
- 一套数据库表和权限策略。
- 可选的 AI Edge Function。

后续学生变多后，可以把手动付款换成微信/支付宝/Stripe webhook，把静态前端升级成 Next.js，也不需要推翻数据模型。

## 文件说明

- `index.html`：单页学生端/教师端入口。
- `assets/app.js`：前端逻辑。
- `assets/styles.css`：界面样式。
- `config.js`：填写 Supabase URL 和 publishable key。
- `supabase/schema.sql`：数据库表、RLS 权限、触发器。
- `scripts/import-questions.mjs`：把现有题库 JSON 导入 Supabase。
- `supabase/functions/ai-feedback/index.ts`：可选 AI 反馈函数。

## 第一次部署步骤

1. 创建 Supabase 项目。
2. 打开 Supabase SQL Editor，运行 `supabase/schema.sql`。
3. 在 Supabase Authentication 设置里打开 Email 登录。beta 阶段建议关闭邮箱确认，减少测试摩擦。
4. 编辑 `config.js`，填入 Supabase Project URL 和 publishable key。
5. 注册你的教师账号。
6. 在 SQL Editor 里把你的账号改成教师：

```sql
update public.profiles
set role = 'teacher', display_name = 'Teacher'
where email = '你的邮箱';
```

7. 导入题库：

```bash
SUPABASE_URL="https://你的项目.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="你的 service role key" \
node scripts/import-questions.mjs ../online-upgrade/question-bank.raw.json
```

8. 把整个 `beta-mvp` 文件夹上传到 GitHub 仓库，并用 Cloudflare Pages 部署。

## AI 反馈

beta 第一阶段可以先只用教师人工批改。如果要打开学生付费 AI 反馈：

1. 部署 `supabase/functions/ai-feedback`。
2. 设置 Edge Function secrets：`DEEPSEEK_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`。
3. 教师端给学生发放 AI 次数。
4. 学生端提交作文后点击 AI 反馈。

## Beta 功能范围

学生端：

- 邮箱注册、登录。
- 查看老师分发的题目。
- 写作、保存本地草稿、提交云端。
- 查看老师反馈和 AI 反馈。
- 提交付款申请。

教师端：

- 查看学生。
- 查看题库。
- 分发题目给单个学生。
- 查看提交。
- 发布分数和文字反馈。
- 手动发放 AI 次数或题目权益。

## 暂不做的事

- 自动微信/支付宝回调。
- 多教师机构管理。
- 复杂班级系统。
- 作文逐句批注。
- 大规模数据看板。

