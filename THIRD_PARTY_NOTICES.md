# 第三方依赖与许可证

本项目仅使用宽松许可（MIT / ISC / BSD / Apache-2.0）依赖，未引入 GPL / AGPL 组件。
以下版本锁在本仓库 `package-lock.json` 中，`npm ci` 可完全复现。

## 后端

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| fastify | 5.12.8 | MIT | HTTP 服务框架 |
| @fastify/static | 8.3.0 | MIT | 提供前端构建产物与 `/media` 静态资源 |
| @fastify/cookie | 11.1.5 | MIT | 会话 Cookie |
| @fastify/rate-limit | 10.3.0 | MIT | 接口限流 |
| better-sqlite3 | 12.11.1 | MIT | SQLite 驱动（WAL） |
| @node-rs/argon2 | 2.2.2 | MIT | argon2id 密码哈希 |
| zod | 3.25.76 | MIT | 入参校验 |
| pino | 9.14.0 | MIT | 结构化日志（Fastify 内置） |

## 前端

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| vue | 3.5.44 | MIT | 视图框架 |
| vue-router | 4.6.4 | MIT | 路由 |
| pinia | 2.3.1 | MIT | 状态管理 |
| lucide-vue-next | 0.469.0 | ISC | 图标 |
| dompurify | 3.4.17 | MPL-2.0 OR Apache-2.0 | 富文本消毒（本项目按 Apache-2.0 使用） |

## 浏览器端文档解析（仅在前端加载）

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| mammoth | 1.13.0 | BSD-2-Clause | docx → HTML/纯文本 |
| pdfjs-dist | 4.10.38 | Apache-2.0 | PDF 文本层抽取与坐标重建 |
| xlsx | 0.18.5 | Apache-2.0 | Excel 读取 |
| papaparse | 5.7.0 | MIT | CSV 解析 |

## 构建与测试（devDependencies）

vite、@vitejs/plugin-vue、typescript、vue-tsc、vitest、jsdom、@vue/test-utils、@types/*：均为 MIT。

## 字体

**Maple Mono** — Copyright 2022 The Maple Mono Project Authors
(<https://github.com/subframe7536/maple-font>)，SIL Open Font License 1.1。

随产物同源托管的文件：

- `apps/web/public/fonts/MapleMono-Regular.woff2`（74.8 KB）
- `apps/web/public/fonts/MapleMono-Bold.woff2`（77.4 KB）
- `apps/web/public/fonts/LICENSE-MapleMono.txt`（OFL 1.1 全文）

只加载实际使用的两个字重（400 / 700），未使用 CN 版字库；中文由系统字体栈渲染，
题库中新增的生僻字或符号会正常回退到系统字体，不会出现缺字。
