# New API 密钥额度查询器

一个部署在 **Cloudflare Pages** 的零成本小工具，让你的 API 买家输入自己的 `sk-xxx` 即可自助查询额度、已用、到期时间与模型白名单。后端指向你自建的 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 实例（需 **v0.8.0+**，即 PR #1161 之后的版本）。

![screenshot](./public/favicon.svg)

## ✨ 特性

- 🎨 深色霓虹极简风，玻璃卡 + 发光进度条，移动端友好
- 🔑 直接调用 new-api 新接口 `GET /api/usage/token`，一次返回完整信息
- 🛡️ 前端**不**直接请求 new-api；由 Cloudflare Pages Functions 同源代理，**自动规避 CORS** 且**不暴露后端域名**
- 🏬 支持**多后端站点**（主站 / 备用站），用户可在下拉中切换
- 🎛️ 品牌可定制（店铺名、LOGO emoji、充值/客服链接、人民币汇率）
- 📋 一键复制结果摘要；可选"本机记忆密钥"
- 🧱 纯静态 + Functions，零构建，push 即发

## 🧩 接口说明

本工具调用的是 new-api 的 token 用量查询接口：

```http
GET /api/usage/token
Authorization: Bearer sk-xxxxxxxx
```

响应（节选）：
```json
{
  "code": true, "message": "ok",
  "data": {
    "name": "Default Token",
    "total_granted": 1000000,
    "total_used": 12345,
    "total_available": 987655,
    "unlimited_quota": false,
    "model_limits": {"gpt-4o-mini": true},
    "model_limits_enabled": false,
    "expires_at": 0
  }
}
```

额度单位是 **quota**，默认 `500000 quota = $1`（如你在 new-api 后台改过 `quota_per_unit`，请同步修改 `public/config.js` 的 `quotaPerUnit`）。

## 📁 项目结构

```
.
├── public/                 ← 静态资源（Pages 根目录）
│   ├── index.html
│   ├── app.js
│   ├── config.js           ← ⚠️ 你唯一需要改的文件
│   └── favicon.svg
├── functions/
│   └── api/query.js        ← Pages Function 反代
├── _headers                ← 安全响应头
├── wrangler.toml           ← 本地开发配置
├── .dev.vars.example       ← 环境变量样例（复制为 .dev.vars 使用）
└── README.md
```

## 🚀 部署到 Cloudflare Pages（GitHub 接入）

### 第 1 步：推到 GitHub

```bash
cd "密钥查询器"
git init
git add .
git commit -m "init: key query"
git branch -M main
git remote add origin https://github.com/<你>/new-api-key-query.git
git push -u origin main
```

### 第 2 步：改 `public/config.js`

打开 `public/config.js`，至少改这三项：

```js
shopName: '你的店铺名',
backends: [
  { label: '主站', url: 'https://your-newapi.example.com' },
  // 可加备用站
],
topupUrl:   'https://your-shop.example.com/topup',  // 可选
supportUrl: 'https://t.me/your_support',            // 可选
```

### 第 3 步：Cloudflare Pages 配置

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers 与 Pages** → **创建** → **Pages** → **连接到 Git**
2. 选择你刚推的仓库
3. 构建配置：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `public`
4. 环境变量（可选但推荐）：
   - `ALLOWED_BACKENDS`：`https://your-newapi.example.com,https://api2.example.com`
     - 逗号分隔；**留空则不限制**
     - 建议设置以防被人把你的 Pages 当作通用代理滥用
5. 保存并部署。

### 第 4 步：绑自定义域名（可选）

Pages 项目 → **Custom domains** → **Add** → 按提示添加 CNAME 即可。

## 🛠️ 本地开发（可选）

```bash
# 安装 wrangler
npm i -g wrangler

# 复制本地环境变量样例
cp .dev.vars.example .dev.vars
# 按需填写 ALLOWED_BACKENDS

# 启动
wrangler pages dev public --compatibility-date=2025-01-01

# 访问 http://localhost:8788
```

## 🎨 自定义指南

### 品牌与文案
全部在 `public/config.js` 里，改完 push 即生效。

### 颜色 / 视觉
主题色集中在 `public/index.html` 的 `<style>` 块：
- `hero-bg` —— 背景渐变
- `.bar` —— 进度条霓虹渐变
- `.neon-edge::before` —— 卡片霓虹描边
修改 Tailwind 类（`from-cyan-300 via-fuchsia-300 to-amber-200` 等）即可换配色。

### 额度换算
如果你在 new-api 后台修改过 `quota_per_unit`（默认 500000）：
```js
// public/config.js
quotaPerUnit: 500000,  // 改成你实际的值
```

## 🔒 安全与隐私

- 密钥**仅在用户浏览器 → Cloudflare Functions → 你的 new-api** 之间流转，Function 不记录密钥
- `localStorage` 只在用户**主动勾选"记住"**时存储
- Function 配了 8s 超时 + `Cache-Control: no-store`
- 建议在生产环境配置 `ALLOWED_BACKENDS`，防止你的 Pages 被用作通用代理

## ❓ 常见问题

**Q: 页面能打开，查询却报"密钥无效或已删除"**  
A: 检查 `sk-xxx` 是否正确；去 new-api 后台确认该 token 存在且未禁用。

**Q: 报 "后端未提供该接口"**  
A: new-api 版本过低（需 v0.8.0+ 即 PR #1161 之后）。升级后端即可。

**Q: 报 "该后端未在白名单内"**  
A: 你在 Cloudflare 配置了 `ALLOWED_BACKENDS` 但用户选择的后端不在列表里。要么扩充白名单，要么清空该环境变量。

**Q: 报 "无法连接后端"**  
A: new-api 实例未开放公网访问，或域名拼写错了。

**Q: 额度数字和后台不一致**  
A: 先确认 `config.js` 的 `quotaPerUnit` 与后台一致。

## 📄 许可

MIT
