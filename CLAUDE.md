# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 项目简介

发票合并打印工具 — 纯客户端的发票合并打印应用。用户上传 PDF/OFD 发票文件，在 A4 页面上排版，然后预览、下载或打印合并结果。所有处理均在浏览器端完成，无需服务器。

## 技术栈

- 纯 HTML5 + CSS3 + 原生 JavaScript（ES6+，async/await）
- 无框架、无构建工具、无包管理器
- 第三方库位于 `lib/` 目录：PDF.js（渲染）、pdf-lib（合并/生成）、JSZip（OFD 解析）

## 开发方式

无需构建，静态服务即可：

```
npx http-server -p 8000
```

然后浏览器打开 `http://localhost:8000`。

## 架构

单页应用，核心文件三个：`index.html`、`app.js`、`style.css`。

**app.js**（约 940 行）包含全部逻辑，组织方式如下：

- **全局 `state` 对象** — 统一管理上传文件、当前步骤、布局设置、预览缓存等状态
- **两步向导流程**：第一步 = 文件上传；第二步 = 布局配置 + 预览 + 打印/下载
- **文件处理流程**：
  - PDF：以 `Uint8Array` 加载，通过 PDF.js 渲染到离屏 Canvas，通过 pdf-lib 嵌入合并
  - OFD：通过 JSZip 解压，提取图片资源为 base64 数据 URI
- **预览**：基于 Canvas 渲染，使用 `Map` 缓存（`previewCache`），支持分页和设备像素比缩放
- **输出**：pdf-lib 生成合并 PDF → 通过隐藏 iframe 打印或通过 Blob URL 下载
- **DOM 操作**：直接使用 `getElementById`/`querySelector`，`elements` 对象缓存 DOM 引用

**关键常量**：A4 = 595×842pt，mm 转 pt = 2.83465，PDF 渲染缩放 = 1.5x。

## 代码规范

- 界面和文档均为中文（zh-CN）
- Git 提交信息使用中文或简短英文，无固定提交格式
- 未配置 lint 或格式化工具 — 遵循现有代码风格（2 空格缩进，JS 中使用单引号）
