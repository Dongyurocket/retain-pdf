// 顶部导航区——用户要求去掉白色卡片背景:logo 靠最左、"图书馆/合集/收藏/AI"分栏居中,
// 直接浮在灰底页面上。添加/搜索/设置 三样都下沉到底部一条浮动栏
// (AppBottomBar.jsx)。
//
// 居中做法:logo 左、两侧各一条 flex:1 的 spacer 把 tabs 挤到正中。#developer-btn/
// #open-output-btn 是契约 id(测试引用),保留在 display:none 的隐藏容器里,不占布局。

import { LibraryTopTabs } from "../library/page/LibraryTopTabs.jsx";

export function AppTopBar({ activeTab, onTabChange }) {
  return (
    <app-shell-header class="app-shell-header">
      <header className="topbar library-topbar">
        <a
          className="hero-repo-link library-brand-link"
          href="https://github.com/Dongyurocket/retain-pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img className="hero-repo-logo" src="src/assets/RetainPDF-logo.svg" alt="RetainPDF logo" />
          <span>RetainPDF</span>
        </a>
        <div className="hero-actions hidden" aria-hidden="true">
          <button id="developer-btn" type="button" className="secondary hidden" aria-hidden="true">开发者</button>
          <button id="open-output-btn" type="button" className="secondary hidden">打开输出目录</button>
        </div>
        <div className="library-topbar-spacer" aria-hidden="true" />
        <LibraryTopTabs active={activeTab} onChange={onTabChange} />
        <div className="library-topbar-spacer" aria-hidden="true" />
      </header>
    </app-shell-header>
  );
}
