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
| `openai` | `gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-6.1-sol`、`gpt-reserve`、`codex-auto-review` |
| `openai-codex` | `gpt-5.4`、`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-6.1-sol`、`gpt-reserve`、`codex-auto-review` |

模型还必须使用 `openai-responses` 或 `openai-codex-responses` API。其他 Provider、API 和模型请求不会被修改。

此列表覆盖 2026-09-30 核对的 Codex 目录中全部通过 `service_tiers: [{ "id": "priority" }]` 标记支持 Fast 的模型，同时保留 GPT-5.4 的兼容支持。`gpt-reserve` 和 `codex-auto-review` 是隐藏目录条目：扩展不会向 Pi 模型选择器添加模型，使用前需要账户具备权限且模型已在 Pi 中注册。

Priority 服务层最终是否可用由 OpenAI 决定，不同模型、接口或账户可能有所差异。未列入白名单的模型不会仅因使用 Responses API 就自动启用 Priority。

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

配置结构（此示例将 Fast Mode 限定为 GPT-6.1 Sol）：

```json
{
  "enabled": false,
  "models": [
    "openai/gpt-6.1-sol",
    "openai-codex/gpt-6.1-sol"
  ],
  "showStatus": true
}
```

- `enabled`：持久化的 Fast Mode 开关状态。
- `models`：允许使用 Priority 服务层的精确 `provider/model-id` 列表。省略时使用当前默认白名单；显式填写数组时会替换默认列表。
- `showStatus`：开启且当前模型符合条件时显示 `[fast mode]`。

只有在确认模型 API 接受 `service_tier: "priority"` 后，才应将其加入白名单。

### 升级以支持最新模型（1.2.0）

更新通过 GitHub 安装的扩展：

```bash
pi update git:github.com/dingdinglz/pi-gpt-fast-extension
```

如果已有的 `fast-mode.json` 包含 `models` 数组，请删除该字段以使用当前完整默认白名单，或在 `openai/` 和 `openai-codex/` 两个前缀下补充需要的模型：

- `gpt-6-sol`
- `gpt-6-luna`
- `gpt-6.1-sol`
- `gpt-reserve`
- `codex-auto-review`

扩展不会自动扩大已保存的白名单，以保留自定义限制。保留现有的 `enabled` 和 `showStatus` 值。完整列表见 [`fast-mode.example.json`](fast-mode.example.json)。

然后执行 `/reload` 和 `/fast status`。如果 Fast Mode 尚未开启，再执行 `/fast on`。

**已有会话注意：** 对所有仍在运行 1.1.0 或更早版本扩展的 Pi 进程，务必先执行 `/reload` 或重启，**再使用 `/fast on`、`/fast off` 或 `/fast`**。旧实例可能把缓存的旧白名单写回，覆盖更新后的配置。清空对话不会重新加载扩展代码。如果旧列表已经被写回，请按上文重新补齐模型条目。

从 1.1.1 起，切换开关前会读取最新配置；`/fast status` 也会刷新配置，但不会写入文件，避免覆盖会话启动后修改的白名单和显示设置。

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

此前已在 `@earendil-works/pi-coding-agent` 0.84.4 和 0.85.1 上测试。1.2.0 另在 0.99.1 上通过真实 SDK、扩展加载器和两种 Responses API 验证了全部 22 个 Provider/模型组合，使用本地模拟接口，包含 Codex SSE 的 zstd 压缩请求。这些测试验证请求序列化，不验证 OpenAI 线上 Priority 服务层是否可用。

## 开发

使用 Node.js 22.18+ 运行回归测试，无需安装依赖或配置 API 凭据：

```bash
npm test
```

81 项回归测试使用隔离的临时配置，并模拟 Pi 扩展 API。可选的 SDK 集成测试默认跳过；将 `PI_TEST_PACKAGE_ROOT` 指向已安装的 Pi 0.99.1+ 包即可运行：

```bash
PI_TEST_PACKAGE_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" npm test
```

集成测试覆盖白名单中的全部模型及两种 API，验证 `/fast on`、`/fast off` 和推理强度保持不变，使用本地 HTTP 接口和模拟凭据。两套测试都不会请求 OpenAI 或读取你的真实配置。

## 参考资料

- [Pi 扩展文档](https://pi.dev/docs/latest/extensions)
- [`@pi-plugins/fast-mode`](https://github.com/k3dom/pi-plugins/tree/main/plugins/fast-mode)
- [Pi issue #4643：Support OpenAI Codex Fast mode](https://github.com/earendil-works/pi/issues/4643)

## 许可证

[MIT](LICENSE)
