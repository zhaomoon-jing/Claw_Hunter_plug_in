/**
 * matcher.js — 简历 × 岗位 匹配引擎（纯规则，无外部依赖）
 *
 * 打分维度（总分 100）：
 *   - 技能匹配  W.SKILL  = 50   JD 文本中出现多少简历技能（按 min(技能数,10) 归一）
 *   - 职位方向  W.TITLE  = 30   岗位标题命中目标职位关键词；其次看技能词
 *   - 薪资匹配  W.SALARY = 20   岗位薪资区间与期望薪资区间重叠程度
 *
 * 城市不打分：城市由用户在使用网站时自行切换，插件不参与。
 *
 * 同时导出：
 *   - 浏览器环境：window.JobMatcher
 *   - Node 环境：module.exports（用于单元测试）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.JobMatcher = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // ---- 权重（用户最新要求：去掉城市维度，只看技能/职位/薪资）----
  const W = { SKILL: 50, TITLE: 30, SALARY: 20 };

  // ---- 技能词典（与 Python 版 parse.py SKILLS_DB 对齐，可按需扩展）----
  const SKILLS_DB = [
    // languages
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Golang", "C++", "C#", "C", "Rust",
    "PHP", "Ruby", "Swift", "Kotlin", "Scala", "R", "SQL", "HTML", "CSS", "Shell",
    // frontend
    "React", "Vue", "Angular", "Next.js", "Nuxt", "Svelte", "Tailwind", "Webpack", "Vite",
    // backend / frameworks
    "Node.js", "Django", "Flask", "FastAPI", "Spring Boot", "Spring", "Express", "Laravel",
    "TensorFlow", "PyTorch", "Keras", "Pandas", "NumPy", "scikit-learn", "LangChain",
    // data / db
    "MySQL", "PostgreSQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "Spark", "Hadoop",
    "Hive", "Flink", "ClickHouse", "Doris", "Oracle", "SQLite",
    // ML / NLP
    "Transformers", "BERT", "FAISS", "BM25", "LoRA", "PEFT", "Whisper", "ASR",
    "意图识别", "语音识别", "多模态", "向量检索", "RAG", "微调", "微服务", "高并发", "分布式",
    // devops / cloud
    "Docker", "Kubernetes", "K8s", "Linux", "Nginx", "CI/CD", "Git", "GitHub", "GitLab",
    "Jenkins", "Terraform", "AWS", "阿里云", "腾讯云", "Azure", "Prometheus", "Grafana",
    // methods / soft
    "机器学习", "深度学习", "NLP", "大模型", "LLM", "数据分析", "项目管理", "需求分析",
    "英语", "雅思", "托福", "六级", "CET-6", "CET-4",
  ].sort((a, b) => b.length - a.length); // 长词优先，避免 "C" 误命中

  // ---- 薪资解析 ----
  // 例："25K-35K" / "15-25K"（第一个单位可省）/ "2.5万-3.5万" / "2.5万-3.5"
  const RE_RANGE_K = /(\d+(?:\.\d+)?)\s*[kK]?\s*[-~—至]\s*(\d+(?:\.\d+)?)\s*[kK]/;
  const RE_WAN_LEFT = /(\d+(?:\.\d+)?)\s*万\s*[-~—至]\s*(\d+(?:\.\d+)?)\s*万?/;
  const RE_WAN_RIGHT = /(\d+(?:\.\d+)?)\s*[-~—至]\s*(\d+(?:\.\d+)?)\s*万/;
  // 智联等平台："9000-18000元"、"1000-2000元/月"
  const RE_YUAN = /(\d+(?:\.\d+)?)\s*[-~—至]\s*(\d+(?:\.\d+)?)\s*元/;
  const RE_SINGLE_K = /(\d+(?:\.\d+)?)\s*[kK]/;

  /**
   * 解析薪资文本 → [low_k, high_k]（千/月），失败返回 null。
   * 支持："25K-35K" "25k-35k·14薪" "2.5万-3.5万" "15-25K" "25K以上"
   */
  function parseSalary(text) {
    if (!text) return null;
    const s = String(text).replace(/\s+/g, "").replace(/以上|以下|起/g, "");
    let m = s.match(RE_RANGE_K);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    m = s.match(RE_WAN_LEFT) || s.match(RE_WAN_RIGHT);
    if (m) return [parseFloat(m[1]) * 10, parseFloat(m[2]) * 10];
    m = s.match(RE_YUAN);
    if (m) return [parseFloat(m[1]) / 1000, parseFloat(m[2]) / 1000];
    m = s.match(RE_SINGLE_K);
    if (m) {
      const v = parseFloat(m[1]);
      return [v, v];
    }
    // 兜底：纯数字对 "15-25" 视作 K
    m = s.match(/(\d+(?:\.\d+)?)\s*[-~—至]\s*(\d+(?:\.\d+)?)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    return null;
  }

  /** 在文本中查找技能（CJK 子串 / 英文词边界） */
  function findSkills(text) {
    const hay = String(text || "");
    const hits = [];
    for (const skill of SKILLS_DB) {
      if (/^[\u4e00-\u9fa5]/.test(skill)) {
        if (hay.includes(skill)) hits.push(skill);
      } else {
        const re = new RegExp("(?<![A-Za-z0-9])" + escapeReg(skill) + "(?![A-Za-z0-9])");
        if (re.test(hay)) hits.push(skill);
      }
    }
    return hits;
  }

  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 计算匹配分
   * @param {Object} job    { title, salary, jd_text, company }
   * @param {Object} profile { skills: [], target_roles: [], salary_expectation: "17k-25k" }
   * @returns {Object} { score, breakdown:{skill,title,salary}, matched_skills, missing_skills }
   */
  function scoreJob(job, profile) {
    const skills = (profile.skills || []).map((s) => String(s).trim()).filter(Boolean);
    const targetRoles = (profile.target_roles || []).map((s) => String(s).trim()).filter(Boolean);
    const title = job.title || "";
    // 只按 标题 + JD 文本 打分，公司不参与（用户无目标公司，公司名里的技能词不应加分）
    const jdText = [title, job.jd_text || ""].join(" ");

    // 1) 技能匹配
    const matched = skills.filter((s) => containsSkill(jdText, s));
    const skillScore = skills.length
      ? (matched.length / Math.min(skills.length, 10)) * W.SKILL
      : 0;

    // 2) 职位方向
    let titleScore = 0;
    const tl = title.toLowerCase();
    for (const role of targetRoles) {
      if (role && tl.includes(role.toLowerCase())) { titleScore = W.TITLE; break; }
    }
    if (!titleScore) {
      for (const s of skills) {
        if (containsSkill(title, s)) { titleScore = W.TITLE * 0.5; break; }
      }
    }

    // 3) 薪资匹配
    const jobSal = parseSalary(job.salary || "");
    const expSal = parseSalary(profile.salary_expectation || "");
    let salaryScore = 0;
    if (jobSal && expSal) {
      const [jl, jh] = jobSal;
      const [el, eh] = expSal;
      if (jl <= eh && jh >= el) {
        const center = (el + eh) / 2;
        salaryScore = jl <= center && center <= jh ? W.SALARY : W.SALARY * 0.6;
      }
    }

    // 5) 缺失技能：JD 要求里出现、但简历没有的常见技能
    const jdSkills = findSkills(jdText);
    const profileSkillSet = new Set(skills.map((s) => s.toLowerCase()));
    const missing = jdSkills.filter((s) => !profileSkillSet.has(s.toLowerCase()));

    const score = Math.round((skillScore + titleScore + salaryScore) * 10) / 10;
    return {
      score,
      breakdown: {
        skill: Math.round(skillScore * 10) / 10,
        title: Math.round(titleScore * 10) / 10,
        salary: Math.round(salaryScore * 10) / 10,
      },
      matched_skills: matched,
      missing_skills: missing,
    };
  }

  /** 判断 JD 文本是否包含某技能（英文按词边界，中文按子串） */
  function containsSkill(haystack, skill) {
    if (!skill) return false;
    if (/^[\u4e00-\u9fa5]/.test(skill)) return haystack.includes(skill);
    const re = new RegExp("(?<![A-Za-z0-9])" + escapeReg(skill) + "(?![A-Za-z0-9])");
    return re.test(haystack);
  }

  /**
   * 从简历文本提取候选档案（技能/期望薪资/目标职位）。
   * 供 options 页"粘贴简历文本"使用；返回可再手动编辑。
   */
  function extractFromResumeText(text) {
    const t = String(text || "");
    const profile = { name: "", skills: [], target_roles: [], salary_expectation: "" };
    // 姓名
    let m = t.match(/姓名[：:\s]*([\u4e00-\u9fa5]{2,4})/);
    if (!m) {
      for (const line of t.split("\n")) {
        const s = line.trim().replace(/(个人)?(求职)?简历$/, "").trim();
        if (s.length >= 2 && s.length <= 4 && /^[\u4e00-\u9fa5]+$/.test(s)) { m = [null, s]; break; }
      }
    }
    if (m) profile.name = m[1];
    // 技能
    profile.skills = findSkills(t);
    // 期望薪资（含"薪资""期望"的行）
    m = t.match(/[^\n]*(?:期望薪资|期望薪酬|期望待遇|薪资要求|月薪|薪酬)[^\n]*/);
    if (m) {
      const sal = parseSalary(m[0].split(/[：:]/, 2)[1] || m[0]);
      if (sal) profile.salary_expectation = sal[0] + "k-" + sal[1] + "k";
    }
    // 目标职位（求职意向行）
    m = t.match(/[^\n]*(?:求职意向|期望职位|期望岗位|目标职位|意向职位)[^\n]*/);
    if (m) {
      const val = (m[0].split(/[：:]/, 2)[1] || "").replace(/联系电话.*$/, "");
      profile.target_roles = val.split(/[/、，,]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    }
    return profile;
  }

  return {
    W,
    SKILLS_DB,
    parseSalary,
    findSkills,
    scoreJob,
    extractFromResumeText,
  };
});
