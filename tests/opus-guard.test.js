#!/usr/bin/env node
// Uso: node tests/opus-guard.test.js
// Simula SessionStart + PreToolUse via stdin e confere o opus-guard na 1ª chamada da sessão.
const { spawnSync } = require("child_process");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const hooks = path.join(__dirname, "..", "hooks");
const run = (script, input) =>
  spawnSync("node", [path.join(hooks, script)], { input: JSON.stringify(input), encoding: "utf8" });
const denied = (r) => r.stdout.includes('"permissionDecision":"deny"');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orquestra-test-"));
const emptyTranscript = path.join(tmp, "empty.jsonl");
fs.writeFileSync(emptyTranscript, JSON.stringify({ type: "user", message: { role: "user", content: "oi" } }) + "\n");
const assistantTranscript = (model) => {
  const f = path.join(tmp, `${model}.jsonl`);
  fs.writeFileSync(f, JSON.stringify({ type: "assistant", message: { model, usage: { input_tokens: 1 } } }) + "\n");
  return f;
};
const write = (sid, transcript_path) => run("opus-guard.js", {
  session_id: sid, transcript_path, tool_name: "Write",
  tool_input: { file_path: path.join(tmp, "x.txt"), content: "x" },
});
const sessions = [];
const sid = (n) => { const s = `test-${process.pid}-${n}`; sessions.push(s); return s; };
const start = (s, model) => {
  const r = run("record-model.js", { session_id: s, model });
  assert.strictEqual(r.stdout, "", "record-model não deve imprimir nada");
};

let n = 0;
const t = (name, fn) => { fn(); console.log(`ok ${++n} - ${name}`); };

t("Opus no SessionStart + sem assistente no transcript: Write fora de ~/.claude é negado", () => {
  const s = sid("a"); start(s, "claude-opus-4-7");
  assert.ok(denied(write(s, emptyTranscript)));
});
t("Sonnet no SessionStart + sem assistente no transcript: Write fora de ~/.claude é negado", () => {
  const s = sid("b"); start(s, "claude-sonnet-4-6");
  assert.ok(denied(write(s, emptyTranscript)));
});
t("Sonnet: Write de plano em ~/.claude passa", () => {
  const s = sid("b2"); start(s, "claude-sonnet-4-6");
  const r = run("opus-guard.js", { session_id: s, transcript_path: emptyTranscript, tool_name: "Write",
    tool_input: { file_path: path.join(os.homedir(), ".claude", "orquestra-plans", "x.md"), content: "x" } });
  assert.ok(!denied(r));
});
t("sem modelo gravado e sem assistente: libera (comportamento anterior)", () => {
  assert.ok(!denied(write(sid("c"), emptyTranscript)));
});
t("transcript Haiku tem precedência sobre modelo gravado Opus (/model)", () => {
  const s = sid("d"); start(s, "claude-opus-4-7");
  assert.ok(!denied(write(s, assistantTranscript("claude-haiku-5-5"))));
});
t("transcript Opus nega mesmo com modelo gravado Sonnet", () => {
  const s = sid("e"); start(s, "claude-sonnet-4-6");
  assert.ok(denied(write(s, assistantTranscript("claude-opus-4-7"))));
});

const agent = (sid, transcript_path, tool_input) => run("opus-guard.js", { session_id: sid, transcript_path, tool_name: "Agent", tool_input });
t("Opus: subagente Sonnet é negado", () => {
  const s = sid("f"); start(s, "claude-opus-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "orquestra:implementer", model: "sonnet" })));
});
t("Sonnet: subagente Opus é negado", () => {
  const s = sid("g"); start(s, "claude-sonnet-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "general-purpose", model: "opus" })));
});
t("Sonnet: agente genérico sem model é negado; com model haiku passa", () => {
  const s = sid("h"); start(s, "claude-sonnet-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "general-purpose" })));
  assert.ok(!denied(agent(s, emptyTranscript, { subagent_type: "general-purpose", model: "haiku" })));
});
t("Sonnet: orquestra:* sem model passa; fork é negado", () => {
  const s = sid("i"); start(s, "claude-sonnet-5-5");
  assert.ok(!denied(agent(s, emptyTranscript, { subagent_type: "orquestra:reviewer" })));
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "fork" })));
});
t("Opus: qualquer subagente é negado (só o Sonnet despacha Haiku)", () => {
  const s = sid("i2"); start(s, "claude-opus-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "orquestra:reviewer" })));
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "general-purpose", model: "haiku" })));
});
t("Sonnet: especialista-sonnet passa (com ou sem prefixo, com model sonnet); override para Opus é negado", () => {
  const s = sid("k"); start(s, "claude-sonnet-5-5");
  assert.ok(!denied(agent(s, emptyTranscript, { subagent_type: "orquestra:especialista-sonnet" })));
  assert.ok(!denied(agent(s, emptyTranscript, { subagent_type: "especialista-sonnet", model: "sonnet" })));
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "orquestra:especialista-sonnet", model: "opus" })));
});
t("Sonnet: Sonnet em agente genérico continua negado (a exceção é só do especialista)", () => {
  const s = sid("l"); start(s, "claude-sonnet-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "general-purpose", model: "sonnet" })));
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "orquestra:implementer", model: "sonnet" })));
});
t("Opus: especialista-sonnet também é negado (Opus nunca cria subagentes)", () => {
  const s = sid("m"); start(s, "claude-opus-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "orquestra:especialista-sonnet" })));
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "especialista-sonnet", model: "sonnet" })));
});
t("Sonnet: fork continua negado", () => {
  const s = sid("n"); start(s, "claude-sonnet-5-5");
  assert.ok(denied(agent(s, emptyTranscript, { subagent_type: "fork", model: "sonnet" })));
});
t("Haiku como sessão principal: subagente livre", () => {
  const s = sid("j"); start(s, "claude-haiku-5-5");
  assert.ok(!denied(agent(s, emptyTranscript, { subagent_type: "general-purpose", model: "sonnet" })));
});
t("carregamento das instruções é independente de shell", () => {
  const output = spawnSync("node", [path.join(hooks, "print-instructions.js")], { encoding: "utf8" });
  assert.strictEqual(output.status, 0);
  assert.ok(output.stdout.includes("Independência de projeto"));
  const config = JSON.parse(fs.readFileSync(path.join(hooks, "hooks.json"), "utf8"));
  const command = config.hooks.SessionStart[0].hooks[0].command;
  assert.ok(command.startsWith("node "));
  assert.ok(command.includes("print-instructions.js"));
});
t("metadados do plugin referenciam o repositório novo", () => {
  const root = path.join(hooks, "..");
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
  assert.strictEqual(marketplace.name, "orquestra-modelos-claude");
  assert.strictEqual(plugin.repository, "https://github.com/jagrdl/orquestra-modelos-claude");
});

for (const s of sessions) fs.rmSync(path.join(os.tmpdir(), `orquestra-model-${s}`), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
