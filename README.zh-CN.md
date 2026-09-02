# Pi GPT Fast Mode 扩展

[English](README.md) | 简体中文

一个用于 [Pi coding agent](https://pi.dev/) 的全局扩展，通过请求 OpenAI 的 `priority` 服务层来启用 GPT Fast Mode。开关状态会持久化，因此切换 Session、执行 `/new`、`/resume`、`/reload` 或重启 Pi 后仍会保留。

> [!WARNING]
> Priority 服务层可能产生更高费用，或更快消耗账户额度。启用前请查看 OpenAI 的最新定价以及你的账户权限。

## 功能

- 提供 `/fast on`、`/fast off`、`/fast` 和 `/fast status` 命令
- 在 `~/.pi/agent/extensions/fast-mode.json` 中持久化全局状态
- 提供 `--fast` CLI 参数，启动时启用并持久化 Fast Mode
- 同时支持 `openai` 和 `openai-codex` Responses API
- 使用精确的模型白名单，避免修改不支持的模型请求
- 当前模型符合条件时显示 `[fast mode]` 状态
- 如果请求中已有 `service_tier`，不会覆盖
- 无运行时依赖

## 安装

从 GitHub 全局安装：

```bash
pi install git:github.com/dingdinglz/pi-gpt-fast-extension
```

然后重启 Pi，或者在已有 Pi 会话中执行 `/reload`。

只临时试用一次、不写入安装配置：

```bash
pi -e git:github.com/dingdinglz/pi-gpt-fast-extension
```

## 使用方法

```text
/fast          # 切换 Fast Mode，并持久化新状态
/fast on       # 开启并持久化
/fast off      # 关闭并持久化
/fast status   # 查看 Fast Mode 对当前模型是否生效
```

启动 Pi 时开启并持久化 Fast Mode：

```bash
pi --fast
```

Fast Mode 已开启且当前模型符合条件时，扩展会在发送 Provider 请求前加入：

```json
{
  "service_tier": "priority"
}
```

Fast Mode 是服务层设置，与 Pi 的 reasoning/thinking level（推理强度）相互独立。

## 支持的模型

默认白名单包含：

| Provider | 模型 |
| --- | --- |
| `openai` | `gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` |
| `openai-codex` | `gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` |

模型还必须使用 `openai-responses` 或 `openai-codex-responses` API。其他 Provider、API 和模型请求不会被修改。

Priority 服务层最终是否可用由 OpenAI 决定，不同模型或账户可能有所差异。

## 配置

扩展会读取和写入：

```text
~/.pi/agent/extensions/fast-mode.json
```

首次切换状态后会自动创建该文件。也可以将 [`fast-mode.example.json`](fast-mode.example.json) 复制到上述位置进行预配置：

```bash
mkdir -p ~/.pi/agent/extensions
curl -fsSL \
  https://raw.githubusercontent.com/dingdinglz/pi-gpt-fast-extension/main/fast-mode.example.json \
  -o ~/.pi/agent/extensions/fast-mode.json
```

配置结构：

```json
{
  "enabled": false,
  "models": [
    "openai/gpt-5.5",
    "openai-codex/gpt-5.5"
  ],
  "showStatus": true
}
```

- `enabled`：持久化的 Fast Mode 开关状态。
- `models`：允许使用 Priority 服务层的精确 `provider/model-id` 列表。
- `showStatus`：开启且当前模型符合条件时显示 `[fast mode]`。

只有在确认模型 API 接受 `service_tier: "priority"` 后，才应将其加入白名单。

## 安全行为

只有同时满足以下条件时，扩展才会修改请求：

1. Fast Mode 已开启。
2. 当前 `provider/model-id` 位于配置白名单中。
3. 模型使用受支持的 Responses API。
4. Payload 中的模型与 Pi 当前模型一致。
5. Payload 中尚未包含 `service_tier`。

状态更新通过临时文件进行原子写入。

## 卸载

```bash
pi remove git:github.com/dingdinglz/pi-gpt-fast-extension
```

持久化配置会保留。如不再需要，可单独删除：

```bash
rm ~/.pi/agent/extensions/fast-mode.json
```

## 兼容性

已在 `@earendil-works/pi-coding-agent` 0.84.4 上测试。

## 参考资料

- [Pi 扩展文档](https://pi.dev/docs/latest/extensions)
- [`@pi-plugins/fast-mode`](https://github.com/k3dom/pi-plugins/tree/main/plugins/fast-mode)
- [Pi issue #4643：Support OpenAI Codex Fast mode](https://github.com/earendil-works/pi/issues/4643)

## 许可证

[MIT](LICENSE)
