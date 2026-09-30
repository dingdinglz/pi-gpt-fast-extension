import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

// Opt in with the installed Pi package root. Ordinary unit tests remain entirely
// independent of Pi; this suite uses the actual SDK, extension loader and APIs.
const hostRoot = process.env.PI_TEST_PACKAGE_ROOT;

test("Pi SDK sends priority for every allowlisted model through both Responses APIs", {
	skip: !hostRoot && "Set PI_TEST_PACKAGE_ROOT to an installed Pi 0.99.1+ package",
	timeout: 60_000,
}, async (t) => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-gpt-fast-integration-"));
	const previousEnv = {
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_OFFLINE: process.env.PI_OFFLINE,
	};
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	t.after(() => {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(agentDir, { recursive: true, force: true });
	});

	const requests = [];
	const serverErrors = [];
	const server = createServer(async (req, res) => {
		try {
			const endpoint = endpoints.find(({ path }) => path === req.url);
			if (!endpoint || req.headers.authorization !== `Bearer ${endpoint.apiKey}`) {
				throw new Error("Mock requests must use the configured local endpoint and synthetic credentials");
			}
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const rawBody = Buffer.concat(chunks);
			// Current Codex SSE requests are zstd-compressed on the wire.
			const body = req.headers["content-encoding"] === "zstd" ? zstdDecompressSync(rawBody) : rawBody;
			const payload = JSON.parse(body.toString("utf8"));
			requests.push({ path: req.url, payload });
			const message = {
				id: `msg_${requests.length}`,
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "OK", annotations: [] }],
			};
			const response = {
				id: `resp_${requests.length}`,
				object: "response",
				created_at: Math.floor(Date.now() / 1000),
				status: "completed",
				model: payload.model,
				service_tier: payload.service_tier ?? "default",
				output: [message],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			};
			const events = [
				{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
				{ type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
				{ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: "OK" },
				{ type: "response.output_item.done", output_index: 0, item: message },
				{ type: "response.completed", response },
			];
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.end(events.map((event, sequence_number) =>
				`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
			).join(""));
		} catch (error) {
			serverErrors.push(error);
			res.writeHead(500);
			res.end("Invalid mock request");
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => new Promise((resolve) => {
		server.closeAllConnections();
		server.close(resolve);
	}));
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const jwt = [
		{ alg: "none" },
		{ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } },
	].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test";
	const example = JSON.parse(readFileSync(new URL("../fast-mode.example.json", import.meta.url), "utf8"));
	const endpoints = [
		{ provider: "openai", api: "openai-responses", baseUrl: `${baseUrl}/v1`, path: "/v1/responses", apiKey: "sk-test-only" },
		{ provider: "openai-codex", api: "openai-codex-responses", baseUrl: `${baseUrl}/backend-api`, path: "/backend-api/codex/responses", apiKey: jwt },
	];
	const providers = Object.fromEntries(endpoints.map(({ provider, api, baseUrl, apiKey }) => [provider, {
		api, baseUrl, apiKey,
		models: example.models.filter((key) => key.startsWith(`${provider}/`)).map((key) => ({
			id: key.slice(provider.length + 1),
			reasoning: true,
			input: ["text"],
			contextWindow: 272000,
			maxTokens: 128000,
		})),
	}]));
	const modelsPath = join(agentDir, "models.json");
	writeFileSync(modelsPath, JSON.stringify({ providers }));
	const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
		await import(pathToFileURL(join(hostRoot, "dist", "index.js")).href);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath,
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: false,
	});
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		cacheWarming: "off",
		compaction: { enabled: false },
		retry: { enabled: false },
	});

	for (const endpoint of endpoints) {
		const ids = providers[endpoint.provider].models.map(({ id }) => id);
		const resourceLoader = new DefaultResourceLoader({
			cwd: agentDir,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			additionalExtensionPaths: [fileURLToPath(new URL("../extensions/gpt-fast-mode.ts", import.meta.url))],
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		const { session } = await createAgentSession({
			cwd: agentDir,
			agentDir,
			modelRuntime,
			model: modelRuntime.getModel(endpoint.provider, ids[0]),
			thinkingLevel: "high",
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.inMemory(agentDir),
			noTools: true,
		});
		const extensionErrors = [];
		try {
			await session.bindExtensions({ mode: "print", onError: (error) => extensionErrors.push(error) });
			await session.prompt("/fast on");
			for (const id of ids) {
				await t.test(`${endpoint.provider}/${id} request serialization`, async () => {
					await session.setModel(modelRuntime.getModel(endpoint.provider, id));
					const before = requests.length;
					await session.prompt("Reply with OK.");
					assert.equal(session.messages.at(-1)?.stopReason, "stop", session.messages.at(-1)?.errorMessage);
					assert.equal(session.getLastAssistantText(), "OK");
					assert.equal(requests.length, before + 1);
					assert.equal(requests.at(-1).path, endpoint.path);
					assert.equal(requests.at(-1).payload.model, id);
					assert.equal(requests.at(-1).payload.service_tier, "priority");
					assert.equal(requests.at(-1).payload.reasoning.effort, "high");
				});
			}
			await session.prompt("/fast off");
			const before = requests.length;
			await session.prompt("Reply with OK.");
			assert.equal(session.messages.at(-1)?.stopReason, "stop", session.messages.at(-1)?.errorMessage);
			assert.equal(session.getLastAssistantText(), "OK");
			assert.equal(requests.length, before + 1);
			assert.equal("service_tier" in requests.at(-1).payload, false);
			assert.deepEqual(extensionErrors, []);
		} finally {
			session.dispose();
		}
	}
	assert.deepEqual(serverErrors, []);
});
