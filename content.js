// content.js - 英文阅读助手核心脚本
(function () {
  'use strict';

  if (window.__eraReaderInjected) return;
  window.__eraReaderInjected = true;

  // ============== 状态管理 ==============
  let settings = null;
  let selectedText = '';
  let selectedSource = null; // { element, text }
  let currentTab = 'translate';
  let currentSubTab = 'grammar'; // 'grammar' | 'tech'
  let isPanelOpen = false;
  let isContextValid = true; // 扩展上下文状态标记

  // 翻译缓存
  const translationCache = new Map();

  // AI 结果缓存（key: "操作类型:文本"）
  const aiResultCache = new Map();

  // 块级元素选择器
  const BLOCK_ELEMENTS = [
    'p', 'div', 'li', 'td', 'th', 'article', 'section',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'span', 'a', 'label',
  ];

  // ============== DOM 元素引用 ==============
  let floatBtn = null;
  let panel = null;
  let contentArea = null;
  let footerStatus = null;
  let tabBtns = {};
  let subBtns = {};
  let selectedTextDisplay = null;

  // ============== 工具函数 ==============

  // 检测文本语言
  function detectLanguage(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return /[\u4e00-\u9fa5]/.test(trimmed) ? 'zh' : 'en';
  }

  function getLanguagePair(text) {
    return detectLanguage(text) === 'zh' ? 'zh|en' : 'en|zh';
  }

  function getSourceLang(text) {
    return detectLanguage(text) === 'zh' ? 'zh' : 'en';
  }

  // 检测代码内容
  function detectCodeContent(text) {
    let score = 0;
    const lines = text.split('\n');
    lines.forEach((line) => {
      if (/^\s{2,}|\t/.test(line)) score += 0.3;
      if (/[{}=;<>]/.test(line)) score += 0.15;
    });
    const codeKeywords = /\b(function|class|import|const|let|var|def|if|for|while|return|export|interface|type|extends|implements)\b/;
    if (codeKeywords.test(text)) score += 0.3;
    if (score > 0.3 && document.querySelector('code, pre')) score += 0.2;
    return score > 0.4;
  }

  // 查找块级元素
  function findBlockElement(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.matches && BLOCK_ELEMENTS.some((sel) => el.matches(sel))) {
        if (el.textContent.trim().length > 0) return el;
      }
      el = el.parentElement;
    }
    return target;
  }

  // 获取元素文本内容
  function getElementText(element) {
    return element.textContent.trim();
  }

  // ============== 扩展上下文检测 ==============

  // 检测扩展上下文是否有效（处理 Extension context invalidated 错误）
  function checkExtensionContext() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // 从 background 获取设置
  async function loadSettings() {
    try {
      if (!checkExtensionContext()) {
        isContextValid = false;
        throw new Error('EXTENSION_CONTEXT_INVALIDATED');
      }
      settings = await chrome.runtime.sendMessage({ type: 'get_settings' });
    } catch (e) {
      if (e.message && (e.message.includes('Extension context invalidated') || e.message === 'EXTENSION_CONTEXT_INVALIDATED')) {
        isContextValid = false;
        throw e;
      }
      // 其他错误：使用默认设置
      settings = {
        apiKey: '',
        apiUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        defaultTab: 'translate',
        terminology: {},
      };
    }
  }

  // ============== 翻译函数 ==============

  // MyMemory 翻译
  async function translateViaMyMemory(text) {
    const langPair = getLanguagePair(text);
    const cacheKey = `${langPair}:${text}`;
    if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

    try {
      if (!checkExtensionContext()) {
        isContextValid = false;
        return null;
      }
      const result = await chrome.runtime.sendMessage({
        type: 'translate',
        text,
        langPair,
      });
      if (result.success) {
        translationCache.set(cacheKey, result.content);
        return result.content;
      }
      return null;
    } catch {
      return null;
    }
  }

  // AI 解读/摘要
  async function callAIChat(messages, overrides) {
    try {
      // 先确保 settings 已加载
      if (!settings) {
        try {
          await loadSettings();
        } catch (e) {
          return { success: false, error: 'EXTENSION_CONTEXT_INVALIDATED' };
        }
      }
      if (!checkExtensionContext()) {
        isContextValid = false;
        return { success: false, error: 'EXTENSION_CONTEXT_INVALIDATED' };
      }
      return await chrome.runtime.sendMessage({
        type: 'ai_chat',
        messages,
        overrides: overrides || {},
      });
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) {
        isContextValid = false;
        return { success: false, error: 'EXTENSION_CONTEXT_INVALIDATED' };
      }
      return { success: false, error: e.message };
    }
  }

  // 组装术语库指令
  function buildTerminologyPrompt() {
    if (!settings || !settings.terminology) return '';
    const terms = settings.terminology;
    const entries = Object.entries(terms).filter(([k, v]) => k && v);
    if (entries.length === 0) return '';
    const mapping = entries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
    return `\n术语映射（原文 → 指定翻译）：\n${mapping}\n请严格遵守以上映射，术语不得意译。`;
  }

  // 构建翻译 prompt
  function buildTranslatePrompt(text) {
    const sourceLang = getSourceLang(text);
    const targetLang = sourceLang === 'zh' ? '英文' : '中文';
    const termPrompt = buildTerminologyPrompt();
    return [
      { role: 'system', content: `你是一个技术文档翻译助手。将以下${sourceLang === 'zh' ? '中文' : '英文'}翻译成${targetLang}。\n- 技术术语按指定映射翻译\n- 代码/变量/API名不翻译\n- 保持格式\n- 翻译结果要通顺自然\n- 直接返回翻译结果，不要添加任何开场白或解释${termPrompt}` },
      { role: 'user', content: text },
    ];
  }

  // 构建语法分析 prompt
  function buildGrammarPrompt(text) {
    const termPrompt = buildTerminologyPrompt();
    return [
      {
        role: 'system',
        content: `你是一名英语语法老师。分析以下英文句子的语法结构。用中文输出。\n输出格式：\n【句子结构】主句 + 从句层级\n【关键动词】核心动词和主语\n【时态语态】说明时态/语态\n【分节解释】对长句分段解释\n\n注意：这不是翻译任务，而是语法分析任务。直接按格式输出分析结果，不需要任何开场白或客套话。${termPrompt}`,
      },
      { role: 'user', content: text },
    ];
  }

  // 构建技术讲解 prompt
  function buildTechPrompt(text) {
    const termPrompt = buildTerminologyPrompt();
    return [
      {
        role: 'system',
        content: `你是一个技术导师。讲解以下英文内容的核心含义，用中文输出。\n- 这段话在说什么\n- 关键概念解释\n- 补充必要的背景知识\n- 如果是代码：解释逻辑而非翻译代码本身\n\n这不是翻译任务，而是内容讲解任务。直接输出讲解内容，不要添加开场白。${termPrompt}`,
      },
      { role: 'user', content: text },
    ];
  }

  // 构建摘要 prompt
  function buildSummaryPrompt(text) {
    return [
      {
        role: 'system',
        content: `为以下英文内容生成结构化摘要。用中文输出。\n- 核心观点（3-5点）\n- 每点不超过30字\n- 技术文档：提炼API列表/功能/步骤\n- 学术论文：研究问题/方法/结论\n- 新闻/博客：核心观点/关键数据\n- 直接输出摘要内容，不要添加开场白或总结语`,
      },
      { role: 'user', content: text },
    ];
  }

  // ============== 翻译/解读/摘要执行 ==============

  // 获取 AI 结果缓存 key
  function getCacheKey(type, text, subMode) {
    return subMode ? `${type}-${subMode}:${text}` : `${type}:${text}`;
  }

  // 检测本地翻译（无需 AI Key）
  async function doLocalTranslate(text) {
    if (!isContextValid || !checkExtensionContext()) {
      isContextValid = false;
      showExtensionReloadError();
      return;
    }

    // 先试 MyMemory 缓存
    const langPair = getLanguagePair(text);
    const myMemoryKey = `${langPair}:${text}`;
    if (translationCache.has(myMemoryKey)) {
      showResult(translationCache.get(myMemoryKey));
      return;
    }

    // 再试 AI 翻译缓存
    const aiCacheKey = getCacheKey('translate', text);
    if (aiResultCache.has(aiCacheKey)) {
      showResult(aiResultCache.get(aiCacheKey));
      return;
    }

    showLoading();
    const result = await translateViaMyMemory(text);
    if (result) {
      showResult(result);
    } else if (!isContextValid) {
      showExtensionReloadError();
    } else {
      // MyMemory 失败，尝试 AI 翻译
      const messages = buildTranslatePrompt(text);
      const aiResult = await callAIChat(messages);
      if (aiResult.success) {
        aiResultCache.set(aiCacheKey, aiResult.content);
        showResult(aiResult.content);
      } else if (aiResult.error === 'EXTENSION_CONTEXT_INVALIDATED') {
        showExtensionReloadError();
      } else if (aiResult.error === 'API_KEY_MISSING') {
        showError('请在设置中配置 API Key');
      } else {
        showError('翻译失败: ' + (aiResult.error || '请重试'));
      }
    }
  }

  async function doAITranslate(text) {
    if (!isContextValid || !checkExtensionContext()) {
      isContextValid = false;
      showExtensionReloadError();
      return;
    }

    const cacheKey = getCacheKey('translate', text);
    if (aiResultCache.has(cacheKey)) {
      showResult(aiResultCache.get(cacheKey));
      return;
    }

    showLoading();
    if (!settings) await loadSettings();
    const messages = buildTranslatePrompt(text);
    const result = await callAIChat(messages);
    if (result.success) {
      aiResultCache.set(cacheKey, result.content);
      showResult(result.content);
    } else if (result.error === 'EXTENSION_CONTEXT_INVALIDATED') {
      showExtensionReloadError();
    } else if (result.error === 'API_KEY_MISSING') {
      showError('请在设置中配置 API Key');
    } else {
      showError('翻译失败: ' + (result.error || '请重试'));
    }
  }

  async function doInterpret(text, subMode) {
    if (!isContextValid || !checkExtensionContext()) {
      isContextValid = false;
      showExtensionReloadError();
      return;
    }

    // 检测是否含代码，自动切到技术讲解
    const isCode = detectCodeContent(text);
    const effectiveMode = isCode ? 'tech' : subMode;

    // 高亮对应的子模式按钮
    setActiveSubTab(effectiveMode);

    const cacheKey = getCacheKey('interpret', text, effectiveMode);
    if (aiResultCache.has(cacheKey)) {
      showResult(aiResultCache.get(cacheKey));
      return;
    }

    showLoading();
    if (!settings) await loadSettings();

    const messages =
      effectiveMode === 'grammar' ? buildGrammarPrompt(text) : buildTechPrompt(text);
    const result = await callAIChat(messages);
    if (result.success) {
      aiResultCache.set(cacheKey, result.content);
      showResult(result.content);
    } else if (result.error === 'EXTENSION_CONTEXT_INVALIDATED') {
      showExtensionReloadError();
    } else if (result.error === 'API_KEY_MISSING') {
      showError('请在设置中配置 API Key');
    } else {
      showError('解读失败: ' + (result.error || '请重试'));
    }
  }

  async function doSummarize(text) {
    if (!isContextValid || !checkExtensionContext()) {
      isContextValid = false;
      showExtensionReloadError();
      return;
    }

    const cacheKey = getCacheKey('summarize', text);
    if (aiResultCache.has(cacheKey)) {
      showResult(aiResultCache.get(cacheKey));
      return;
    }

    showLoading();
    if (!settings) await loadSettings();
    const messages = buildSummaryPrompt(text);
    const result = await callAIChat(messages);
    if (result.success) {
      aiResultCache.set(cacheKey, result.content);
      showResult(result.content);
    } else if (result.error === 'EXTENSION_CONTEXT_INVALIDATED') {
      showExtensionReloadError();
    } else if (result.error === 'API_KEY_MISSING') {
      showError('请在设置中配置 API Key');
    } else {
      showError('摘要失败: ' + (result.error || '请重试'));
    }
  }

  // ============== UI 构建 ==============

  function createFloatButton() {
    floatBtn = document.createElement('div');
    floatBtn.className = 'era-float-btn';
    floatBtn.textContent = '译';
    floatBtn.title = '英文阅读助手';
    floatBtn.style.fontSize = '20px';
    floatBtn.style.fontWeight = 'bold';
    document.body.appendChild(floatBtn);
    makeDraggable(floatBtn);
  }

  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, origX, origY;

    el.addEventListener('mousedown', (e) => {
      isDragging = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
        el.style.left = origX + dx + 'px';
        el.style.top = origY + dy + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!isDragging) togglePanel();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // 阻止浏览器原生 click，避免与 mousedown 重复触发
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.className = 'era-panel';

    // --- 标题栏 ---
    const header = document.createElement('div');
    header.className = 'era-panel-header';
    header.innerHTML = `<span class="era-panel-title">英文阅读助手</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'era-panel-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // --- 原文展示区 ---
    selectedTextDisplay = document.createElement('div');
    selectedTextDisplay.className = 'era-selected-text';
    selectedTextDisplay.textContent = '';
    panel.appendChild(selectedTextDisplay);

    // --- Tab 栏 ---
    const tabs = document.createElement('div');
    tabs.className = 'era-panel-tabs';
    const tabNames = ['translate', 'interpret', 'summarize'];
    const tabLabels = ['翻译', '解读', '摘要'];
    tabNames.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'era-tab-btn';
      btn.textContent = tabLabels[i];
      btn.dataset.tab = name;
      btn.addEventListener('click', () => switchTab(name));
      tabs.appendChild(btn);
      tabBtns[name] = btn;
    });
    panel.appendChild(tabs);

    // --- 子 Tab 栏（解读专属） ---
    const subTabs = document.createElement('div');
    subTabs.className = 'era-sub-tabs';
    subTabs.style.display = 'none';
    const subTabDefs = [
      { key: 'grammar', label: '语法分析' },
      { key: 'tech', label: '技术讲解' },
    ];
    subTabDefs.forEach((def) => {
      const btn = document.createElement('button');
      btn.className = 'era-sub-btn';
      btn.textContent = def.label;
      btn.dataset.subtab = def.key;
      btn.addEventListener('click', () => {
        setActiveSubTab(def.key);
        if (selectedText) doInterpret(selectedText, def.key);
      });
      subTabs.appendChild(btn);
      subBtns[def.key] = btn;
    });
    panel.appendChild(subTabs);

    // --- 内容区 ---
    contentArea = document.createElement('div');
    contentArea.className = 'era-panel-content';
    showPlaceholder('选中页面中的英文文本，点击按钮查看翻译、解读或摘要');
    panel.appendChild(contentArea);

    // --- 状态栏 ---
    const footer = document.createElement('div');
    footer.className = 'era-panel-footer';
    footerStatus = document.createElement('span');
    footerStatus.textContent = '未选中文本';
    const tip = document.createElement('span');
    tip.textContent = '右键点击也可翻译';
    footer.appendChild(footerStatus);
    footer.appendChild(tip);
    panel.appendChild(footer);

    document.body.appendChild(panel);
  }

  // ============== UI 操作 ==============

  function togglePanel() {
    if (isPanelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    // 打开面板时检查扩展上下文是否有效
    if (!isContextValid || !checkExtensionContext()) {
      isContextValid = false;
      panel.classList.add('open');
      isPanelOpen = true;
      document.addEventListener('mousedown', handleOutsideClick);
      showExtensionReloadError();
      return;
    }
    panel.classList.add('open');
    isPanelOpen = true;
    document.addEventListener('mousedown', handleOutsideClick);
    if (selectedText) {
      updateFooterStatus();
      switchTab(currentTab);
    }
  }

  function closePanel() {
    panel.classList.remove('open');
    isPanelOpen = false;
    document.removeEventListener('mousedown', handleOutsideClick);
  }

  function switchTab(tab) {
    currentTab = tab;

    // 更新 Tab 按钮状态
    Object.keys(tabBtns).forEach((key) => {
      tabBtns[key].classList.toggle('active', key === tab);
    });

    // 子 Tab 栏仅解读 Tab 显示
    const subTabs = panel.querySelector('.era-sub-tabs');
    subTabs.style.display = tab === 'interpret' ? 'flex' : 'none';

    // 无选中文本时显示占位
    if (!selectedText) {
      const msgs = {
        translate: '选中页面中的文本进行翻译',
        interpret: '选中英文文本进行语法分析或技术讲解',
        summarize: '选中要生成摘要的文本',
      };
      showPlaceholder(msgs[tab] || '');
      return;
    }

    // 执行对应操作
    switch (tab) {
      case 'translate':
        doLocalTranslate(selectedText);
        break;
      case 'interpret':
        doInterpret(selectedText, currentSubTab);
        break;
      case 'summarize':
        doSummarize(selectedText);
        break;
    }
  }

  function setActiveSubTab(key) {
    currentSubTab = key;
    Object.keys(subBtns).forEach((k) => {
      subBtns[k].classList.toggle('active', k === key);
    });
  }

  function showLoading() {
    contentArea.innerHTML = `<div class="era-loading"><div class="era-loading-spinner"></div>处理中...</div>`;
  }

  function showResult(text) {
    contentArea.innerHTML = `<div class="era-result-text">${formatResult(text)}</div>`;
  }

  function showError(msg) {
    const showSettingsLink = msg.includes('API Key');
    const div = document.createElement('div');
    div.className = 'era-error';
    div.textContent = msg;
    if (showSettingsLink) {
      const link = document.createElement('span');
      link.className = 'era-error-action';
      link.textContent = '去设置';
      link.addEventListener('click', () => {
        // 打开扩展弹出页（提示用户手动打开设置）
        alert('请在浏览器工具栏点击扩展图标，进入「设置」页配置 API Key');
      });
      div.appendChild(link);
    }
    contentArea.innerHTML = '';
    contentArea.appendChild(div);
  }

  // 显示扩展上下文失效错误（扩展重新加载后）
  function showExtensionReloadError() {
    isContextValid = false;
    const div = document.createElement('div');
    div.className = 'era-error';
    div.style.textAlign = 'center';
    div.style.padding = '20px';
    div.innerHTML = '<strong>扩展连接已断开</strong><p style="margin: 10px 0; font-size: 13px;">扩展已重新加载，当前页面的扩展功能已失效。</p>';
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '刷新页面';
    reloadBtn.className = 'era-error-action';
    reloadBtn.style.cssText = 'display:inline-block; margin-top:8px; padding:6px 16px; background:#1677ff; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px;';
    reloadBtn.addEventListener('click', () => location.reload());
    div.appendChild(document.createElement('br'));
    div.appendChild(reloadBtn);
    contentArea.innerHTML = '';
    contentArea.appendChild(div);
  }

  function showPlaceholder(msg) {
    contentArea.innerHTML = `<div class="era-placeholder">${msg}</div>`;
  }

  function updateFooterStatus() {
    if (selectedText) {
      footerStatus.textContent = `选中文本: ${selectedText.length} 字`;
      // 更新原文展示区
      selectedTextDisplay.textContent = selectedText;
      selectedTextDisplay.style.display = 'block';
    } else {
      footerStatus.textContent = '未选中文本';
      selectedTextDisplay.textContent = '';
      selectedTextDisplay.style.display = 'none';
    }
  }

  // 渲染 Markdown 为 HTML
  function formatResult(text) {
    if (!text) return '';
    const codeBlocks = [];

    // 1. 提取并保护代码块（防止内部反引号及格式被后续步骤误匹配）
    let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const cls = lang ? ` class="language-${lang}"` : '';
      const place = `\x00CODE_${codeBlocks.length}\x00`;
      // 代码块内要单独转义 HTML
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      codeBlocks.push(`<pre><code${cls}>${escaped.trim()}</code></pre>`);
      return place;
    });

    // 2. 转义剩余 HTML
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 3. 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 4. 图片
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');

    // 5. 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 6. 标题（合并一次替换，且先于行内格式化，标题内可含粗体/斜体）
    html = html.replace(/^(#{1,4}) (.+)$/gm, (_, hashes, content) => {
      return `<h${hashes.length}>${content}</h${hashes.length}>`;
    });

    // 7. 水平线
    html = html.replace(/^---$/gm, '<hr>');

    // 8. 无序列表（放在粗体/斜体前，防止 * item 被斜体误匹配）
    html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, '$1<li>$2</li>');

    // 9. 有序列表（支持 .、) 、 等分隔符，空格可选）
    html = html.replace(/^\d+[\.\)、]\s*(.+)$/gm, '<li>$1</li>');

    // 10. 用 <ul>/<ol> 包裹连续的 <li>
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, (match) => '<ul>' + match + '</ul>');
    // 将 <ul> 内的数字序号列表转为 <ol>
    html = html.replace(/<ul>\s*<li>\d+\./g, () => '<ol><li>');  // 标记转换起点
    html = html.replace(/(<ol>[\s\S]*?)<\/ul>/g, (_, inner) => inner + '</ol>');

    // 11. 删除线
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 12. 粗体+斜体（放在列表之后，避免 * 列表项被误匹配）
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 13. 恢复代码块占位符
    html = html.replace(/\x00CODE_(\d+)\x00/g, (_, i) => codeBlocks[+i] || '');

    // 14. 换行处理（将连续 \n 转为段落，单 \n 转 <br>）
    const blocks = html.split(/\n\n+/);
    html = blocks
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        // 已经是块级标签的不做段落包裹
        if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|table|div)/.test(trimmed)) return trimmed;
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');

    // 15. 清理列表元素周围的 <br>（避免 <li> 之间出现多余的换行间距）
    html = html.replace(/<br>\s*(?=<\/(?:li|ul|ol)>)/gi, '');
    html = html.replace(/<br>\s*(?=<(?:li|ul|ol))/gi, '');
    html = html.replace(/(?<=<\/(?:li|ul|ol)>)\s*<br>/gi, '');

    return html;
  }

  // ============== 文本选中监听 ==============

  let selectionTimer = null;

  function handleTextSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length < 2) {
        // 不立即清除，保留上次选中
        return;
      }

      // 忽略在面板或浮动按钮内的选中（用户复制内容时不应触发重新解析）
      if (selection.rangeCount > 0) {
        const node = selection.getRangeAt(0).commonAncestorContainer;
        if (panel && panel.contains(node) || floatBtn && floatBtn.contains(node)) {
          return;
        }
      }

      selectedText = text.length > 2000 ? text.substring(0, 2000) : text;

      // 获取选中的块级元素
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        selectedSource = { element: findBlockElement(range.commonAncestorContainer), text: selectedText };
      }

      updateFooterStatus();

      // 如果面板是打开的，自动触发当前 Tab
      if (isPanelOpen && selectedText) {
        // 检测代码内容，自动切换到解读
        if (detectCodeContent(selectedText) && currentTab === 'translate') {
          switchTab('interpret');
        } else {
          switchTab(currentTab);
        }
      }
    }, 300);
  }

  // 点击页面其他区域关闭面板
  function handleOutsideClick(e) {
    if (!isPanelOpen) return;
    if (
      panel &&
      !panel.contains(e.target) &&
      floatBtn &&
      !floatBtn.contains(e.target)
    ) {
      closePanel();
    }
  }

  // ============== 旧版右键翻译（保留兼容） ==============

  async function handleContextMenu(event) {
    // 如果面板开着，不拦截右键
    if (isPanelOpen) return;

    event.preventDefault();

    const tag = event.target.tagName.toLowerCase();
    if (
      ['input', 'textarea', 'select', 'button', 'a'].includes(tag)
    )
      return;

    const blockElement = findBlockElement(event.target);
    if (!blockElement) return;

    const text = getElementText(blockElement);
    if (!text || text.length < 2) return;

    const truncated = text.length > 500 ? text.substring(0, 500) : text;

    // 保存选中文本并打开面板
    selectedText = truncated;
    selectedSource = { element: blockElement, text: truncated };

    // 打开面板并显示翻译
    openPanel();
    switchTab('translate');
  }

  // ============== 初始化 ==============

  async function init() {
    await loadSettings();

    createFloatButton();
    createPanel();

    // 监听文本选中
    document.addEventListener('mouseup', handleTextSelection);

    // 保留右键翻译
    document.addEventListener('contextmenu', handleContextMenu, true);

    // 定期检查扩展上下文是否有效（每 10 秒检测一次）
    setInterval(() => {
      if (isContextValid && !checkExtensionContext()) {
        isContextValid = false;
        console.warn('英文阅读助手: 扩展上下文已失效，请刷新页面');
        // 如果面板已打开，显示失效提示
        if (isPanelOpen) {
          showExtensionReloadError();
        }
      }
    }, 10000);

    console.log('英文阅读助手已加载');
  }

  // 等待 DOM 就绪
  function safeInit() {
    init().catch((err) => {
      console.error('英文阅读助手初始化失败:', err);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }
})();
