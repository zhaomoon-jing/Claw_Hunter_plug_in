/**
 * inject.js — 招聘平台页面集成（content script，多平台通用）
 *
 * 依赖：matcher.js（打分）、platforms.js（平台配置）
 *
 * 功能：
 *   1. 列表页：岗位卡片右上角注入匹配度徽章（悬停显示命中技能）
 *   2. 详情页：JD 上方注入匹配分析卡（精确分/命中/缺失技能/薪资对比/话术/一键投递）
 *   3. 一键投递：确认后自动点击页面投递按钮（半自动）
 *   4. 已投递记录：本地标记
 */
(function () {
  "use strict";
  if (window.__jobhunterLoaded) return;
  window.__jobhunterLoaded = true;

  const NS = "jobhunter";

  // ---------- 存储适配（插件 chrome.storage / mock localStorage） ----------
  const store = {
    async get(keys) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return new Promise((res) => chrome.storage.local.get(keys, res));
      }
      const out = {};
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        try { out[k] = JSON.parse(localStorage.getItem(NS + ":" + k)); } catch (e) { out[k] = null; }
      }
      return out;
    },
    async set(obj) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return new Promise((res) => chrome.storage.local.set(obj, res));
      }
      for (const k of Object.keys(obj)) localStorage.setItem(NS + ":" + k, JSON.stringify(obj[k]));
    },
  };

  const DEFAULT_SETTINGS = { min_score: 60, pitch_template: "", badge_enabled: true };

  // ---------- 工具 ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function pickText(root, sels) {
    for (const sel of sels) {
      const el = (root || document).querySelector(sel);
      if (el && el.textContent) {
        const t = el.textContent.replace(/\s+/g, " ").trim();
        if (t) return t;
      }
    }
    return "";
  }
  function pickEl(root, sels) {
    for (const sel of sels) {
      const el = (root || document).querySelector(sel);
      if (el && el.textContent) return el;
    }
    return null;
  }
  function pickJd(root, sels) {
    for (const sel of sels) {
      const el = (root || document).querySelector(sel);
      if (el && el.textContent.trim().length > 30) {
        return el.textContent.replace(/\s+/g, " ").trim();
      }
    }
    // 兜底：收集页面所有段落
    const txt = Array.from((root || document).querySelectorAll("section p, p"))
      .map((p) => p.textContent.replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 8)
      .join(" ");
    return txt.slice(0, 3000);
  }
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toast(msg) {
    let t = $("." + NS + "-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = NS + "-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  // ---------- 诊断日志（F12 Console 排查用） ----------
  const DBG = true;
  function dbg(...args) {
    if (DBG) console.log("[jobhunter]", ...args);
  }

  // ---------- 页面识别 ----------
  let platform = null;
  function detect() {
    platform = window.JobPlatforms.matchPlatform();
  }
  // listIsFallback 平台：非详情页都当列表页尝试注入（无卡片则无操作）
  const isList = () => platform &&
    (platform.listIsFallback ? !isDetail() : window.JobPlatforms.isList(platform));
  const isDetail = () => platform && window.JobPlatforms.isDetail(platform);

  // ---------- 列表页 ----------
  function findCards() {
    for (const sel of platform.cards) {
      const cards = $$(sel);
      if (cards.length) return cards;
    }
    // 通用兜底：前端改版导致选择器失效时，按特征识别（详情链接 + 薪资文本）
    if (platform.generic) return findGenericCards();
    return [];
  }

  /** 通用卡片识别：从岗位详情链接向上找含薪资文本的容器 */
  function findGenericCards() {
    const seen = new Set();
    const out = [];
    const links = $$('a[href*="job"], a[href*="jobs"], a[href*="position"], a[href*="jobdetail"]');
    for (const a of links) {
      const text = (a.textContent || "").trim();
      // 跳过明显不是标题的链接（太短/太长）
      if (text.length < 2 || text.length > 40) continue;
      let node = a.parentElement;
      for (let i = 0; i < 6 && node && node !== document.body; i++) {
        if (!seen.has(node)) {
          const txt = (node.innerText || node.textContent || "");
          const hasSalary = /(\d+(?:\.\d+)?\s*[-~—至]\s*\d+(?:\.\d+)?\s*(?:万|k|K|元)|\d+\s*[kK]\s*[-~—至]\s*\d+\s*[kK]|\d+\s*-\s*\d+\s*[kK])/.test(txt);
          if (txt.length > 15 && txt.length < 2500 && hasSalary) {
            seen.add(node);
            out.push(node);
            break;
          }
        }
        node = node.parentElement;
      }
    }
    return out.slice(0, 30);
  }

  function parseCard(card) {
    const f = platform.cardFields;
    let title = pickText(card, f.title);
    if (!title) {
      // 兜底：卡片内第一个岗位链接的文本/title 属性
      const a = $("a[href*='job'], a[href*='jobs'], a[href*='position'], a[href*='jobdetail']", card);
      if (a) title = (a.getAttribute("title") || a.textContent || "").trim();
    }
    title = cleanTitle(title);
    const salary = pickText(card, f.salary) ||
      (card.textContent.match(/\d+K-\d+K|\d+-\d+K|\d+\.\d+万-\d+\.\d+万|\d+K/gi) || [])[0] || "";
    const company = pickText(card, f.company);
    // 标签：卡片里的短文本块（各平台类名不同：tag/label/keyword…）
    const tags = $$("li, [class*='tag'], [class*='label'], [class*='keyword']", card)
      .map((el) => el.textContent.replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length <= 20)
      .slice(0, 8)
      .join(" ");
    // 平台可选：职位描述片段（如智联新版卡片），拼进 jd 文本
    const desc = f.desc ? pickText(card, f.desc) : "";
    return { title, salary, company, jd_text: (tags + " " + desc).trim() };
  }

  /** 标题清洗：去掉混入的薪资等噪声（如"ai产品经理 1.2-2万"、"xx **-**元"） */
  function cleanTitle(t) {
    return String(t || "")
      .replace(/\s*\*{1,3}\s*[-~—至]?\s*\*{1,3}\s*(?:万|k|K|元)/g, "")
      .replace(/\s*\d+(?:\.\d+)?\s*[-~—至]\s*\d+(?:\.\d+)?\s*(?:万|k|K|元)\s*[\d.万kK元-]*/g, "")
      .replace(/\s*\d+(?:\.\d+)?\s*[kK]\s*[-~—至]?\s*[\d.kK]*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 判断元素是否处于 overflow 裁剪环境（自身或最多 4 层父级） */
  function isClippedByOverflow(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      try {
        const cs = getComputedStyle(node);
        if (cs && (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden")) {
          return true;
        }
      } catch (e) { /* jsdom 等无样式环境 */ }
      node = node.parentElement;
    }
    return false;
  }

  function badgeColor(score, min) {
    if (score >= Math.max(75, min + 10)) return "#16a34a";
    if (score >= min) return "#d97706";
    return "#94a3b8";
  }
  function buildBadge(score, matched) {
    const b = document.createElement("div");
    b.className = "jh-badge";
    b.style.setProperty("--jh-c", badgeColor(score, 0));
    const num = document.createElement("span");
    num.className = "jh-badge-num";
    num.textContent = score + "分";
    b.appendChild(num);
    if (matched && matched.length) {
      const tip = document.createElement("div");
      tip.className = "jh-badge-tip";
      tip.textContent = "命中技能：" + matched.slice(0, 6).join("、");
      b.appendChild(tip);
    }
    return b;
  }

  function injectListBadges(profile, settings) {
    if (!settings.badge_enabled) return;
    const cards = findCards();
    dbg("列表页：卡片数 =", cards.length, "平台 =", platform.id);
    if (cards.length === 0) {
      dbg("未找到任何岗位卡片，平台选择器:", JSON.stringify(platform.cards));
    }
    for (const card of cards) {
      try {
        if (card.querySelector("." + NS + "-badge")) continue;
        const parsed = parseCard(card);
        if (!parsed.title) {
          dbg("跳过无标题卡片:", (card.className || card.tagName).toString().slice(0, 60));
          continue;
        }
        const r = window.JobMatcher.scoreJob(parsed, profile);
        const badge = buildBadge(r.score, r.matched_skills);
        badge.classList.add(NS + "-badge");
        // 位置策略：卡片或其父级 overflow 裁剪时用 inline/inset（绝不悬出被截）
        if (isClippedByOverflow(card)) {
          const titleEl = pickEl(card, platform.cardFields.title);
          if (titleEl && titleEl.parentNode) {
            badge.classList.add("jh-badge-inline");
            titleEl.parentNode.insertBefore(badge, titleEl.nextSibling);
          } else {
            badge.classList.add("jh-badge-inset");
            if (getComputedStyle(card).position === "static") card.style.position = "relative";
            card.appendChild(badge);
          }
        } else {
          if (getComputedStyle(card).position === "static") card.style.position = "relative";
          card.appendChild(badge);
        }
      } catch (e) { /* 单卡失败不影响其他 */ }
    }
  }

  // ---------- 详情页 ----------
  function parseDetail() {
    const f = platform.detailFields;
    const title = cleanTitle(pickText(document, f.title));
    const salary = pickText(document, f.salary);
    const company = pickText(document, f.company);
    let jd = pickJd(document, f.jd);
    // 平台可选的补充文本（如智联的技能标签区），拼进 JD 提高匹配
    if (platform.jdExtraSels) {
      const extra = pickText(document, platform.jdExtraSels);
      if (extra) jd = jd + " " + extra;
    }
    return { title, salary, company, jd_text: jd };
  }

  function buildMatchCard(job, r, profile, settings) {
    const wrap = document.createElement("div");
    wrap.className = "jh-card";

    const head = document.createElement("div");
    head.className = "jh-head";
    const scoreEl = document.createElement("div");
    scoreEl.className = "jh-score " + (r.score >= 75 ? "jh-high" : r.score >= settings.min_score ? "jh-mid" : "jh-low");
    scoreEl.innerHTML = "<span class='jh-score-num'>" + Math.round(r.score) + "</span><span class='jh-score-txt'>匹配分</span>";
    head.appendChild(scoreEl);

    const bars = document.createElement("div");
    bars.className = "jh-bars";
    const items = [
      ["技能匹配", r.breakdown.skill, 50],
      ["职位方向", r.breakdown.title, 30],
      ["薪资匹配", r.breakdown.salary, 20],
    ];
    for (const [label, val, max] of items) {
      const row = document.createElement("div");
      row.className = "jh-bar-row";
      const pct = Math.min(100, (val / max) * 100);
      row.innerHTML =
        "<span class='jh-bar-label'>" + label + "</span>" +
        "<span class='jh-bar'><span class='jh-bar-fill' style='width:" + pct + "%'></span></span>" +
        "<span class='jh-bar-val'>" + Math.round(val) + "/" + max + "</span>";
      bars.appendChild(row);
    }
    head.appendChild(bars);
    wrap.appendChild(head);

    // JD 缺失提示（粗算模式）
    if (!job.jd_text || job.jd_text.length < 30) {
      const warn = document.createElement("div");
      warn.className = "jh-sal jh-warn-line";
      warn.textContent = "⚠ 未读取到完整 JD 文本，当前为粗略分（仅按标题+薪资计算）。如页面为异步加载，稍等片刻会自动刷新。";
      wrap.appendChild(warn);
    }

    const chipsRow = document.createElement("div");
    chipsRow.className = "jh-chips";
    const mk = (list, cls) => list.slice(0, 10).map((s) => "<span class='jh-chip " + cls + "'>" + esc(s) + "</span>").join("");
    if (r.matched_skills.length) {
      chipsRow.innerHTML += "<div class='jh-chip-line'><span class='jh-chip-h'>命中</span>" + mk(r.matched_skills, "jh-ok") + "</div>";
    }
    if (r.missing_skills.length) {
      chipsRow.innerHTML += "<div class='jh-chip-line'><span class='jh-chip-h'>JD提到·简历暂无</span>" + mk(r.missing_skills, "jh-no") + "</div>";
    }
    if (chipsRow.innerHTML) wrap.appendChild(chipsRow);

    const salLine = document.createElement("div");
    salLine.className = "jh-sal";
    salLine.textContent = (job.salary ? "岗位：" + job.salary : "岗位薪资未知") + "  ｜  " +
      (profile.salary_expectation ? "期望：" + profile.salary_expectation : "未设置期望薪资");
    wrap.appendChild(salLine);

    const pitch = makePitch(job, profile, r.matched_skills, settings);
    const pitchBox = document.createElement("div");
    pitchBox.className = "jh-pitch";
    pitchBox.innerHTML =
      "<div class='jh-pitch-label'>打招呼话术</div>" +
      "<textarea class='jh-pitch-input' rows='2'>" + esc(pitch) + "</textarea>" +
      "<div class='jh-pitch-actions'><button class='jh-btn jh-btn-copy'>复制话术</button></div>";
    wrap.appendChild(pitchBox);

    const act = document.createElement("div");
    act.className = "jh-actions";
    act.innerHTML =
      "<button class='jh-btn jh-btn-apply'>投递该岗位</button>" +
      "<button class='jh-btn jh-btn-open'>打开岗位</button>";
    wrap.appendChild(act);

    $(".jh-btn-copy", pitchBox).addEventListener("click", () => {
      const ta = $(".jh-pitch-input", pitchBox);
      ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).catch(() => {});
      }
      toast("话术已复制");
    });
    $(".jh-btn-open", act).addEventListener("click", () => {
      const a = $("a[href*='job_detail'], a[href*='jobs/'], a[href*='/job/']", document);
      if (a) { a.click(); return; }
      const d = $$("a[href*='job_detail'], a[href*='jobs/'], a[href*='/job/']");
      if (d.length) d[0].click();
    });
    $(".jh-btn-apply", act).addEventListener("click", () => confirmApply(job, r, pitchBox));

    return wrap;
  }

  function makePitch(job, profile, matched, settings) {
    if (settings.pitch_template) {
      return settings.pitch_template
        .replace(/\{name\}/g, profile.name || "我")
        .replace(/\{job\}/g, job.title || "该岗位")
        .replace(/\{skills\}/g, matched.slice(0, 4).join("、") || "相关");
    }
    const name = profile.name || "我";
    const role = job.title || "该";
    const top = matched.slice(0, 4);
    if (top.length) {
      return "您好，我是" + name + "，看到贵司「" + role + "」岗位很感兴趣。我具备" + top.join("、") +
        "等技能，与岗位要求契合，期待能进一步沟通，谢谢！";
    }
    return "您好，我是" + name + "，看到贵司「" + role + "」岗位很感兴趣，我的经历与该方向匹配，希望能进一步沟通，谢谢！";
  }

  // ---------- 一键投递（半自动） ----------
  function findApplyButton() {
    const btns = $$("button, a, div[role='button']");
    const keywords = platform.applyKeywords || ["投递", "申请"];
    for (const b of btns) {
      try {
        const t = (b.textContent || "").replace(/\s+/g, "").trim();
        if (t && t.length <= 10 && keywords.some((k) => t.includes(k)) && b.offsetParent !== null) {
          return b;
        }
      } catch (e) { /* ignore */ }
    }
    for (const sel of ["[class*='startchat']", "[class*='btn-apply']", "[class*='deliver']", "[class*='apply']"]) {
      const el = $(sel, document);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function detailId() {
    const m = location.href.match(/(?:job_detail|jobs|job)\/([\w.-]+)/i);
    return m ? m[1] : (location.href.length > 80 ? location.href.slice(-60) : location.href);
  }

  async function isApplied(id) {
    if (!id) return false;
    const { applied_jobs } = await store.get("applied_jobs");
    return !!(applied_jobs && applied_jobs[id]);
  }
  async function markApplied(id, info) {
    if (!id) return;
    const { applied_jobs } = await store.get("applied_jobs");
    const next = Object.assign({}, applied_jobs || {});
    next[id] = Object.assign({ at: Date.now() }, info);
    await store.set({ applied_jobs: next });
  }
  async function renderAppliedFlag() {
    const id = detailId();
    if (!id) return;
    const yes = await isApplied(id);
    let flag = $("." + NS + "-applied");
    if (yes) {
      if (!flag) {
        flag = document.createElement("div");
        flag.className = NS + "-applied";
        document.body.appendChild(flag);
      }
      flag.textContent = "✓ 已投递";
      flag.style.display = "block";
    } else if (flag) {
      flag.style.display = "none";
    }
  }

  async function confirmApply(job, r, pitchBox) {
    if (await isApplied(detailId())) {
      toast("该岗位已投递过");
      return;
    }
    const mask = document.createElement("div");
    mask.className = "jh-mask";
    mask.innerHTML =
      "<div class='jh-confirm'>" +
      "<div class='jh-confirm-title'>确认投递「" + esc(job.title) + "」？</div>" +
      "<div class='jh-confirm-line'>匹配分 <b>" + Math.round(r.score) + "</b> · 命中技能 " + r.matched_skills.length + " 个 · 薪资 " + (job.salary || "未知") + "</div>" +
      "<div class='jh-confirm-line jh-confirm-warn'>将自动点击页面上的投递按钮（视平台流程，可能弹出简历/话术选择，请自行完成最后一步）</div>" +
      "<div class='jh-confirm-actions'>" +
      "<button class='jh-btn jh-btn-cancel'>取消</button>" +
      "<button class='jh-btn jh-btn-apply jh-confirm-ok'>确认投递</button>" +
      "</div></div>";
    document.body.appendChild(mask);

    $(".jh-btn-cancel", mask).addEventListener("click", () => mask.remove());
    $(".jh-confirm-ok", mask).addEventListener("click", async () => {
      mask.remove();
      const btn = findApplyButton();
      if (!btn) {
        toast("未找到投递按钮，请手动点击页面上的投递/申请按钮");
        return;
      }
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        try {
          btn.click();
          markApplied(detailId(), { title: job.title, company: job.company, score: r.score });
          toast("已触发投递，请完成弹窗中的最后一步");
        } catch (e) {
          toast("点击失败：" + e.message);
        }
      }, 350);
    });
  }

  // ---------- 匹配卡注入（修复：JD 解析失败也要注入 + 锚点健壮 + 不抛异常） ----------
  function injectMatchCard(profile, settings) {
    const job = parseDetail();
    dbg("详情页解析: title =", job.title, "| salary =", job.salary, "| jd长度 =", job.jd_text ? job.jd_text.length : 0);
    if (!job.title && !job.jd_text) {
      // 页面可能还在加载，交给 MutationObserver 重跑
      dbg("详情页未解析到任何字段，等待重跑");
      return;
    }
    const r = window.JobMatcher.scoreJob(job, profile);
    const old = $("." + NS + "-card");
    if (old) old.remove();
    const card = buildMatchCard(job, r, profile, settings);
    card.classList.add(NS + "-card");

    // 找锚点：平台 anchors 里第一个存在且可插入的
    let anchor = null;
    for (const sel of platform.anchors) {
      const el = $(sel, document);
      if (el && el.parentNode) { anchor = el; break; }
    }
    try {
      if (anchor) {
        anchor.parentNode.insertBefore(card, anchor);
      } else {
        // 兜底：插到页面正文顶部
        const body = document.body;
        const first = body.firstChild;
        body.insertBefore(card, first);
      }
    } catch (e) {
      // 实在不行就 append 到末尾
      document.body.appendChild(card);
    }
  }

  // ---------- 浮层详情（Boss 新版：点卡片 URL 不跳转，列表页内弹层显示 JD） ----------
  const OVERLAY_SELS = [
    ".job-detail",
    ".job-detail-wrap",
    ".job-detail-body",
    ".job-overlay",
    ".job-dialog",
    "[class*='job-detail']",
    "[class*='job-overlay']",
    "[class*='jobDetail']",
    "[class*='job-dialog']",
    "[class*='job-layer']",
  ];
  function isVisible(el) {
    try {
      if (el.offsetParent !== null || el.getClientRects().length > 0) return true;
    } catch (e) { /* jsdom 等无布局引擎环境 */ }
    // 兜底：按样式判断（display:none / visibility:hidden 视为不可见）
    try {
      const st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (st && (st.display === "none" || st.visibility === "hidden")) return false;
    } catch (e) { /* ignore */ }
    return true;
  }
  /** 找当前可见的岗位详情浮层容器（要求含完整 JD，避免误判短片段） */
  function findOverlayDetail() {
    for (const sel of OVERLAY_SELS) {
      const el = $(sel, document);
      if (!el || !isVisible(el)) continue;
      const txt = (el.textContent || "").replace(/\s+/g, " ");
      if (txt.length > 150 && /(k|K|万|元)/.test(txt) &&
        /(任职要求|岗位职责|职位描述|工作职责|职位亮点|经验|学历)/.test(txt)) {
        return el;
      }
    }
    return null;
  }
  /** 在浮层容器内解析岗位并注入匹配卡 */
  function injectOverlayCard(overlay, profile, settings) {
    const title = cleanTitle(pickText(overlay, [
      ".job-name", ".job-title", ".name", "h1",
      "[class*='job-name']", "[class*='job-title']", "[class*='jobName']",
    ]));
    const salary = pickText(overlay, [".salary", ".job-salary", "[class*='salary']"]);
    const jd = pickJd(overlay, [
      ".job-sec-text", ".job-detail-content", ".job-detail-section", ".job-require",
      ".job-description", "[class*='job-sec']", "[class*='job-detail']", "[class*='jobDetail']", "p",
    ]);
    dbg("浮层详情: title =", title, "| salary =", salary, "| jd长度 =", jd.length);
    if (!title && !jd) {
      removeOverlayCard();
      return;
    }
    const job = { title, salary, jd_text: jd };
    const r = window.JobMatcher.scoreJob(job, profile);
    const old = $("." + NS + "-card");
    if (old) old.remove();
    const card = buildMatchCard(job, r, profile, settings);
    card.classList.add(NS + "-card");
    let anchor = null;
    for (const sel of [
      ".job-sec-text", ".job-detail-content", ".job-detail-section", ".job-require",
      ".job-description", "[class*='job-sec']", "[class*='job-detail']",
    ]) {
      const el = $(sel, overlay);
      if (el && el.parentNode) { anchor = el; break; }
    }
    try {
      if (anchor) anchor.parentNode.insertBefore(card, anchor);
      else overlay.insertBefore(card, overlay.firstChild);
    } catch (e) {
      overlay.appendChild(card);
    }
    renderAppliedFlag();
  }
  function removeOverlayCard() {
    const old = $("." + NS + "-card");
    if (old && !isDetail()) old.remove();
  }

  // ---------- 主流程 ----------
  async function boot() {
    try {
      detect();
      const st = await store.get(["profile", "settings"]);
      const profile = st.profile;
      const settings = Object.assign({}, DEFAULT_SETTINGS, st.settings || {});
      dbg("URL =", location.href, "| 平台 =", platform ? platform.id : "未识别",
        "| 页面 =", isDetail() ? "详情" : isList() ? "列表" : "其他");
      if (!platform) return;

      // 详情页（独立 URL）优先
      if (isDetail()) {
        renderAppliedFlag();
        if (!profile) { showSetupHint(); return; }
        injectMatchCard(profile, settings);
        return;
      }
      // 浮层详情（Boss 新版弹窗）：优先于列表徽章
      const overlay = findOverlayDetail();
      if (overlay) {
        if (!profile) { showSetupHint(); return; }
        injectOverlayCard(overlay, profile, settings);
        if (isList()) injectListBadges(profile, settings);
        return;
      }
      removeOverlayCard();
      // 列表页
      if (isList()) {
        if (!profile) showSetupHint();
        else injectListBadges(profile, settings);
      }
    } catch (e) {
      console.warn("[jobhunter] boot error:", e);
    }
  }

  function showSetupHint() {
    let hint = $("." + NS + "-hint");
    if (hint) return;
    hint = document.createElement("div");
    hint.className = NS + "-hint";
    hint.innerHTML = "🐾 爪猎：尚未配置简历档案，<a href='#' id='" + NS + "-setup'>去配置</a>（先粘贴简历文本，自动提取技能）";
    document.body.appendChild(hint);
    $("#" + NS + "-setup", hint).addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        toast("请点击浏览器工具栏的插件图标 → 打开配置页");
      }
    });
  }

  // 动态加载（滚动分页 / SPA 切换）重新注入
  const reRun = debounce(() => {
    if (platform || window.JobPlatforms.matchPlatform()) boot();
  }, 500);
  new MutationObserver(reRun).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", reRun);
  const push = history.pushState;
  if (push) {
    history.pushState = function (...a) {
      const r = push.apply(this, a);
      setTimeout(reRun, 300);
      return r;
    };
  }

  boot();
})();
