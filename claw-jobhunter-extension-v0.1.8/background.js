/**
 * background.js — service worker
 * 目前仅做消息中转与安装事件处理；核心逻辑都在 content script 内。
 */
"use strict";

chrome.runtime.onInstalled.addListener(() => {
  // 首次安装：写入默认设置（不覆盖已有配置）
  chrome.storage.local.get(["settings"], ({ settings }) => {
    if (!settings) {
      chrome.storage.local.set({
        settings: { min_score: 60, badge_enabled: true, pitch_template: "" },
      });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "PING") {
    sendResponse({ ok: true, name: "jobhunter" });
  }
});
