import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

// Only getAgentDir is imported at runtime. Keep tests independent of an installed
// Pi package and never read or write the user's real fast-mode configuration.
const agentDir = mkdtempSync(join(tmpdir(), "pi-gpt-fast-test-"));
const configPath = join(agentDir, "extensions", "fast-mode.json");
mkdirSync(join(agentDir, "extensions"));
after(() => rmSync(agentDir, { recursive: true, force: true }));
beforeEach(() => rmSync(configPath, { force: true }));

const stubUrl = `data:text/javascript,${encodeURIComponent(
	`export const getAgentDir = () => ${JSON.stringify(agentDir)};`,
)}`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-coding-agent") {
			return { url: stubUrl, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
let gptFastMode;
try {
	({ default: gptFastMode } = await import("../extensions/gpt-fast-mode.ts"));
} finally {
	hooks.deregister();
}

const exampleConfig = JSON.parse(
	readFileSync(new URL("../fast-mode.example.json", import.meta.url), "utf8"),
);
const endpoints = [
	{ provider: "openai", api: "openai-responses" },
	{ provider: "openai-codex", api: "openai-codex-responses" },
];
// Independent expectations: every priority-capable model in the 2026-09-30
// Codex catalog, plus GPT-5.4 for backwards compatibility.
const modelIds = [
	"gpt-5.4",
	"gpt-5.5",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-6-astra",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-6.1-sol",
	"gpt-reserve",
	"codex-auto-review",
];
const newModelIds = modelIds.slice(6);
const legacyModels = endpoints.flatMap(({ provider }) =>
	modelIds.slice(0, 6).map((id) => `${provider}/${id}`),
);

function saveConfig(config) {
	writeFileSync(configPath, JSON.stringify(config));
}

function readConfig() {
	return JSON.parse(readFileSync(configPath, "utf8"));
}

function createHarness({
	provider = "openai-codex",
	api = "openai-codex-responses",
	id = "gpt-6-astra",
	fast = false,
	hasUI = true,
} = {}) {
	const handlers = new Map();
	const commands = new Map();
	const statuses = new Map();
	const notifications = [];
	const ctx = {
		model: { provider, api, id },
		hasUI,
		ui: {
			theme: { fg: (_color, text) => text },
			setStatus(name, value) {
				assert.ok(hasUI, "headless hooks must not update the UI");
				if (value === undefined) statuses.delete(name);
				else statuses.set(name, value);
			},
			notify(message, level) {
				notifications.push({ message, level });
			},
		},
	};
	gptFastMode({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		registerFlag: () => {},
		getFlag: (name) => (name === "fast" ? fast : undefined),
	});
	const emit = (type, event = {}) => handlers.get(type)({ type, ...event }, ctx);
	emit("session_start", { reason: "startup" });
	return {
		ctx,
		emit,
		statuses,
		notifications,
		command: (args) => commands.get("fast").handler(args, ctx),
		request: (payload = { model: id }) => emit("before_provider_request", { payload }),
	};
}

test("the example allowlist contains every supported model for both providers exactly once", () => {
	assert.deepEqual(exampleConfig.models, endpoints.flatMap(({ provider }) =>
		modelIds.map((id) => `${provider}/${id}`),
	));
	assert.equal(new Set(exampleConfig.models).size, exampleConfig.models.length);
});

for (const endpoint of endpoints) {
	for (const id of modelIds) {
		test(`defaults and /fast on work for ${endpoint.provider}/${id}`, async () => {
			const h = createHarness({ ...endpoint, id });
			assert.equal(h.request(), undefined);
			assert.equal(h.statuses.size, 0);

			await h.command("on");
			const payload = { model: id, input: [], reasoning: { effort: "high" } };
			const result = h.request(payload);
			assert.deepEqual(result, { ...payload, service_tier: "priority" });
			assert.notEqual(result, payload);
			assert.equal("service_tier" in payload, false);
			assert.deepEqual(readConfig(), { ...exampleConfig, enabled: true });
			assert.equal(h.statuses.get("gpt-fast-mode"), "[fast mode]");

			await h.command("status");
			assert.ok(h.notifications.at(-1).message.includes(`${endpoint.provider}/${id};`));
			assert.match(h.notifications.at(-1).message, /requests use service_tier=priority/);
			assert.equal(h.notifications.at(-1).level, "info");
		});

		test(`saved configuration works for ${endpoint.provider}/${id}`, () => {
			saveConfig({ ...exampleConfig, enabled: true });
			assert.equal(createHarness({ ...endpoint, id }).request().service_tier, "priority");
		});
	}

	for (const id of newModelIds) {
		test(`does not silently expand a legacy allowlist for ${endpoint.provider}/${id}`, async () => {
			saveConfig({ enabled: true, models: legacyModels });
			const h = createHarness({ ...endpoint, id });
			assert.equal(h.request(), undefined);
			assert.equal(h.statuses.size, 0);
			await h.command("on");
			assert.deepEqual(readConfig().models, legacyModels);
			assert.equal(h.request(), undefined);
		});
	}
}

for (const models of [[], ["openai-codex/gpt-5.5"], exampleConfig.models.filter((key) => !key.endsWith("/gpt-6-astra"))]) {
	test(`preserves an explicit allowlist with ${models.length} entries`, async () => {
		saveConfig({ enabled: true, models });
		const h = createHarness();
		assert.equal(h.request(), undefined);
		assert.equal(h.statuses.size, 0);
		await h.command("status");
		assert.match(h.notifications.at(-1).message, /on but inactive/);
		await h.command("on");
		assert.deepEqual(readConfig().models, models);
	});
}

for (const command of ["on", "off", ""]) {
	test(`/fast ${command || "(toggle)"} preserves configuration changed after startup`, async () => {
		const legacyModels = exampleConfig.models.filter((key) => !key.endsWith("/gpt-6-astra"));
		saveConfig({ enabled: true, models: legacyModels, showStatus: true });
		const h = createHarness();
		assert.equal(h.request(), undefined);

		// Simulate updating the allowlist while an older session is still open.
		const updated = { ...exampleConfig, enabled: true, showStatus: false };
		saveConfig(updated);
		await h.command(command);
		assert.deepEqual(readConfig(), { ...updated, enabled: command === "on" });
		assert.equal(h.request()?.service_tier, command === "on" ? "priority" : undefined);
		assert.equal(h.statuses.size, 0);
	});
}

test("/fast status refreshes a changed allowlist without writing the configuration", async () => {
	saveConfig({ enabled: true, models: ["openai-codex/gpt-5.5"] });
	const h = createHarness();
	const updated = { ...exampleConfig, enabled: true };
	saveConfig(updated);
	const before = readFileSync(configPath, "utf8");
	await h.command("status");
	assert.equal(readFileSync(configPath, "utf8"), before);
	assert.equal(h.notifications.at(-1).level, "info");
	assert.match(h.notifications.at(-1).message, /gpt-6-astra; requests use service_tier=priority/);
	assert.equal(h.statuses.get("gpt-fast-mode"), "[fast mode]");
	assert.equal(h.request().service_tier, "priority");

	saveConfig({ ...updated, enabled: false });
	await h.command("status");
	assert.equal(h.notifications.at(-1).message, "Fast mode is off.");
	assert.equal(h.statuses.size, 0);
	assert.equal(h.request(), undefined);
});

test("/fast toggles the latest persisted state rather than another session's stale state", async () => {
	const first = createHarness();
	const second = createHarness();
	await first.command("on");
	assert.equal(readConfig().enabled, true);
	await second.command("");
	assert.equal(readConfig().enabled, false);
	assert.equal(second.request(), undefined);
});

test("/fast on preserves a newly restricted allowlist", async () => {
	saveConfig({ ...exampleConfig, enabled: true });
	const h = createHarness();
	const restricted = { enabled: true, models: [], showStatus: false };
	saveConfig(restricted);
	await h.command("on");
	assert.deepEqual(readConfig(), restricted);
	assert.equal(h.request(), undefined);
});

for (const tier of ["auto", "default", "flex", "priority", null, undefined]) {
	test(`does not overwrite an explicit service_tier=${tier}`, () => {
		saveConfig({ enabled: true });
		const payload = { model: "gpt-6-astra", service_tier: tier };
		assert.equal(createHarness().request(payload), undefined);
		assert.equal(payload.service_tier, tier);
	});
}

for (const endpoint of [
	{ provider: "openai", api: "openai-completions" },
	{ provider: "openai", api: "openai-codex-responses" },
	{ provider: "openai-codex", api: "openai-responses" },
	{ provider: "custom", api: "openai-responses" },
]) {
	test(`does not modify unsupported ${endpoint.provider}/${endpoint.api} requests`, () => {
		saveConfig({ enabled: true, models: [`${endpoint.provider}/gpt-6-astra`] });
		assert.equal(createHarness(endpoint).request(), undefined);
	});
}

test("requires an exact model match and an object payload", () => {
	saveConfig({ enabled: true });
	const h = createHarness();
	for (const payload of [null, [], "invalid", {}, { model: "gpt-5.5" }]) {
		assert.equal(h.request(payload), undefined);
	}
	h.ctx.model = { ...h.ctx.model, id: "gpt-6-astra-preview" };
	assert.equal(h.request({ model: "gpt-6-astra-preview" }), undefined);
	h.ctx.model = undefined;
	assert.equal(h.request(), undefined);
});

test("unlisted model variants do not inherit priority support", () => {
	saveConfig({ enabled: true });
	for (const endpoint of endpoints) {
		for (const id of newModelIds.map((id) => `${id}-preview`)) {
			assert.equal(createHarness({ ...endpoint, id }).request(), undefined);
		}
	}
});

test("/fast off persists and --fast is not reapplied on reload or session switches", async () => {
	const h = createHarness({ fast: true });
	assert.equal(h.request().service_tier, "priority");
	assert.equal(readConfig().enabled, true);
	await h.command("off");
	assert.equal(readConfig().enabled, false);
	assert.equal(h.statuses.size, 0);
	for (const reason of ["reload", "new", "resume", "fork"]) {
		h.emit("session_start", { reason });
		assert.equal(h.request(), undefined);
	}
	assert.equal(createHarness().request(), undefined);
});

test("updates the status when switching to or from GPT-6 Astra and on shutdown", () => {
	saveConfig({ enabled: true });
	const h = createHarness();
	const astra = h.ctx.model;
	h.ctx.model = { ...astra, id: "unsupported-model" };
	h.emit("model_select");
	assert.equal(h.statuses.size, 0);
	h.ctx.model = astra;
	h.emit("model_select");
	assert.equal(h.statuses.get("gpt-fast-mode"), "[fast mode]");
	h.emit("session_shutdown");
	assert.equal(h.statuses.size, 0);
});

test("showStatus=false hides the indicator without disabling priority requests", () => {
	saveConfig({ enabled: true, showStatus: false });
	const h = createHarness();
	assert.equal(h.statuses.size, 0);
	assert.equal(h.request().service_tier, "priority");
});

test("headless sessions support all current models without updating the UI", () => {
	saveConfig({ enabled: true });
	for (const endpoint of endpoints) {
		for (const id of modelIds) {
			const h = createHarness({ ...endpoint, id, hasUI: false });
			assert.equal(h.request().service_tier, "priority");
			h.emit("model_select");
			h.emit("session_shutdown");
		}
	}
});

test("invalid configuration falls back to defaults including GPT-6 Astra", async () => {
	saveConfig({ enabled: true, models: [42] });
	const h = createHarness();
	assert.equal(h.notifications[0].level, "warning");
	assert.equal(h.request(), undefined);
	await h.command("on");
	assert.equal(h.request().service_tier, "priority");
});
