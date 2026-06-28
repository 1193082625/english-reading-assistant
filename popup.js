// popup.js - 弹出窗口设置页面逻辑

// 预设提供商模板
const PROVIDER_PRESETS = {
  deepseek: { apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  minimax: { apiUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-Text-01' },
  ollama: { apiUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
};

// 默认术语
const DEFAULT_TERMINOLOGY = {
  callback: '回调',
  mount: '挂载',
  render: '渲染',
  deployment: '部署',
  token: '令牌',
  middleware: '中间件',
  hook: '钩子',
  bundle: '打包',
  async: '异步',
  await: '等待',
  promise: 'Promise',
  closure: '闭包',
  polyfill: '垫片',
  memoize: '记忆化',
  throttle: '节流',
  debounce: '防抖',
  namespace: '命名空间',
  prototype: '原型',
  inheritance: '继承',
};

// DOM 引用
let settings = null;
let currentTerminology = {};

// DOM 缓存
const els = {};

function $(id) { return document.getElementById(id); }

// =========== 导航切换 ===========

function initNav() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      $(`page-${btn.dataset.page}`).classList.add('active');
    });
  });
}

// =========== 设置加载/保存 ===========

async function loadSettings() {
  try {
    settings = await chrome.runtime.sendMessage({ type: 'get_settings' });
  } catch {
    settings = {
      apiKey: '',
      apiUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      defaultTab: 'translate',
      terminology: { ...DEFAULT_TERMINOLOGY },
    };
  }
  currentTerminology = { ...(settings.terminology || {}) };
}

function populateForm() {
  if (!settings) return;
  // 检测当前使用的提供商预设
  let provider = 'custom';
  for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
    if (settings.apiUrl === preset.apiUrl && settings.model === preset.model) {
      provider = key;
      break;
    }
  }
  $('provider').value = provider;
  $('apiUrl').value = settings.apiUrl || '';
  $('apiKey').value = settings.apiKey || '';
  $('model').value = settings.model || '';
  $('defaultTab').value = settings.defaultTab || 'translate';
  renderTermList();
}

function getFormData() {
  return {
    apiUrl: $('apiUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    defaultTab: $('defaultTab').value,
    terminology: currentTerminology,
  };
}

async function saveSettings() {
  const data = getFormData();
  await chrome.runtime.sendMessage({ type: 'save_settings', settings: data });
  settings = data;
  showToast('设置已保存');
  // 保存成功后延迟关闭
  setTimeout(() => window.close(), 800);
}

// =========== 提供商切换 ===========

function initProviderSwitch() {
  $('provider').addEventListener('change', () => {
    const val = $('provider').value;
    if (val === 'custom') return;
    const preset = PROVIDER_PRESETS[val];
    if (preset) {
      $('apiUrl').value = preset.apiUrl;
      $('model').value = preset.model;
    }
  });
}

// =========== 术语库 ===========

function renderTermList() {
  const list = $('termList');
  const entries = Object.entries(currentTerminology);
  if (entries.length === 0) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#bbb;font-size:12px;">暂无术语</div>';
    return;
  }
  list.innerHTML = entries
    .map(
      ([k, v]) =>
        `<div class="term-item">
          <span><span class="term-key">${escapeHtml(k)}</span> <span class="term-val">→ ${escapeHtml(v)}</span></span>
          <button class="term-del" data-key="${escapeHtml(k)}">&times;</button>
        </div>`
    )
    .join('');

  // 删除事件
  list.querySelectorAll('.term-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      delete currentTerminology[btn.dataset.key];
      renderTermList();
    });
  });
}

function initTermAdd() {
  $('termAddBtn').addEventListener('click', () => {
    const key = $('termKey').value.trim();
    const val = $('termVal').value.trim();
    if (!key || !val) return;
    currentTerminology[key] = val;
    $('termKey').value = '';
    $('termVal').value = '';
    renderTermList();
  });
  // 回车键添加
  $('termVal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('termAddBtn').click();
  });
  $('termKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('termVal').focus();
  });
}

function initTermImport() {
  $('termImportBtn').addEventListener('click', () => {
    $('termFileInput').click();
  });
  $('termFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        Object.assign(currentTerminology, data);
        renderTermList();
        showToast('术语已导入');
      } catch {
        showToast('导入失败：JSON 格式错误');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

function initTermExport() {
  $('termExportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(currentTerminology, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terminology.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function initTermReset() {
  $('termResetBtn').addEventListener('click', () => {
    if (confirm('确定恢复默认术语库？自定义术语将丢失。')) {
      currentTerminology = { ...DEFAULT_TERMINOLOGY };
      renderTermList();
      showToast('已恢复默认术语');
    }
  });
}

// =========== 工具 ===========

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// =========== 初始化 ===========

async function init() {
  // 为nav挂载点击事件
  initNav();

  // 加载设置信息
  await loadSettings();
  // 将数据填充到表单中
  populateForm();

  // 添加切换供应商事件
  initProviderSwitch();
  // 初始化术语库
  initTermAdd();
  // 从外部导入术语
  initTermImport();
  // 导出术语
  initTermExport();
  // 重置术语库
  initTermReset();

  // 保存设置
  $('saveBtn').addEventListener('click', saveSettings);
}

document.addEventListener('DOMContentLoaded', init);
