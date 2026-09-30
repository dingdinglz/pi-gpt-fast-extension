# Pi GPT Fast Mode Extension

English | [简体中文](README.zh-CN.md)

A global [Pi coding agent](https://pi.dev/) extension that enables OpenAI's GPT fast mode by requesting the `priority` service tier. The selected state is persisted, so it survives session switches, `/new`, `/resume`, `/reload`, and Pi restarts.

> [!WARNING]
> The priority service tier can cost more or consume account limits faster. Check OpenAI's current pricing and your account entitlements before enabling it.

## Features

- `/fast on`, `/fast off`, `/fast`, and `/fast status` commands
- Persistent global state in `~/.pi/agent/extensions/fast-mode.json`
- `--fast` CLI flag that enables and persists fast mode on startup
- Support for both `openai` and `openai-codex` Responses APIs
- Exact per-model allowlist to avoid modifying unsupported models
- A `[fast mode]` status indicator while the current model is eligible
- Leaves an existing `service_tier` value untouched
- No runtime dependencies

## Installation

Install globally from GitHub:

```bash
pi install git:github.com/dingdinglz/pi-gpt-fast-extension
```

Then restart Pi, or run `/reload` in an existing Pi session.

To try it for one run without installing:

```bash
pi -e git:github.com/dingdinglz/pi-gpt-fast-extension
```

## Usage

```text
/fast          # Toggle fast mode and persist the new state
/fast on       # Enable and persist
/fast off      # Disable and persist
/fast status   # Show whether fast mode is active for the current model
```

Start Pi with fast mode enabled and persisted:

```bash
pi --fast
```

When fast mode is enabled and the active model is eligible, the extension adds this field immediately before the provider request is sent:

```json
{
  "service_tier": "priority"
}
```

Fast mode is a service-tier setting and is independent of Pi's reasoning/thinking level.

## Supported Models

The default allowlist contains:

| Provider | Models |
| --- | --- |
| `openai` | `gpt-5.4`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-reserve`, `codex-auto-review` |
| `openai-codex` | `gpt-5.4`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-reserve`, `codex-auto-review` |

The API must also be `openai-responses` or `openai-codex-responses`. Other providers, APIs, and models are left unchanged.

This list covers every model advertising `service_tiers: [{ "id": "priority" }]` in the Codex catalog checked on 2026-09-30, plus legacy GPT-5.4 support. `gpt-reserve` and `codex-auto-review` are hidden catalog entries: the extension does not add models to Pi's model picker, and they must already be available to your account and registered in Pi.

Availability of the priority tier is ultimately controlled by OpenAI and may vary by model, endpoint, or account. An unlisted model is not automatically eligible just because it uses a Responses API.

## Configuration

The extension reads and writes:

```text
~/.pi/agent/extensions/fast-mode.json
```

The file is created automatically after the first state change. To preconfigure it, copy [`fast-mode.example.json`](fast-mode.example.json) to that location:

```bash
mkdir -p ~/.pi/agent/extensions
curl -fsSL \
  https://raw.githubusercontent.com/dingdinglz/pi-gpt-fast-extension/main/fast-mode.example.json \
  -o ~/.pi/agent/extensions/fast-mode.json
```

Configuration shape (this example restricts fast mode to GPT-6.1 Sol):

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

- `enabled`: persisted fast-mode state.
- `models`: exact `provider/model-id` entries that may receive the priority tier. When omitted, the current default allowlist is used; an explicit array replaces the defaults.
- `showStatus`: show `[fast mode]` when enabled and eligible.

Only add a model after confirming that its API accepts `service_tier: "priority"`.

### Upgrading to the latest models (1.2.0)

Update a GitHub installation:

```bash
pi update git:github.com/dingdinglz/pi-gpt-fast-extension
```

If your existing `fast-mode.json` contains a `models` array, remove that field to use the complete current defaults, or add the models you want under both `openai/` and `openai-codex/`:

- `gpt-6-sol`
- `gpt-6-luna`
- `gpt-6.1-sol`
- `gpt-reserve`
- `codex-auto-review`

Saved allowlists are not automatically expanded, so custom restrictions remain intact. Keep your existing `enabled` and `showStatus` values. The complete list is in [`fast-mode.example.json`](fast-mode.example.json).

Then run `/reload` and `/fast status`. Use `/fast on` if fast mode is off.

**Already-running sessions:** Reload or restart every Pi process using version 1.1.0 or earlier **before running `/fast on`, `/fast off`, or `/fast`**. Those older instances can overwrite an updated allowlist with their cached configuration. Clearing the conversation does not reload extension code. If the old list was already written back, restore the missing entries as described above.

Starting with 1.1.1, state-changing commands read the latest configuration before saving, and `/fast status` refreshes the configuration without writing it. This preserves allowlist and UI-setting edits made since the session started.

## Safety Behavior

A request is modified only when all of the following are true:

1. Fast mode is enabled.
2. The current `provider/model-id` is in the configured allowlist.
3. The model uses a supported Responses API.
4. The payload's model matches the active Pi model.
5. The payload does not already contain `service_tier`.

State updates are written atomically through a temporary file.

## Uninstall

```bash
pi remove git:github.com/dingdinglz/pi-gpt-fast-extension
```

The persisted configuration is intentionally left in place. Remove it separately if desired:

```bash
rm ~/.pi/agent/extensions/fast-mode.json
```

## Compatibility

Previously tested with `@earendil-works/pi-coding-agent` 0.84.4 and 0.85.1. Version 1.2.0 is also tested on 0.99.1: all 22 provider/model combinations were verified through the real SDK, extension loader, and both Responses APIs against local mock endpoints, including zstd-compressed Codex SSE requests. These tests verify request serialization, not live OpenAI priority-tier availability.

## Development

Run the regression tests with Node.js 22.18+ (no dependency installation or API credentials required):

```bash
npm test
```

The 81 regression tests use isolated temporary configuration and mock Pi's extension API. The optional SDK integration suite is skipped unless `PI_TEST_PACKAGE_ROOT` points to an installed Pi 0.99.1+ package:

```bash
PI_TEST_PACKAGE_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" npm test
```

The integration suite verifies every allowlisted model on both APIs, `/fast on`, `/fast off`, and preservation of the reasoning level. It uses local HTTP endpoints and synthetic credentials. Neither suite contacts OpenAI or reads your real configuration.

## References

- [Pi extension documentation](https://pi.dev/docs/latest/extensions)
- [`@pi-plugins/fast-mode`](https://github.com/k3dom/pi-plugins/tree/main/plugins/fast-mode)
- [Pi issue #4643: Support OpenAI Codex Fast mode](https://github.com/earendil-works/pi/issues/4643)

## License

[MIT](LICENSE)
