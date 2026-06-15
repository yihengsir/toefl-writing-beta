# Beta 日常操作手册

## 推荐流程

1. 学生注册账号。
2. 你登录教师账号，在教师端看到学生。
3. 你给学生分发题目。
4. 学生写作并提交。
5. 你在教师端查看提交并发布反馈。
6. 学生在学生端收到消息和反馈。

## AI 反馈收费的 beta 做法

正式支付系统先不接。beta 阶段可以这样做：

1. 学生线下扫码付款。
2. 学生在学生端提交付款申请，备注付款方式和想买的内容。
3. 你确认到账。
4. 你在教师端“手动发权益”里给学生发 `AI 反馈 1 次`。
5. 学生提交作文后点击 `AI 反馈`，系统消耗 1 次权益。

这样做的好处是成本低、规则清楚、出错可以人工兜底。等真实学生愿意持续付费后，再接正式微信/支付宝或 Stripe。

## 题目解锁的 beta 做法

学生如果想练老师没有分发的题目：

1. 学生提交付款申请，备注想解锁的题目编号或标题。
2. 你确认后在教师端选择学生、选择题目、发放 `解锁选中题目`。

当前前端已经保留了题目解锁权益的数据结构。为了 beta 更简单，主要练习入口仍建议用“教师分发题目”。

## 老师如何开通 AI

如果只做人工批改，不需要部署 Edge Function。

如果要让学生使用 AI：

1. 安装 Supabase CLI。
2. 在 Supabase 项目里设置这些 secrets：

```bash
supabase secrets set DEEPSEEK_API_KEY="你的 DeepSeek Key"
supabase secrets set SUPABASE_ANON_KEY="你的 anon/publishable key"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="你的 service role key"
supabase secrets set DEEPSEEK_MODEL="deepseek-chat"
```

3. 部署函数：

```bash
supabase functions deploy ai-feedback
```

4. 给学生发放 AI 次数。

## 风控建议

- 前 10 个学生只开放邀请制，不开放公开注册链接。
- 教师账号只保留你一个。
- Supabase service role key 只在本机和 Supabase secrets 里使用，不能放进 `config.js`。
- 每天备份一次提交数据，至少在 Supabase Table Editor 里导出 CSV。
- AI 反馈先按 1 次、5 次小包卖，避免余额和退款逻辑太复杂。

## 什么时候升级

出现这些情况再升级：

- 学生超过 20 人。
- 每周 AI 调用超过 200 次。
- 手动确认付款明显影响你上课。
- 有多个老师需要共同使用。
- 学生要求更完整的历史记录、错词本、统计报表。

升级顺序建议：

1. 正式支付 webhook。
2. 班级系统。
3. 逐句批注。
4. 后台数据看板。
5. 从静态前端升级到 Next.js。

