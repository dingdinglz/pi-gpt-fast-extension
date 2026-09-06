import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "gpt-fast-mode";
const CONFIG_PATH = join(getAgentDir(), "extensions", "fast-mode.json");
const COMMAND_ARGS = ["on", "off", "status"] as const;

interface FastModeConfig {
	enabled: boolean;
	models: string[];
	showStatus: boolean;
}

const DEFAULT_CONFIG: FastModeConfig = {
	enabled: false,
	models: [
		"openai/gpt-5.4",
		"openai/gpt-5.5",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"openai/gpt-5.6-luna",
		"openai/gpt-6-astra",
		"openai-codex/gpt-5.4",
		"openai-codex/gpt-5.5",
		"openai-codex/gpt-5.6-sol",
		"openai-codex/gpt-5.6-terra",
		"openai-codex/gpt-5.6-luna",
		"openai-codex/gpt-6-astra",
	],
	showStatus: true,
};

type ActiveModel = NonNullable<ExtensionContext["model"]>;

type Eligibility =
	| { eligible: true; key: string }
	| { eligible: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelKey(model: ActiveModel): string {
	return `${model.provider}/${model.id}`;
}

function readBoolean(
	value: unknown,
	name: keyof Pick<FastModeConfig, "enabled" | "showStatus">,
	fallback: boolean,
): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") {
		throw new Error(`"${name}" must be a boolean`);
	}
	return value;
}

function loadConfig(ctx: ExtensionContext): FastModeConfig {
	if (!existsSync(CONFIG_PATH)) {
		return { ...DEFAULT_CONFIG, models: [...DEFAULT_CONFIG.models] };
	}

	try {
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		if (!isRecord(parsed)) throw new Error("the root value must be an object");

		let models = DEFAULT_CONFIG.models;
		if (parsed.models !== undefined) {
			if (
				!Array.isArray(parsed.models) ||
				!parsed.models.every((model) => typeof model === "string")
			) {
				throw new Error('"models" must be an array of strings');
			}
			models = parsed.models;
		}

		return {
			enabled: readBoolean(parsed.enabled, "enabled", DEFAULT_CONFIG.enabled),
			models: [...models],
			showStatus: readBoolean(
				parsed.showStatus,
				"showStatus",
				DEFAULT_CONFIG.showStatus,
			),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(
				`Ignoring invalid fast-mode config at ${CONFIG_PATH}: ${message}`,
				"warning",
			);
		}
		return { ...DEFAULT_CONFIG, models: [...DEFAULT_CONFIG.models] };
	}
}

function saveConfig(config: FastModeConfig, ctx: ExtensionContext): boolean {
	const temporaryPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;

	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, CONFIG_PATH);
		return true;
	} catch (error) {
		try {
			if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
		} catch {
			// Best-effort cleanup only.
		}

		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(`Could not persist fast-mode state: ${message}`, "error");
		}
		return false;
	}
}

function checkEligibility(
	model: ExtensionContext["model"],
	config: FastModeConfig,
): Eligibility {
	if (!model) return { eligible: false, reason: "no model is selected" };

	const key = modelKey(model);
	if (!config.models.includes(key)) {
		return {
			eligible: false,
			reason: `${key} is not listed in ${CONFIG_PATH}`,
		};
	}

	const supportedApi =
		(model.provider === "openai" && model.api === "openai-responses") ||
		(model.provider === "openai-codex" &&
			model.api === "openai-codex-responses");

	if (!supportedApi) {
		return {
			eligible: false,
			reason: `${key} uses unsupported API ${model.api}`,
		};
	}

	return { eligible: true, key };
}

export default function gptFastMode(pi: ExtensionAPI) {
	let config: FastModeConfig = {
		...DEFAULT_CONFIG,
		models: [...DEFAULT_CONFIG.models],
	};
	let enabled = false;

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const eligibility = checkEligibility(ctx.model, config);
		const active = config.showStatus && enabled && eligibility.eligible;
		ctx.ui.setStatus(
			EXTENSION_ID,
			active ? ctx.ui.theme.fg("dim", "[fast mode]") : undefined,
		);
	}

	function persistEnabled(change: boolean | "toggle", ctx: ExtensionContext): boolean {
		// An upgrade or another session may have changed the config since startup.
		// Never overwrite its allowlist or UI settings with our cached copy.
		const latestConfig = loadConfig(ctx);
		const nextEnabled = change === "toggle" ? !latestConfig.enabled : change;
		const nextConfig: FastModeConfig = {
			...latestConfig,
			enabled: nextEnabled,
			models: [...latestConfig.models],
		};
		if (!saveConfig(nextConfig, ctx)) return false;

		config = nextConfig;
		enabled = nextEnabled;
		return true;
	}

	function notifyState(ctx: ExtensionContext): void {
		const eligibility = checkEligibility(ctx.model, config);
		if (!enabled) {
			ctx.ui.notify("Fast mode is off.", "info");
			return;
		}
		if (eligibility.eligible) {
			ctx.ui.notify(
				`Fast mode is on for ${eligibility.key}; requests use service_tier=priority (higher cost).`,
				"info",
			);
			return;
		}
		ctx.ui.notify(`Fast mode is on but inactive: ${eligibility.reason}.`, "warning");
	}

	pi.registerFlag("fast", {
		description: "Enable and persist GPT fast mode (priority tier; higher cost)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("fast", {
		description: "Toggle and persist GPT fast mode (priority tier; higher cost)",
		getArgumentCompletions: (prefix) => {
			const matches = COMMAND_ARGS.filter((arg) => arg.startsWith(prefix)).map(
				(arg) => ({ value: arg, label: arg }),
			);
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command === "status") {
				config = loadConfig(ctx);
				enabled = config.enabled;
				updateStatus(ctx);
				notifyState(ctx);
				return;
			}
			let nextEnabled: boolean | "toggle";
			if (command === "") nextEnabled = "toggle";
			else if (command === "on") nextEnabled = true;
			else if (command === "off") nextEnabled = false;
			else {
				ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
				return;
			}

			if (!persistEnabled(nextEnabled, ctx)) return;
			updateStatus(ctx);
			notifyState(ctx);
		},
	});

	pi.on("session_start", (event, ctx) => {
		config = loadConfig(ctx);
		enabled = config.enabled;

		// Treat --fast as a persistent enable on initial process startup. Do not
		// re-apply it after /fast off when this process later reloads or switches
		// sessions.
		if (
			event.reason === "startup" &&
			pi.getFlag("fast") === true &&
			!enabled &&
			!persistEnabled(true, ctx)
		) {
			enabled = true;
		}

		updateStatus(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!enabled || !ctx.model || !isRecord(event.payload)) return undefined;

		const eligibility = checkEligibility(ctx.model, config);
		if (!eligibility.eligible) return undefined;
		if (event.payload.model !== ctx.model.id) return undefined;

		// Respect a service tier explicitly supplied by the user or provider.
		if ("service_tier" in event.payload) return undefined;

		return { ...event.payload, service_tier: "priority" };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(EXTENSION_ID, undefined);
	});
}
