// 这是你主要需要定制的文件之一
// 品牌、静态回退站点和外链都在这里配置

window.APP_CONFIG = {
  // ===== 店铺品牌 =====
  shopName: '我的 API 店铺',
  logoEmoji: '⚡',
  tagline: 'AI 模型中转站 · 即买即用 · 自助查询余额',

  // ===== 静态回退站点列表 =====
  // 当后台 KV 还没有站点时，前台会回退读取这里
  // 后台管理页也可以一键导入这些站点
  backends: [
    { label: '主站', url: 'https://www.lucky04.dpdns.org' },
    // { label: '备用站', url: 'https://api2.example.com' },
  ],

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
