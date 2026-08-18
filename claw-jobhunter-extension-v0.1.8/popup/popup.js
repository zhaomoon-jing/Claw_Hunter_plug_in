/**
 * popup.js — 弹窗：档案/阈值/今日投递 + 强制注入当前页（站点访问受限时兜底）
 */
"use strict";

const $ = (id) => document.getElementById(id);

const PLATFORM_RE = /zhipin\.com|zhaopin\.com|lagou\.com|liepin\.com/;
const FILES = ["content/matcher.js", "content/platforms.js", "content/inject.js"];

function fmtDate(t) {
  const d = new Date(t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** 强制给当前标签页注入 content 脚本（幂等，inject.js 自带防重复） */
async function injectCurrentTab(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

(async function init() {
  let tab = null;
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = t || null;
  } catch (e) { /* 非插件环境 */ }

  const injEl = $("injStatus");
  const btnInject = $("btnInject");
  const isPlatform = tab && tab.url && PLATFORM_RE.test(tab.url);

  if (isPlatform) {
    btnInject.style.display = "block";
    injEl.textContent = "正在注入当前页…";
    injEl.className = "inj";
    const r = await injectCurrentTab(tab.id);
    if (r.ok) {
      injEl.textContent = "✓ 已注入，请刷新页面查看分数（或直接滚动页面）";
      injEl.className = "inj ok";
    } else {
      injEl.textContent = "注入失败：" + r.error;
      injEl.className = "inj err";
    }
  } else {
    btnInject.style.display = "none";
    injEl.textContent = "当前页不是 Boss/智联/拉勾/猎聘，无需注入";
    injEl.className = "inj";
  }

  btnInject.addEventListener("click", async () => {
    if (!tab) return;
    injEl.textContent = "注入中…";
    injEl.className = "inj";
    const r = await injectCurrentTab(tab.id);
    injEl.textContent = r.ok ? "✓ 注入成功，请刷新页面" : "注入失败：" + r.error;
    injEl.className = r.ok ? "inj ok" : "inj err";
  });

  const { profile, settings, applied_jobs } = await new Promise((res) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["profile", "settings", "applied_jobs"], res);
    } else {
      let p = null, s = null, a = null;
      try { p = JSON.parse(localStorage.getItem("jobhunter:profile")); } catch (e) {}
      try { s = JSON.parse(localStorage.getItem("jobhunter:settings")); } catch (e) {}
      try { a = JSON.parse(localStorage.getItem("jobhunter:applied_jobs")); } catch (e) {}
      res({ profile: p, settings: s, applied_jobs: a });
    }
  });

  const s = settings || {};
  const hasProfile = !!(profile && profile.skills && profile.skills.length);
  $("profileState").textContent = hasProfile ? (profile.name || "已配置") + " · " + profile.skills.length + " 技能" : "未配置";
  $("profileState").className = "v " + (hasProfile ? "ok" : "warn");
  $("minScore").textContent = s.min_score ? s.min_score + " 分" : "60 分";

  const today = fmtDate(Date.now());
  let count = 0;
  if (applied_jobs) {
    for (const k of Object.keys(applied_jobs)) {
      if (fmtDate(applied_jobs[k].at) === today) count++;
    }
  }
  $("appliedCount").textContent = count + " 条";

  if (tab && tab.url) {
    const m = tab.url.match(PLATFORM_RE);
    if (m) {
      $("pageName").textContent = /job_detail\/|jobdetail\/|jobs\/|job\//.test(tab.url) ? "岗位详情页" : "招聘列表页";
    }
  }

  $("btnOptions").addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });
  $("btnRefresh").addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.reload();
      window.close();
    }
  });
})();
