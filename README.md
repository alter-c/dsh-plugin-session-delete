<div align="center">

# dsh-plugin-session-delete · 删除会话

**为 DeepSeek Harness 补齐「删除会话」能力——从侧边栏永久删除一个会话，并清理它留在磁盘上的所有专属文件。**

[English](README_EN.md) · 中文

[![version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](#许可证)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![github](https://img.shields.io/badge/github-alter--c%2Fdsh--plugin--session--delete-181717?logo=github)](https://github.com/alter-c/dsh-plugin-session-delete)

</div>

---

> [!WARNING]
> 删除**不可逆**。确认后，会话及其日志、投影缓存和被引用的附件会从磁盘上被永久移除，无法恢复。

## 简介

DeepSeek Harness（DSH）只提供了「归档会话」，可以把会话从列表里隐藏起来，但它的日志文件会永远留在磁盘上。本插件补齐「删除」功能，面向「一个会话对应一个任务」的使用习惯：

- 在会话的 `…` 菜单里、「归档会话」正下方加入一个带分隔线和危险色的「删除会话」入口；
- 点击后弹出一个对齐「删除工作区」样式的确认弹窗；
- 确认后，会话从侧边栏列表移除，它的日志、投影缓存以及被它引用的附件一并删除。

## 功能特性

- **入口位置自然**：注册在会话 `…` 菜单中，位于官方「归档」下方，自带分隔线与危险色图标。
- **确认弹窗**：复用官方 `Modal` / `Button` 组件，视觉与「删除工作区」对齐，含危险色确认按钮、进行中状态与错误提示。
- **安全停止**：删除运行中的会话前，先复用官方的停止机制（`archiveSession({ stopActivity: true })`），避免脏状态。
- **彻底清理**：删除会话日志、投影缓存及其引用的附件，并清空所有工作区中的记账引用。
- **路径逃逸防护**：所有待删除路径在写入文件系统前都经过会话 ID 校验与根目录包含性检查。
- **容错反馈**：删除过程中的各步骤失败会被收集为 `warnings` 返回给客户端，而非直接中断。
- **零宿主依赖**：宿主端仅使用 Node.js 内置模块，无需第三方依赖即可安装。

## 安装

DSH 的插件页（侧栏 **插件** → **添加插件**）接受包名、Git 地址、压缩包和本地绝对路径，因此本插件有三种装法。

### 从 GitHub 安装（推荐）

```text
github:alter-c/dsh-plugin-session-delete
```

DSH 会把仓库拉下来，并按本包 `files` 字段自动打包安装，**不需要手动打包**。

两点需要知道：

- **不会自动更新**。git 依赖在安装时被解析成具体 commit，仓库有了新提交后，要**先卸载再重新安装**才会生效（DSH 暂不支持插件自动更新）；
- **私有部署或 GitHub 访问受限**时，可改用 SSH 形式，让本机 SSH key 直接生效：

  ```text
  git+ssh://git@github.com/alter-c/dsh-plugin-session-delete.git
  ```

  > 不要直接粘贴 GitHub 页面上那个 `git@github.com:alter-c/dsh-plugin-session-delete.git`（scp 简写）。DSH 的安装界面接受它，但 pnpm 的解析器不认，会报 `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`——必须带上 `git+ssh://` 协议前缀。

### 本地源码安装（开发用）

把插件目录以软链方式装进 profile，源码即运行代码，改完不用打包、也不用重新安装：

```text
link:D:/Code/project/deepseek harness plugin/dsh-plugin-session-delete
```

这是开发态，请注意：

- 宿主端改动需要重新加载插件才生效（在插件页把 `session-delete` 这一行关掉再打开，或重启 DSH），浏览器端改动可能还需要刷新页面；
- 在 Windows 上卸载时可能残留 junction。

### 以 tarball 安装（离线 / 内网）

在插件页填入打包产物路径：

```text
D:/Code/project/deepseek harness plugin/dsh-plugin-session-delete-0.1.0.tgz
```

tarball 是打包时的快照，每次修改源码后都需要重新打包并重装。

## 使用

1. 打开 DSH 侧边栏，找到目标会话；
2. 点击该会话右侧的 `…` 菜单；
3. 选择「归档会话」下方的 **删除会话**；
4. 在弹出的确认框中点击 **删除会话** 确认（点击「取消」不会产生任何变更）。

若目标会话正在运行，插件会先将其安全停止，再执行删除。

## 工作原理

### 架构

插件由宿主端与浏览器端两部分组成，通过一条已认证的 Fetch 路由打通：

| 部分 | 文件 | 运行环境 | 职责 |
| --- | --- | --- | --- |
| 宿主端 | `lib/index.js` | DSH 主进程（Node.js） | 真正的删除逻辑 + HTTP 路由 |
| 浏览器端 | `lib/client.js` | 浏览器 | 菜单项 + 确认弹窗 |

浏览器端注册两个插槽：

- `sidebar.workspaces.session.menu.item`（id `session-delete.delete`，order `500`）：渲染「删除会话」菜单项；
- `shell.overlay`（id `session-delete.confirm`）：渲染确认弹窗。

### 删除流程

一次删除按以下顺序执行：

1. **读取会话头部**：通过 `sessionPersistence.stat` 取得会话的 `cwd`，用于推导日志所在的工程目录。
2. **停止运行中的工作**：调用 `workspaceRegistry.archiveSession(sessionId, { stopActivity: true })`，复用官方停止机制。
3. **枚举附件引用**：在日志被删除前，读取会话已提交事件，收集其引用的图片/文件附件。
4. **删除落盘文件**：依次删除会话日志目录、投影缓存和附件对象，每一步都带路径逃逸校验。
5. **清理记账引用**：遍历所有工作区，调用 `detachSession` / `unarchiveSession` / `unpinSession`，避免残留指向已删会话的空引用。
6. **刷新视图**：发出 `api-session/removed`，让浏览器端把该行从侧边栏移除。

### 会删除哪些文件

其中 `$DSH_HOME` 为环境变量，缺省为 `~/.dsh`。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 会话日志 | `$DSH_HOME/sessions/<projectKey>/<id>/session.v4.jsonl.zstd` | 会话事件的 JSONL 主记录（zstd 压缩） |
| 投影缓存 | `$DSH_HOME/storages/session_projcache/sessions/<id>.json`（含 `.bak.*`） | 会话的投影缓存文档 |
| 图片附件 | `$DSH_HOME/attachments/v1/objects/<2-hex>/<digest>` | 会话引用的图片对象 |
| 文件附件 | `$DSH_HOME/attachments/v1/files/<2-hex>/<digest>/` 与 `file-objects/<2-hex>/<digest>` | 会话引用的文件对象（别名目录 + 本体） |

### 有意保留或无需清理

- **请求图片缓存**（`~/.dsh/cache/attachments/`）：可再生的派生缓存，有意保留。
- **搜索索引**：以内存挂载（`:memory:`），无需清理。

## HTTP API

插件通过 `connection.fetch.register` 注册一条已认证的路由：

```text
POST /api/session.delete
```

**请求体**

```json
{ "sessionId": "<会话 ID>" }
```

**响应**

| 状态码 | 场景 | 响应体 |
| --- | --- | --- |
| `200` | 删除成功 | `{ "ok": true, "sessionId", "removed": [...], "warnings": [...], "formatVersion": 4 }` |
| `404` | 会话不存在 | `{ "ok": false, "sessionId", "error": "session-not-found", ... }` |
| `400` | 请求体非法 / 会话 ID 非法 | `{ "ok": false, "error": "invalid-json" \| "invalid-session-id" }` |
| `405` | 非 POST 方法 | `{ "ok": false, "error": "method-not-allowed" }` |
| `500` | 处理异常 | `{ "ok": false, "sessionId", "error": "<message>" }` |

## 安全与边界

- **会话 ID 校验**：仅接受非空、长度 ≤ 512、非 `.` / `..`、不含路径分隔符与空字节的 ID（`isSafeSessionId`）。
- **路径逃逸防护**：所有待删除路径必须落在预期的根目录（会话根 / 存储根 / 附件根）内（`isInside`），畸形 ID 无法越界删除。
- **无跨会话引用计数**：附件是内容寻址且可在会话间共享（例如 fork 出的子会话）。本插件按设计**不做引用计数**，附件随会话一并删除——若同一附件被其它会话引用，它仍会被删除。这是有意为之的语义，请确保它符合你的使用方式。
- **容错**：删除过程的各步骤失败会被收集为 `warnings` 返回，而不是直接抛出，便于客户端展示具体哪一步失败。

## 开发

### 前置要求

- Node.js ≥ 22
- DeepSeek Harness（需提供 `connection`、`sessionPersistence`、`workspaceRegistry` 等服务）

### 目录结构

```text
dsh-plugin-session-delete/
├── lib/
│   ├── index.js      # 宿主端：删除逻辑 + HTTP 路由
│   └── client.js     # 浏览器端：菜单项 + 确认弹窗
├── locale/
│   ├── zh.json       # 中文元信息（标题 / 描述）
│   └── en.json       # 英文元信息
├── cordis.patch.yml  # bundle 补丁：仅登记本插件
├── package.json      # 包清单（manifest）
├── README.md         # 中文文档
├── README_EN.md      # English documentation
└── .gitignore        # 忽略 node_modules 与打包产物
```

### 开发与发布

三种安装方式对应三条开发回路：

| 场景 | 做法 |
| --- | --- |
| 日常改代码 | 用上面的本地 `link:` 安装，改完重新加载插件即可，不用打包 |
| 发布新版本 | 提交并推送到 GitHub，使用者卸载后重新安装 `github:alter-c/dsh-plugin-session-delete` |
| 离线分发 | 双击插件文件夹旁的 `pack.cmd`，产物为 `dsh-plugin-session-delete-0.1.0.tgz` |

tarball 是打包时的快照，用它分发时每次改动后都需重新打包并在 DSH 中重装。

### 测试

核心删除逻辑（路径推导、完整删除流程、路由接线与入参校验、附件枚举）通过隔离 `$DSH_HOME` 与桩 Cordis 服务的自动化测试验证，共 23 项。测试文件未随 tarball 发布（见 `package.json` 的 `files` 字段）。

## 许可证

[MIT](package.json)

## 致谢

感谢 DeepSeek Harness 的插件体系与 `@deepseek-ai/dsh-session-log-export` 提供的附件枚举实现参考。
