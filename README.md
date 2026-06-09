# Excalidaw

Excalidaw 是一款基于 Excalidraw 打造的 Windows 桌面绘图工具。它保留了 Excalidraw 熟悉的手绘白板体验，同时加入本地优先的 AI 能力，可以 AI 生图，也可以生成可继续编辑的 AI 生图表。

这个项目适合用来做流程图、产品草图、架构说明、内容策划图、教学图解和日常白板记录。核心目标是简单、大气、一目了然：先让主要内容清楚呈现，再让辅助信息自然补充。

## 主要功能

- 纯净的 Excalidraw 桌面版体验。
- 本地打开、保存和导出 `.excalidraw` 文件。
- 内置 AI 图片生成面板，支持比例和清晰度设置。
- 生成的图片会自动放入画布，并保持正确比例。
- 支持 AI 生图表，生成结果是可编辑的 Excalidraw 元素。
- 优化图表连接线，减少线段与元素之间的断联和悬空。
- 新增「新建页面」，一键清空当前画布并开始新的创作。
- 新增「历史生成」，可以查看并恢复之前生成过的内容。
- 图片模型和语言模型分开配置。
- 支持 OpenAI 兼容接口，可自定义 Base URL 和接口路径。

## 下载使用

Windows 版本会发布在 GitHub Releases 中。

进入最新版本页面，下载 `Excalidaw-0.1.1-x64.exe`，双击运行即可使用：

[下载最新版 Excalidaw](https://github.com/1wanganshi/excalidaw/releases/latest)

## 开发运行

```bash
npm install
npm run dev
```

## 打包构建

生成未打包的 Windows 桌面应用：

```bash
npm run pack
```

生成 Windows 便携版可执行文件：

```bash
npm run build
```

构建产物会输出到 `release/` 目录。

## AI 模型配置

打开应用内「设置」，添加需要使用的模型：

- 图片模型：用于 AI 图片生成，默认接口路径为 `/images/generations`。
- 语言模型：用于生成可编辑的 Excalidraw 图表，默认接口路径为 `/chat/completions`。

API Key 会保存在你本机的应用存储中，不会提交到这个代码仓库。

## 技术栈

- Electron
- React
- Vite
- TypeScript
- `@excalidraw/excalidraw`

## 开源协议

MIT
