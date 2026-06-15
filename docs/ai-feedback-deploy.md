# AI 付费反馈部署步骤

## 目标

学生使用 AI 反馈时：

1. 学生必须已经提交作文。
2. 老师分发作业时必须勾选“允许学生用 AI 次数反馈”。
3. 老师必须先给学生发放 `AI 反馈 1 次` 权益。
4. 学生点击 `AI 反馈`。
5. Supabase Edge Function 调用 DeepSeek。
6. 成功后写入 `ai_feedbacks`，并扣减 1 次权益。

## 需要准备

- Supabase project ref：`slablclmsuugbbwrcnrh`
- DeepSeek API key
- Supabase CLI

## 安装 Supabase CLI

如果使用 Homebrew：

```bash
brew install supabase/tap/supabase
```

检查：

```bash
supabase --version
```

## 登录 Supabase CLI

```bash
supabase login
```

浏览器会打开授权页面。授权完成后回到终端。

## 设置 DeepSeek Secret

在 `beta-mvp` 目录运行：

```bash
supabase secrets set DEEPSEEK_API_KEY="你的 DeepSeek API Key" --project-ref slablclmsuugbbwrcnrh
supabase secrets set DEEPSEEK_MODEL="deepseek-chat" --project-ref slablclmsuugbbwrcnrh
```

Supabase 默认会给 Edge Function 提供 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS`、`SUPABASE_SECRET_KEYS`，所以通常不需要再手动设置 Supabase key。

## 部署函数

在 `beta-mvp` 目录运行：

```bash
supabase functions deploy ai-feedback --project-ref slablclmsuugbbwrcnrh
```

部署成功后，函数地址通常是：

```text
https://slablclmsuugbbwrcnrh.supabase.co/functions/v1/ai-feedback
```

前端已经使用 Supabase JS `functions.invoke('ai-feedback')`，不需要再改网址。

## 前端测试

1. 教师登录线上站点。
2. 选择一个测试学生。
3. 给学生发放 `AI 反馈 1 次`。
4. 分发题目时勾选“允许学生用 AI 次数反馈”。
5. 学生提交作文。
6. 学生在“我的提交”里点击 `AI 反馈`。
7. 成功后学生会看到 AI 反馈，AI 次数减 1。

## 数据库检查

查看 AI 反馈是否生成：

```sql
select id, student_id, score, status, created_at
from public.ai_feedbacks
order by created_at desc
limit 10;
```

查看学生剩余 AI 次数：

```sql
select user_id, entitlement_type, remaining_uses, created_at
from public.entitlements
where entitlement_type = 'ai_feedback'
order by created_at desc;
```

## 常见错误

### No AI feedback credits available.

老师还没有给学生发 AI 次数，或次数已经用完。

### AI feedback is not enabled for this assignment.

老师分发题目时没有勾选“允许学生用 AI 次数反馈”。

### Missing DEEPSEEK_API_KEY.

Edge Function secret 没有设置 DeepSeek key。

### Invalid user session.

学生需要重新登录。

