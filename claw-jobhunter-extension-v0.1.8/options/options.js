/**
 * options.js — 配置页逻辑
 *  - 粘贴简历文本 → JobMatcher.extractFromResumeText 提取档案
 *  - 手动增删技能/目标职位，保存到 chrome.storage.local
 *  - JSON 导入导出（与 Python 端 resume_profile.json 互通）
 *  - 投递设置：阈值、徽章开关、话术模板
 */
"use strict";

const $ = (id) => document.getElementById(id);

// ---------- 状态 ----------
let profile = null;   // { name, skills[], target_roles[], salary_expectation }
let settings = null;  // { min_score, badge_enabled, pitch_template }

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toast(msg) {
  const t = $("status");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}
function load() {
  return new Promise((res) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["profile", "settings"], res);
    } else {
      let p = null, s = null;
      try { p = JSON.parse(localStorage.getItem("jobhunter:profile")); } catch (e) {}
      try { s = JSON.parse(localStorage.getItem("jobhunter:settings")); } catch (e) {}
      res({ profile: p, settings: s });
    }
  });
}
function save(key, val) {
  return new Promise((res) => {
    const obj = {}; obj[key] = val;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(obj, res);
    } else {
      localStorage.setItem("jobhunter:" + key, JSON.stringify(val));
      res();
    }
  });
}

// ---------- 渲染 ----------
function renderChips(container, list, onRemove) {
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = '<span class="empty">（暂无，可手动添加）</span>';
    return;
  }
  for (const item of list) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = item;
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.addEventListener("click", () => onRemove(item));
    c.appendChild(rm);
    container.appendChild(c);
  }
}

function renderProfile() {
  $("profileForm").style.display = profile ? "block" : "none";
  const tag = $("stateTag");
  if (profile && profile.skills && profile.skills.length) {
    tag.textContent = "已配置档案";
    tag.className = "tag tag-ok";
  } else {
    tag.textContent = "未配置档案";
    tag.className = "tag tag-warn";
  }
  if (!profile) return;
  $("fName").value = profile.name || "";
  $("fSalary").value = profile.salary_expectation || "";
  renderChips($("fRoles"), profile.target_roles || [], (v) => {
    profile.target_roles = (profile.target_roles || []).filter((x) => x !== v);
    renderProfile();
  });
  renderChips($("fSkills"), profile.skills || [], (v) => {
    profile.skills = (profile.skills || []).filter((x) => x !== v);
    renderProfile();
  });
}

function renderSettings() {
  if (!settings) return;
  $("minScore").value = settings.min_score || "";
  $("badgeEnabled").value = settings.badge_enabled === false ? "false" : "true";
  $("pitchTemplate").value = settings.pitch_template || "";
}

// ---------- 事件 ----------
$("btnPaste").addEventListener("click", async () => {
  try {
    const txt = await navigator.clipboard.readText();
    $("resumeText").value = txt;
    toast("已粘贴，可点击「从文本提取档案」");
  } catch (e) {
    toast("无法读取剪贴板，请手动 Ctrl+V");
  }
});

$("btnExtract").addEventListener("click", () => {
  const txt = $("resumeText").value.trim();
  if (!txt) { toast("请先粘贴简历文本"); return; }
  const p = window.JobMatcher.extractFromResumeText(txt);
  profile = {
    name: p.name || "",
    skills: p.skills || [],
    target_roles: p.target_roles || [],
    salary_expectation: p.salary_expectation || "",
  };
  renderProfile();
  toast("已提取：姓名「" + (profile.name || "未识别") + "」技能 " + profile.skills.length + " 个，请核对后保存");
});

$("btnAddRole").addEventListener("click", () => addChip("fRoles", "roleInput"));
$("roleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addChip("fRoles", "roleInput"); });
$("btnAddSkill").addEventListener("click", () => addChip("fSkills", "skillInput"));
$("skillInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addChip("fSkills", "skillInput"); });

function addChip(listId, inputId) {
  const val = $(inputId).value.trim();
  if (!val) return;
  if (!profile) { profile = { name: "", skills: [], target_roles: [], salary_expectation: "" }; }
  if (listId === "fRoles") {
    if (!profile.target_roles) profile.target_roles = [];
    for (const part of val.split(/[/、，,]/)) {
      const p = part.trim();
      if (p && !profile.target_roles.includes(p)) profile.target_roles.push(p);
    }
  } else {
    if (!profile.skills) profile.skills = [];
    for (const part of val.split(/[/、，,]/)) {
      const p = part.trim();
      if (p && !profile.skills.includes(p)) profile.skills.push(p);
    }
  }
  $(inputId).value = "";
  renderProfile();
}

$("btnSaveProfile").addEventListener("click", async () => {
  if (!profile) return;
  profile.name = $("fName").value.trim();
  profile.salary_expectation = $("fSalary").value.trim();
  await save("profile", profile);
  toast("档案已保存");
});

$("btnExportJson").addEventListener("click", () => {
  if (!profile) { toast("没有档案可导出"); return; }
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "resume_profile.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btnImportJson").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      profile = {
        name: obj.name || obj.姓名 || "",
        skills: obj.skills || obj.技能 || [],
        target_roles: obj.target_roles || obj.目标职位 || [],
        salary_expectation: obj.salary_expectation || obj.期望薪资 || "",
      };
      renderProfile();
      toast("已导入 JSON 档案");
    } catch (e) {
      toast("JSON 解析失败：" + e.message);
    }
  });
  input.click();
});

$("btnClearProfile").addEventListener("click", async () => {
  profile = null;
  $("resumeText").value = "";
  await save("profile", null);
  renderProfile();
  toast("档案已清空");
});

$("btnSaveSettings").addEventListener("click", async () => {
  settings = {
    min_score: parseFloat($("minScore").value) || 0,
    badge_enabled: $("badgeEnabled").value === "true",
    pitch_template: $("pitchTemplate").value.trim(),
  };
  await save("settings", settings);
  toast("设置已保存");
});

// ---------- init ----------
(async function init() {
  const st = await load();
  profile = st.profile || null;
  settings = st.settings || { min_score: 60, badge_enabled: true, pitch_template: "" };
  renderProfile();
  renderSettings();
})();
