/**
 * platforms.js — 招聘平台适配配置表
 *
 * 每个平台定义：
 *   - hostRe    : 域名匹配
 *   - listRe    : 列表页 URL 特征
 *   - detailRe  : 详情页 URL 特征
 *   - cards     : 列表卡片容器选择器（多级 fallback，按顺序尝试，取第一个命中非空的）
 *   - cardFields: 卡片字段选择器（title/salary/company），按顺序取第一个非空
 *   - detailFields: 详情页字段选择器（title/salary/company/jd）
 *   - applyKeywords: 投递按钮文本关键词
 *   - anchors   : 匹配卡插入锚点（取第一个存在且非空的，插到它前面）
 *
 * 注意：这些站点的前端经常改版。若徽章/匹配卡不显示，
 * 按 README「调试」一节反馈 class 名，往对应数组里加 fallback 即可。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.JobPlatforms = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PLATFORMS = [
    {
      id: "boss",
      name: "Boss直聘",
      hostRe: /zhipin\.com$/i,
      listRe: /\/web\/geek\/(job|recommend)/i,
      detailRe: /\/job_detail\/[\w-]+\.html/i,
      // 列表判定不依赖 URL：非详情页都尝试注入徽章（无卡片则无操作，更稳）
      listIsFallback: true,
      cards: [
        ".job-card-wrapper",
        ".job-list-box li",
        ".job-card",
        "[class*='job-card']",
      ],
      cardFields: {
        title: [".job-name", ".job-title", "a[href*='job_detail']"],
        salary: [".salary", ".job-info .red"],
        company: [".company-name", ".company-info .name"],
      },
      detailFields: {
        title: [".job-primary .name", ".name", "h1", "[class*='job-name']"],
        salary: [".job-primary .salary", ".salary", "[class*='salary']"],
        company: [".company-info .name", ".company-name", ".company-name"],
        jd: [".job-sec-text", ".job-detail", ".job-sec-content", "[class*='job-detail']", "[class*='job-sec']"],
      },
      applyKeywords: ["立即沟通", "投递简历", "投递", "和TA聊聊", "打招呼"],
      anchors: [".job-sec-text", ".job-detail", ".job-sec-content", "[class*='job-detail']", ".job-banner", ".job-primary"],
    },
    {
      id: "zhaopin",
      name: "智联招聘",
      hostRe: /zhaopin\.com$/i,
      // 详情页之外都尝试列表注入（智联首页/城市页/搜索页 URL 变体多）
      listRe: /(\/sou\/|^https?:\/\/sou\.zhaopin|job\/search|\/web\/job\/)/i,
      // 真实详情 URL：http://www.zhaopin.com/jobdetail/CC877348140J41028646204.htm
      detailRe: /\/jobdetail\/[A-Za-z0-9]+\.htm/i,
      listIsFallback: true,
      cards: [
        ".job-card",
        ".joblist-box__item",
        ".joblist-box li",
        ".jobinfo",
        "[class*='job-card']",
        "[class*='job-list'] li",
      ],
      cardFields: {
        // 注意：SSR 里是 a.job-card__name，Vue 水合后变成 span.vue-clamp__text（无 name class）
        title: [".job-card__title-main", ".job-card__name", ".vue-clamp__text", ".jobinfo__name", ".job-title", ".job-name", "a[href*='jobdetail']"],
        salary: [".job-card__salary", ".jobinfo__salary", ".salary", "[class*='salary']"],
        company: [".job-card__company-name", ".companyinfo__name", ".company_name", ".company-name"],
        // 新版卡片带职位描述片段，拼进 jd 文本提高匹配
        desc: [".job-card__seo-description"],
      },
      detailFields: {
        title: [".jobs-deliver__title", ".publisher-seo__job-title", ".job-title", "h1", "[class*='job-title']"],
        salary: [".jobs-deliver__salary", ".salary", "[class*='salary']", ".job-salary"],
        company: [".companyinfo__name", ".company-name", ".company_name"],
        jd: [".describtion-card__detail-content", ".describtion-card", ".job-description", ".job-detail", ".describtion__content", "[class*='job-description']"],
      },
      // 智联 JD 之外的技能标签区，拼接进 jd 文本提高匹配
      jdExtraSels: [".describtion-card__skills-content", ".describtion-card__skills"],
      applyKeywords: ["投递简历", "立即沟通", "投递", "申请职位", "应聘"],
      anchors: [".describtion-card", ".job-description", ".job-detail", ".describtion__content", "[class*='job-description']", ".job-info"],
    },
    {
      id: "lagou",
      name: "拉勾网",
      hostRe: /lagou\.com$/i,
      listRe: /\/zhaopin\//i,
      detailRe: /\/jobs\/\d+\.html/i,
      listIsFallback: true,
      cards: [
        ".item__10RTO",
        ".job-list-item",
        ".job-list li",
        "[class*='item__']",
        "[class*='job-list'] li",
      ],
      cardFields: {
        title: [".item__title", ".position-link", "a[href*='/jobs/']", "[class*='title']"],
        salary: [".item__salary", ".money", "[class*='salary']"],
        company: [".item__company", ".company-name", "[class*='company']"],
      },
      detailFields: {
        title: [".job-detail-title", "h1", ".position-link", "[class*='job-title']"],
        salary: [".job-detail-salary", ".money", "[class*='salary']"],
        company: [".company-name", "[class*='company']"],
        jd: [".job-detail-content", ".job-require", ".job-detail-section", ".describe", ".job-detail", "[class*='job-require']"],
      },
      applyKeywords: ["立即投递", "投递简历", "申请职位", "投递"],
      anchors: [".job-detail-content", ".job-require", ".job-detail-section", ".describe", ".job-detail", "[class*='job-require']"],
      // 前端改版频繁，启用通用卡片识别兜底（按薪资+详情链接+标题特征识别）
      generic: true,
    },
    {
      id: "liepin",
      name: "猎聘",
      hostRe: /liepin\.com$/i,
      listRe: /\/zhaopin\//i,
      detailRe: /\/job\/\d+\.shtml/i,
      listIsFallback: true,
      cards: [
        ".job-card-pc-container",
        ".job-card",
        ".job-list-item",
        ".job-list li",
        "[class*='job-card']",
        "[class*='job-list'] li",
      ],
      cardFields: {
        title: [".job-title", ".job-name", ".ellipsis-1", "a[href*='/job/']"],
        salary: [".job-salary", ".salary", "[class*='salary']"],
        company: [".company-name", ".company", "[class*='company']"],
      },
      detailFields: {
        title: [".job-title", "h1", "[class*='job-title']"],
        salary: [".job-salary", ".salary", "[class*='salary']"],
        company: [".company-name", ".company", "[class*='company']"],
        jd: [".job-description", ".content-word", ".job-detail", ".job-intro", "[class*='description']", "[class*='job-detail']"],
      },
      applyKeywords: ["立即投递", "投递简历", "申请职位", "投递", "一键投递"],
      anchors: [".job-description", ".content-word", ".job-detail", ".job-intro", "[class*='description']"],
      // 前端改版频繁，启用通用卡片识别兜底
      generic: true,
    },
  ];

  /** 当前页面匹配的平台，无则 null */
  function matchPlatform(hostname) {
    const h = hostname || (typeof location !== "undefined" ? location.hostname : "");
    for (const p of PLATFORMS) {
      if (p.hostRe.test(h)) return p;
    }
    return null;
  }

  /** 是否列表页 */
  function isList(p, href) {
    const u = href || (typeof location !== "undefined" ? location.href : "");
    return p && p.listRe.test(u);
  }

  /** 是否详情页 */
  function isDetail(p, href) {
    const u = href || (typeof location !== "undefined" ? location.href : "");
    return p && p.detailRe.test(u);
  }

  return { PLATFORMS, matchPlatform, isList, isDetail };
});
