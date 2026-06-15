# Cloudflare Pages 部署步骤

## 方案

前端是纯静态文件，不需要构建命令。Cloudflare Pages 只需要把 `beta-mvp` 目录发布出去。

## 第 1 步：创建 GitHub 仓库

建议仓库名：

```text
toefl-writing-beta
```

可以设为 Private。Cloudflare Pages 可以连接 private repo。

## 第 2 步：把 beta-mvp 上传到 GitHub

如果你用 GitHub Desktop：

1. File -> New Repository。
2. Name 填 `toefl-writing-beta`。
3. Local path 可以选一个你习惯的位置。
4. 创建后，把 `beta-mvp` 目录里的所有文件复制进仓库根目录。
5. Commit。
6. Publish repository。

如果你用命令行：

```bash
cd /Users/simonlee/Documents/Codex/2026-06-15/files-mentioned-by-the-user-with/beta-mvp
git init
git add .
git commit -m "Initial beta MVP"
git branch -M main
git remote add origin https://github.com/你的用户名/toefl-writing-beta.git
git push -u origin main
```

## 第 3 步：Cloudflare Pages 连接 GitHub

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 点击 `Create application`。
4. 选择 `Pages`。
5. 选择 `Connect to Git`。
6. 授权 GitHub。
7. 选择 `toefl-writing-beta` 仓库。

## 第 4 步：构建设置

如果仓库根目录就是 `beta-mvp` 里面的文件：

- Framework preset: `None`
- Build command: 留空
- Build output directory: `/` 或留空

如果仓库根目录外面还套了一层目录：

- Root directory: `beta-mvp`
- Framework preset: `None`
- Build command: 留空
- Build output directory: `/`

然后点击 Deploy。

## 第 5 步：部署后检查

Cloudflare 会给你一个类似下面的网址：

```text
https://toefl-writing-beta.pages.dev
```

打开后检查：

1. 能看到登录页。
2. 教师账号能登录。
3. 教师端能看到题库数量 156。
4. 注册一个学生测试账号。
5. 教师端刷新后能看到学生。
6. 分发一道题给学生。
7. 学生提交作文。
8. 教师发布反馈。
9. 学生端能看到反馈。

这 9 步跑通，beta 就正式上线。

## 常见问题

### 登录后页面空白

打开浏览器开发者工具，看 Console 是否有错误。最常见原因是 `config.js` 里的 Supabase URL 或 publishable key 写错。

### 学生注册后教师端看不到

先刷新教师端。如果还没有，去 Supabase Table Editor 查看 `profiles` 表是否生成学生记录。

### 教师账号变成学生端

在 Supabase SQL Editor 运行：

```sql
update public.profiles
set role = 'teacher'
where email = '你的教师邮箱';
```

### 题库数量不是 156

在 Supabase SQL Editor 运行：

```sql
select count(*) from public.questions;
```

如果数量不对，重新运行导入命令即可，脚本会按 `import_index` 合并，不会重复插入。

