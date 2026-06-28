# 英文阅读助手

Chrome 浏览器扩展（Manifest V3），英文文档阅读辅助工具。选中文本即可翻译、解读长难句、生成摘要。

## 功能

- **翻译** — 选中文本，一键翻译（中/英双向），默认使用 MyMemory 免费 API
- **解读** — 长难句语法结构分析 + 技术内容智能讲解
- **摘要** — 为文章或段落生成结构化摘要
- **代码识别** — 自动检测代码内容，智能切换到技术讲解模式
- **术语库** — 自定义术语翻译映射，确保技术术语翻译一致性
- **右键翻译** — 右键点击段落即可快速翻译

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 启用右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目目录

## 使用

1. 打开任意英文网页
2. 选中要处理的文本
3. 点击页面右下角的 **译** 浮动按钮打开面板
4. 切换「翻译 / 解读 / 摘要」Tab 查看结果
5. 右键点击段落也可快速翻译

## AI 服务配置

点击扩展图标进入设置页，可配置以下 AI 提供商：

| 提供商        | API 地址                      | 默认模型          |
| ------------- | ----------------------------- | ----------------- |
| DeepSeek      | `https://api.deepseek.com/v1` | `deepseek-chat`   |
| MiniMax       | `https://api.minimaxi.com/v1` | `minimax-text-01` |
| Ollama (本地) | `http://localhost:11434/v1`   | (留空)            |
| 自定义        | 任意 OpenAI 兼容 API          | 任意              |

- 翻译功能优先使用 MyMemory 免费 API（无需 Key），失败时自动回退到 AI 翻译
- 解读和摘要功能需要配置 AI API Key
- 本地 Ollama 可留空 API Key

## 项目结构

```
translation-plugin/
├── manifest.json         # 扩展配置（Manifest V3）
├── content.js            # 核心脚本：浮动按钮 + 功能面板
├── background.js         # Service Worker：API 代理 + 存储管理
├── styles.css            # 面板样式（含深色模式）
├── popup.html            # 设置页面
├── popup.js              # 设置页面逻辑
├── icons/
│   └── icon.svg          # 扩展图标
└── prompts/              # (未使用) AI Prompt 模板
```

## 核心文件说明

| 文件                      | 职责                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `content.js`              | 注入页面：浮动按钮创建、功能面板（翻译/解读/摘要 Tab）、文本选中监听、代码检测  |
| `background.js`           | Service Worker：MyMemory 翻译代理、OpenAI 兼容格式 AI 代理、chrome.storage 管理 |
| `popup.html` / `popup.js` | 设置页面：AI 提供商/Key/模型配置、术语库管理                                    |
| `styles.css`              | 浮动按钮、面板、语法树等 UI 样式                                                |

## 技术栈

- **架构**: Chrome Extension Manifest V3
- **翻译**: MyMemory API
- **AI**: OpenAI 兼容格式（默认 DeepSeek，可选 MiniMax/Ollama）
- **存储**: chrome.storage.local
