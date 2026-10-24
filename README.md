<div align="center">

# dsh-plugin-session-delete · 删除会话

**为 DeepSeek Harness（DSH）添加「删除会话」功能，清理会话日志、投影缓存及其引用的附件。**

[English](README_EN.md) · 中文

[![version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)

</div>

---

> [!WARNING]
> 删除不可恢复。附件不做跨会话引用计数，同一附件即使被其他会话引用，也会被删除。

## 安装

需要 Node.js ≥ 22 和 DeepSeek Harness。在 DSH 侧栏 **插件 → 添加插件** 中填入：

```text
github:alter-c/dsh-plugin-session-delete
```

DSH 会自动拉取并打包。更新时需先卸载，再重新安装。

也支持本地源码或离线包安装（将示例路径替换为实际绝对路径）：

| 方式 | 填入内容 | 修改后生效方式 |
| --- | --- | --- |
| 本地源码 | `link:D:/path/to/dsh-plugin-session-delete` | 重新加载插件；浏览器端可能还需刷新页面 |
| 离线包 | `D:/path/to/dsh-plugin-session-delete-0.1.0.tgz` | 重新打包并重装 |

Windows 上卸载本地链接可能残留 junction。

## 使用

在侧边栏找到会话，打开 `…` 菜单，选择「归档会话」下方的 **删除会话**，在弹窗中确认。

插件会先尝试停止运行中的会话，再删除文件、清理所有工作区中的会话引用并刷新列表。各步骤的失败会汇总为 `warnings`，删除可能只完成一部分。

## 清理范围

`$DSH_HOME` 默认为 `~/.dsh`；会话日志和附件优先使用对应服务配置的根目录。

| 数据 | 默认位置（相对于 `$DSH_HOME`） |
| --- | --- |
| 会话日志目录 | `sessions/<projectKey>/<encodedId>/` |
| 投影缓存及备份 | `storages/session_projcache/sessions/<id>.json`、`.json.bak.*` |
| 引用的图片与文件附件 | `attachments/v1/` 下对应的 `objects/`、`files/`、`file-objects/` 对象 |

请求图片缓存（`cache/attachments/`）保留。会话 ID 和待删除路径均经过校验。

## 开发

- `lib/index.js`：宿主端删除逻辑与已认证的 HTTP 路由，仅使用 Node.js 内置模块。
- `lib/client.js`：浏览器端菜单项与确认弹窗。
- `locale/`：中英文元信息。

使用本地 `link:` 安装后，关闭再开启插件或重启 DSH 即可重新加载。离线分发时，在项目目录运行 `npm pack` 生成 `.tgz`。

### HTTP API

```http
POST /api/session.delete
Content-Type: application/json

{"sessionId":"<会话 ID>"}
```

响应包含 `ok`、`sessionId`、`removed`、`warnings` 和 `formatVersion`。状态码：`200` 找到会话并完成处理（可能含警告）、`400` 请求非法、`404` 会话不存在、`405` 方法不支持、`500` 处理异常；错误响应包含 `error`。

## 致谢

感谢 DeepSeek Harness 的插件体系与 `@deepseek-ai/dsh-session-log-export` 提供的附件枚举实现参考。
