// background.js - 后台脚本
// 可以用于长期运行的任务，如管理翻译历史等

const DEFAULT_TERMINOLOGY = {
    callback: "回调",
    mount: "挂载",
    render: "渲染",
    deployment: "部署",
    token: "令牌",
    middleware: "中间件",
    hook: "钩子",
    bundle: "打包",
    async: "异步",
    await: "等待",
    promise: "Promise",
    closure: "闭包",
    polyfill: "垫片",
    memoize: "记忆化",
    throttle: "节流",
    debounce: "防抖",
    namespace: "命名空间",
    prototype: "原型",
    inheritance: "继承",
}

// 默认配置
const DEFAULT_SETTINGS = {
    apiKey: "",
    apiUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    defaultTab: "translate",
    terminology: { ...DEFAULT_TERMINOLOGY },
}

// 预设提供商模板
const PROVIDER_PRESETS = {
  deepseek: { apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  minimax: { apiUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-Text-01' },
  ollama: { apiUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
};

// 获取所有设置
async function getSettings() {
    const result = await chrome.storage.local.get("settings");
    return {...DEFAULT_SETTINGS, ...result.settings};
}

// 保存设置
async function saveSettings(settings) {
    await chrome.storage.local.set({ settings })
}

// --------首先API代理-------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.type === "translate") {
        handleTranslate(request.text, request.langPair).then(sendResponse);
        return true;
    }
    if (request.type === "ai_chat") {
        // 从 storage 加载设置，合并 overrides
        getSettings().then((settings) => {
            const merged = { ...settings, ...(request.overrides || {}) };
            return handleAIChat(request.messages, merged);
        }).then(sendResponse);
        return true;
    }
    if (request.type === "get_settings") {
        getSettings().then(sendResponse);
        return true;
    }
    if(request.type === "save_settings") {
        saveSettings(request.settings).then(sendResponse);
        return true;
    }
    if (request.type === "get_preset") {
        sendResponse(PROVIDER_PRESETS[request.name] || null);
        return true;
    }
})

// ----------翻译（MyMemory API）------------
async function handleTranslate(text, langPair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.responseStatus === 200) {
      return { success: true, content: data.responseData.translatedText };
    }
    return { success: false, error: data.responseDetails || 'Translation failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ----------实现 DeepSeek/MiniMax/Ollama API 调用 （兼容 OpenAI 格式）------------
async function handleAIChat(messages, settings) {
    const { apiKey, apiUrl, model } = settings;
    if (!apiKey && !apiUrl.includes('localhost')) {
      return { success: false, error: 'API_KEY_MISSING' };
    }
    try {
        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.3,
                stream: false,
            }),
        });
        if (!response.ok) {
          const errText = await response.text();
          return { success: false, error: `API Error (${response.status}): ${errText}` };
        }
        const data = await response.json();
        return { success: true, content: data.choices[0].message.content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}