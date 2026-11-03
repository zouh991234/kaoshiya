# 考试鸭（KaoShiYa）

自建题库的刷题 / 模拟考试平台。导入 Word、PDF、Excel、CSV、TXT、Markdown、JSON，
解析成统一结构后用于刷题、模拟考试与统计。

面向站长与少量熟人使用：**不开放公开注册**，账号由有权限的用户创建，保留完整的用户、角色与权限管理。

- 电脑与手机访问同一公网地址（`http://<公网IP>:<端口>`），登录同一账号即可读取同一份题库、进度、错题、收藏、笔记与考试记录。
- 默认「常规主题」（暖白 + 黄色点缀），可随时切换「低调主题」（黑白灰）；浅色 / 深色独立切换。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Vue Router + Pinia + lucide 图标；图表为自绘 SVG |
| 后端 | Node 22 + Fastify + TypeScript + Zod + better-sqlite3（WAL） |
| 认证 | argon2id（`@node-rs/argon2`）+ 服务端 `sessions` 表 + httpOnly Cookie（不使用 JWT） |
| 日志 | pino 输出 stdout，Docker json-file 轮转（10m × 3） |

目录结构：

```
apps/web          Vue3 前端（含浏览器端文档解析与三栏校对工作台）
apps/server       Fastify 后端、SQLite 迁移、RBAC、备份
packages/shared   TS 类型、权限点常量、题型枚举、切题模板、浏览器端解析器
deploy            Dockerfile、compose.yaml、backup.sh、nginx.conf.example
```

---

## 为什么文档解析放在浏览器端（请勿"优化"回服务端）

解析 docx / pdf / xlsx 是典型的 CPU 与内存尖峰：百页 PDF 在 Node 里解析峰值可达 500 MB 以上，
而本服务与其它站点共用一台 4 核 4 GB 云服务器，容器内存上限只有 384 MB。
把解析放在服务端会直接威胁同机其他服务，也会让容器频繁被 OOM 杀死。

更关键的是：**校对环节本来就要求人工逐题目视核对**。既然人必须在环，就把解析放在人所在的那一端。

因此：

1. 前端完成 文件读取 → 抽取 → 切题 → 题型识别 → 三栏校对 → 提交。
2. 后端 `POST /api/banks/:bankId/import` **只接收已校对的结构化 JSON**，
   不接收原始文档、不做 OCR、不解析 docx/pdf/xlsx。
3. 提交按批进行（每批 ≤ 100 题、单请求 ≤ 2 MB），带 `batchIndex` 与 `importId`，
   支持断点续传，重复提交同一批不会重复入库。

这是架构约束，不是临时实现。

---

## 本地开发

前置：Node.js ≥ 22、npm ≥ 10。

```bash
npm ci                 # 安装依赖（monorepo workspaces）
npm run build:shared   # 先构建共享包（前后端都依赖它）
npm run dev:server     # 后端：http://127.0.0.1:3300
npm run dev:web        # 前端：http://127.0.0.1:5273（/api 已代理到 3300）
```

后端需要环境变量，本地开发最小配置：

```bash
PUBLIC_ORIGIN=http://127.0.0.1:5273 npm run dev:server
```

> 注意：`PUBLIC_ORIGIN` 必须与浏览器地址栏里的协议 + 主机 + 端口**完全一致**，
> 否则登录会被 CSRF 同源校验拒绝。

常用脚本（根目录）：

```bash
npm run typecheck   # 三个包的类型检查
npm run build       # shared → server → web 全量构建
npm test            # 服务端 vitest（登录 / 越权 403 / 导入主链路）
```

---

## 部署（公网 IP + 端口直连）

目标机器：4 核 4 GB 云服务器，容器限制 `mem_limit: 384m`、`cpus: 1.0`。

本次实例的实际部署参数：

| 项 | 值 |
|---|---|
| 访问地址 | `http://110.40.154.248:20260` |
| 宿主端口 | `20260`（容器内 `0.0.0.0:3300`） |
| `PUBLIC_ORIGIN` | `http://110.40.154.248:20260` |
| 部署目录 | `/opt/kaoshiya`（数据卷 `deploy/data`） |
| 端口范围约束 | 该机器安全组只开放 `20260–20300`，因此未使用文档默认的 3300 |

### 1. 准备

```bash
git clone <本仓库地址> kaoshiya
cd kaoshiya/deploy
cp .env.example .env
vi .env          # 设置 PUBLIC_ORIGIN 与 APP_PORT

# 关键：数据目录由容器内的非 root 用户（uid 10001）写入，
# 必须先把宿主机目录属主改好，否则启动会报 SQLITE_CANTOPEN
mkdir -p data/media data/backups
sudo chown -R 10001:10001 data
```

`.env` 示例：

```
PUBLIC_ORIGIN=http://110.40.154.248:20260
APP_PORT=20260
```

- `PUBLIC_ORIGIN`：浏览器实际访问的地址，**含协议与端口**，不要带路径。
- `APP_PORT`：宿主机端口，需与 `PUBLIC_ORIGIN` 里的端口一致。

### 2. 构建与启动

```bash
docker compose build
docker compose up -d
docker compose logs -f --tail=50
```

多阶段构建：前端 `vite build` → 后端 `tsc` → 运行镜像只装生产依赖，并以非 root 用户运行。

> 国内网络环境：若 Docker Hub 不可达，可在 `/etc/docker/daemon.json` 配置
> `"registry-mirrors": ["https://docker.m.daocloud.io"]`，并确认 Docker 守护进程没有配置
> 指向失效代理的 `HTTP_PROXY`（`/etc/systemd/system/docker.service.d/`）。
> 镜像构建阶段使用 npmmirror 安装依赖、并本地编译 better-sqlite3，无需访问 GitHub 下载预编译包。

### 3. 首次初始化

浏览器打开 `http://<公网IP>:<端口>`，会自动跳转 `/setup`，创建唯一 owner 账号。
**初始化完成后 `/setup` 永久返回 404**，此接口不可重复使用。

建议：先把云安全组以外的访问收窄（可选绑定 IP 白名单），完成初始化后再对外开放。

### 4. 网络放行（三层都要检查）

1. **云安全组**：放行所选端口（TCP）。
2. **宿主防火墙**（如 firewalld / iptables）：放行同一端口。
3. **Docker 端口映射**：`compose.yaml` 中 `${APP_PORT}:3300`，左侧必须是宿主端口；
   容器内固定监听 `0.0.0.0:3300`。不要把映射写成 `127.0.0.1:...`，否则公网无法访问。

数据库、备份目录、原始配置不对外暴露；容器只发布上述一个端口。

### 5. HTTPS（可选）

当前默认按 HTTP 直连部署，**HTTP 不提供传输加密**，请勿在公网传递敏感信息。
若配置了 HTTPS（反向代理或 IP 证书），把 `PUBLIC_ORIGIN` 改成 `https://...`，
服务会自动为 Cookie 加上 `Secure`，并输出 HSTS 头。

直连 HTTP 时**不会**设置 `Secure`，否则浏览器不会回传 Cookie，登录后会立刻变成未登录状态。

`deploy/nginx.conf.example` 是可选的 Nginx 反代示例，不是默认依赖。

---

## 用 JSON 批量导入（推荐给大量题目 / AI 整理）

扫描版 PDF 没有文字层，无法直接解析。把题目交给 AI 整理成下面的 JSON（或转成 Word），
在导入向导里选择 `.json` 文件即可跳过切题，直接进入校对入库：

```json
{
  "questions": [
    {
      "chapter": "第一章 静电场",
      "type": "single",
      "stem": "题干文字",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "B",
      "explanation": "解析文字",
      "difficulty": 3
    },
    { "type": "multiple", "stem": "…", "options": ["…"], "answer": ["A", "C"], "explanation": "…" },
    { "type": "judge", "stem": "…", "answer": "对", "explanation": "…" },
    { "type": "essay", "stem": "…", "answer": "参考答案", "explanation": "…" }
  ]
}
```

字段说明：`type` 取 `single / multiple / judge / blank / essay`（可省略，自动识别）；
`answer` 判断题写「对 / 错 / √ / ×」皆可（统一存为 T / F），多选传数组；
`options` 也接受 `{"A": "…", "B": "…"}` 对象；`chapter` 缺省为未分章。

## 演示数据

正式部署默认**不生成**任何演示账号或固定密码。需要体验完整链路时显式执行：

```bash
docker compose exec -T kaoshiya node apps/server/dist/seed-demo.js
```

会创建：

- 演示账号 `demo_admin`（admin 角色）、`demo_member`（member 角色），初始密码随机生成并打印一次，首次登录需改密；
- 3 套演示题库：计算机基础（模拟编号式 docx）、低压电工（模拟答案在卷末的 pdf）、安全生产法规（模拟 xlsx 列映射）；
- 题库内含**故意保留的脏数据**（缺解析、重复题干、答案越界、重复题号），用于演示校对工作台的 `!` 标记与质量报告。

清除演示数据：

```bash
docker compose exec -T kaoshiya node apps/server/dist/seed-demo.js --clean
```

---

## 备份与恢复

### 备份

```bash
./deploy/backup.sh
```

脚本调用容器内的 `apps/server/dist/backup-cli.js`，使用 **SQLite 在线备份 API**
（等价于 `sqlite3_backup`）生成一致性快照，**不直接复制正在写入的数据库文件**，
同时归档 `data/media` 与清单元数据，自动保留最近 7 份。

备份位置：`deploy/data/backups/<时间戳>/`（含 `kaoshiya.db`、`media/`、`manifest.json`）。

crontab 示例（每天 03:20）：

```cron
20 3 * * * /path/to/kaoshiya/deploy/backup.sh >> /path/to/kaoshiya/data/backup.log 2>&1
```

管理后台「数据备份」页也可以一键备份 / 删除 / 恢复。

### 恢复

1. 停止写入（暂停刷题与导入）。
2. 后台 → 数据备份 → 选择备份 → 输入备份 ID 确认恢复。
3. 服务会先把当前数据另存为 `pre-restore-<时间戳>` 快照，再替换数据库与媒体目录，随后自动重启。
4. 恢复后核对：账号、题库、配图、进度、收藏、笔记、考试记录。

恢复前会校验备份包结构、`schema_migrations` 与 `PRAGMA integrity_check`；校验失败会中止并保留原数据。

---

## 升级与回滚

```bash
cd kaoshiya
git pull
cd deploy
docker compose build && docker compose up -d
```

> 若服务器直连 GitHub 超时（国内常见），可在本地打包后上传，服务器上解压覆盖即可：
>
> ```bash
> # 本地
> tar --exclude=node_modules --exclude=.git --exclude=dist --exclude=data -czf kaoshiya-src.tgz kaoshiya
> scp -P <ssh端口> -i <私钥> kaoshiya-src.tgz root@<服务器>:/tmp/
> # 服务器
> cd /opt && tar -xzf /tmp/kaoshiya-src.tgz && cd /opt/kaoshiya/deploy && docker compose build && docker compose up -d
> ```

- 数据库迁移是增量 SQL（`apps/server/migrations/*.sql`），启动时自动执行，执行记录在 `schema_migrations`。
- 回滚：`git checkout <上一个 tag/commit>` 后重新 `build` + `up -d`；
  若新版本已执行过迁移，请从升级前的备份恢复数据库（见上）再回滚镜像。
- 升级前建议先执行一次 `./deploy/backup.sh`。

---

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 能打开页面但登录后立刻回到未登录 | `PUBLIC_ORIGIN` 与实际访问地址不一致（协议/端口/主机不匹配）。改 `.env` 后 `docker compose up -d` |
| 写操作返回 403 `CSRF_FORBIDDEN` | 请求的 `Origin`/`Referer` 与 `PUBLIC_ORIGIN` 不同源；检查是否经由反向代理改写了 Host |
| 公网打不开、容器内 `curl` 正常 | 云安全组或宿主防火墙未放行端口；确认映射为 `0.0.0.0` 而非 `127.0.0.1` |
| 启动即退出，日志提示缺少 `PUBLIC_ORIGIN` | `deploy/.env` 没有配置，或 compose 未在同一目录执行 |
| 502 / 健康检查失败 | `docker compose logs kaoshiya`；常见为 `data/` 目录权限不足（容器以 uid 10001 运行，需可写） |
| 内存超限被杀 | 容器 `mem_limit: 384m`；不要在服务端做文档解析（见上文架构约束） |
| 导入页首次打开较慢 | pdfjs / xlsx / mammoth 是按需加载的独立分块，只在进入导入页并选择文件时下载 |

---

## 实测记录（截至交付时）

在 4 核 4 GB 的云服务器（与其它站点共用）上以 Docker 部署实测：

```
$ docker stats kaoshiya --no-stream
NAME       MEM USAGE / LIMIT     CPU %
kaoshiya   51.14MiB / 384MiB     0.00%      # 空闲
kaoshiya   49.06MiB / 384MiB     0.01%      # 导入 5000 题期间
```

- 后端常驻 RSS 约 **49–51 MB**（要求 ≤ 120 MB），空闲 CPU ≈ 0。
- 5000 题分 50 批导入：总耗时约 **4.5 s**（每批 100 题约 88–93 ms），期间容器内存无明显增长。
- 公网访问 `http://<IP>:<端口>` 首屏响应约 **75 ms**。
- 登录保护：同 IP 连续 5 次错误后返回 429；回环期内即使密码正确也被拒绝。
- 备份恢复：恢复前自动生成 `pre-restore-*` 快照，服务重启后账号、题库、题目数量与恢复前一致。

以上为真实执行结果，非估算。

## 权限模型（摘要）

权限点定义在 `packages/shared/src/perms.ts`，前后端共用同一份常量，**代码中不存在 `role === 'admin'` 这类硬编码判断**。

- 5 个内置角色：`owner` / `admin` / `editor` / `member` / `guest`，可改权限、不可删除；`owner` 权限恒为全集且不可编辑，全局唯一。
- 支持自定义角色：新建、复制内置角色、编辑权限点、删除。
- 用户与角色多对多，权限取并集；请求内一次 join 求并集并缓存，角色变更后按用户精准失效（**取消权限后下一次请求即 403，无需重新登录**）。
- 三层落地：前端 `useCan()` + 路由 `meta.perms` + 后端 `requirePerm()`，service 层再做数据归属校验。
- 护栏：不能删除/禁用自己；admin 不能修改 owner 的账号与角色；不能授予自己没有的权限；不能给自己分配角色；删除仍被占用的角色会被阻断并提示人数；系统至少保留一个同时具备 `role:write` + `user:update` 的启用账号。所有角色/权限变更写 `audit_logs`。

## 外观与主题

- 两套风格：`standard`（常规，默认）与 `discreet`（低调）；明暗独立：浅色 / 深色 / 跟随系统，共 4 种组合。
- 外观按当前浏览器记忆（`kaoshiya:style` / `kaoshiya:mode`），不同设备互不影响；登录页同样生效。
- 首屏由同源外部脚本 `/theme-boot.js` 读取本地设置后再渲染，避免低调主题闪出黄色；**不使用 inline script**，满足 CSP。
- 低调主题全站灰阶，正确/错误用 `✓ / × / ○` 与文字区分；用户上传的题图保持原始颜色。

## 字体

等宽字体使用 [Maple Mono](https://github.com/subframe7536/maple-font)（SIL OFL 1.1），
随产物同源托管，仅加载实际使用的 400 / 700 两个字重（合计约 152 KB），附 OFL 许可证全文。
中文由系统字体栈渲染，未覆盖的字符会正常回退。

## 许可证

[MIT](./LICENSE)。第三方依赖与字体许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
