# New API 密钥额度查询器

一个部署在 **Cloudflare Pages** 的轻量工具，让你的 API 买家输入自己的 `sk-xxx` 后，自助查询额度、已用、到期时间与模型白名单。  
前台使用 **Cloudflare Pages Functions** 代理到你自建的 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 实例，后台则新增了 **密码保护的站点管理页**，可实时维护前台可选站点。

## ✨ 现在支持什么

- 买家自助查询密钥余额、已用额度、到期时间、模型白名单
- 前端同源请求 `/api/query`，规避 CORS
- 后台登录页：`/admin/login`
- 后台站点管理页：`/admin`
- 站点列表写入 Cloudflare KV，保存后前台刷新即可生效
- 当前后台为空时，前台会自动回退到 `public/config.js` 的静态 `backends`
- 后台提供“一键导入当前静态站点”能力，方便首次迁移
- 旧的 `{ backend, key }` 查询方式仍保留，用于迁移期和静态回退

## 🧩 当前架构

```text
public/
├── index.html              前台查询页
├── app.js                  前台逻辑，优先读取 /api/sites
├── config.js               品牌与静态回退配置
└── admin/
    ├── index.html          后台站点管理页
    └── login/index.html    后台登录页

functions/
├── _middleware.js          保护 /admin 静态页面
├── _lib/                   共享工具（鉴权 / KV / 响应）
└── api/
    ├── query.js            查询代理
    ├── sites.js            前台公开站点列表
    └── admin/
        ├── _middleware.js  保护 /api/admin/*
        ├── login.js
        ├── logout.js
        └── sites/
            ├── index.js
            ├── [id].js
            └── reorder.js
```

## 🔐 后台登录与会话

- 登录接口：`POST /api/admin/login`
- 登录成功后写入：
  - `HttpOnly`
  - `Secure`
  - `SameSite=Strict`
  - `Max-Age=43200`（12 小时）
- 后台静态页面由中间件保护，未登录会自动跳转到 `/admin/login`
- 后台写接口只接受 **同源 Origin** 请求

## 🗄️ 站点数据结构

Cloudflare KV 里只维护一个键：

```json
[
  {
    "id": "uuid",
    "label": "主站",
    "url": "https://api.example.com",
    "enabled": true,
    "createdAt": "2026-04-20T11:00:00.000Z",
    "updatedAt": "2026-04-20T11:00:00.000Z"
  }
]
```

前台公开接口 `GET /api/sites` 只返回已启用站点的精简结构：

```json
[
  { "id": "uuid", "label": "主站" }
]
```

查询时前台提交：

```json
{ "siteId": "uuid", "key": "sk-xxx" }
```

服务端再把 `siteId` 解析成真实 `url` 后，向：

```http
GET /api/usage/token/
Authorization: Bearer sk-xxx
```

发起请求。

## ⚙️ 你现在主要改哪里

### 1. 品牌与静态回退

继续在 `public/config.js` 里改这些：

```js
shopName: '你的店铺名',
logoEmoji: '⚡',
tagline: '你的副标题',
backends: [
  { label: '主站', url: 'https://api.example.com' },
],
topupUrl: 'https://example.com/topup',
supportUrl: 'https://t.me/your_support',
quotaPerUnit: 500000,
cnyRate: 7.2,
footerNote: '本站仅查询已购买的 API 密钥额度，不存储密钥。',
```

这里的 `backends` 现在有两个作用：

- 当前后台还没写入站点时，前台用它做回退
- 后台站点为空时，可在 `/admin` 里一键导入

### 2. Cloudflare Secrets

在 Pages 项目里配置：

- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

### 3. Cloudflare KV

创建一个 KV Namespace，然后绑定名固定为：

- `SITE_CONFIG`

## 🚀 部署到 Cloudflare Pages

### 第 1 步：推到 GitHub

```bash
git init
git add .
git commit -m "init: key query with admin"
git branch -M main
git remote add origin https://github.com/<你>/new-api-key-query.git
git push -u origin main
```

### 第 2 步：Cloudflare Dashboard 配置

Pages 项目里做这几件事：

1. 连接 Git 仓库
2. 构建配置：
   - Framework preset: `None`
   - Build command: 留空
   - Build output directory: `public`
3. 进入 **Settings → Environment variables / Variables and Secrets**
4. 添加 Secrets：
   - `ADMIN_PASSWORD`
   - `ADMIN_SESSION_SECRET`
5. 进入 **Settings → Bindings**
6. 添加 KV 绑定：
   - Variable name: `SITE_CONFIG`
   - KV namespace: 你刚创建的那个
7. 可选添加：
   - `ALLOWED_BACKENDS=https://api.example.com,https://api2.example.com`

### 第 3 步：首次进入后台

1. 打开 `/admin/login`
2. 输入 `ADMIN_PASSWORD`
3. 进入 `/admin`
4. 如果后台为空，但 `config.js` 里有旧站点，会看到“一键导入现有站点”
5. 导入后，前台刷新即可优先走后台站点列表

## 🛠️ 本地开发

### 1. 准备本地变量

```bash
cp .dev.vars.example .dev.vars
```

填好：

```env
ADMIN_PASSWORD=你的本地密码
ADMIN_SESSION_SECRET=一串足够长的随机字符串
ALLOWED_BACKENDS=
```

### 2. 启动本地服务

推荐带上本地 KV 和 HTTPS：

```bash
wrangler pages dev public --compatibility-date=2025-01-01 --kv=SITE_CONFIG --local-protocol=https
```

这样本地后台登录和 `Secure` Cookie 的行为更接近生产环境。

## 📚 后台接口

```http
POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/sites
POST   /api/admin/sites
PUT    /api/admin/sites/:id
DELETE /api/admin/sites/:id
POST   /api/admin/sites/reorder
GET    /api/sites
POST   /api/query
```

## 🔁 迁移逻辑

迁移期的行为是：

1. 后台 KV 有站点：
   - 前台只展示后台已启用站点
   - 查询时传 `siteId`
2. 后台 KV 为空：
   - 前台自动回退到 `config.js.backends`
   - 查询时继续传 `backend`
3. 后台导入或新增站点后：
   - 前台刷新即切到后台实时列表

## 🔒 安全说明

- 密钥只在：浏览器 → Pages Function → 你的 new-api 之间传递
- 后台登录会话是签名 Cookie，不把密码存前端
- 后台写接口要求同源 Origin
- 建议在生产环境保留 `ALLOWED_BACKENDS`，为静态回退和兼容模式兜底

## ❓ 常见问题

**Q：后台能登录，但新增站点时报“未配置 SITE_CONFIG 绑定”**  
A：说明你的 Pages 项目还没把 `SITE_CONFIG` 绑定到 KV Namespace。

**Q：前台还能看到 `config.js` 里的旧站点**  
A：这是回退逻辑。只要后台 KV 还为空，前台就继续用静态站点。进入 `/admin` 导入或新增后，刷新前台即可。

**Q：为什么后台地址里不直接编辑 `/api/usage/token` 完整路径？**  
A：后台填写的是站点基础地址，可以是纯域名，也可以带路径前缀；查询接口会在这个基础地址后统一拼接 `/api/usage/token`，既能减少配置错误，也兼容挂在子路径下的 new-api。

**Q：为什么本地建议 HTTPS？**  
A：后台会话 Cookie 带 `Secure` 标记，本地用 HTTPS 更接近正式环境。

## 📄 许可

MIT
