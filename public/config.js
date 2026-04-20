// 这是你唯一需要定制的文件
// 修改后 push 到 GitHub，Cloudflare Pages 会自动重新部署

window.APP_CONFIG = {
  // ===== 店铺品牌 =====
  shopName: '我的 API 店铺',
  logoEmoji: '⚡',
  tagline: 'AI 模型中转站 · 即买即用 · 自助查询余额',

  // ===== 后端站点列表（用户在下拉中选择）=====
  backends: [
    { label: '主站', url: 'https://www.lucky04.dpdns.org' },
    // { label: '备用站', url: 'https://api2.example.com' },
  ],

  // 是否允许用户手动输入"自定义后端"；售卖场景通常设为 false
  allowCustomBackend: false,

  // ===== 额度换算（one-api / new-api 默认 500000 quota = $1）=====
  // 如果你后台改过 quota_per_unit，请同步改这里
  quotaPerUnit: 500000,

  // ===== 人民币折算（仅用于展示；留 0 不显示 CNY）=====
  cnyRate: 7.2,

  // ===== 外链（留空则不显示对应按钮）=====
  supportUrl: '',   // 例：https://t.me/your_support
  topupUrl: '',     // 例：https://example.com/topup

  // ===== 页脚免责声明 =====
  footerNote: '本站仅查询已购买的 API 密钥额度，不存储密钥。',
};
