#!/usr/bin/env node
// Trava de orquestração (Opus planeja, Sonnet orquestra, Haiku implementa).
// Opus: só planeja (plano em ~/.claude/orquestra-plans) e entrega a uma sessão Sonnet; não cria subagentes.
// Sonnet: planeja se preciso e orquestra; todo subagente é Haiku.
// Nas duas, só passam delegação, consultas leves (git/gh/busca/leitura por faixa) e edição de
// config/memória em ~/.claude. Implementação, escrita de arquivos, execução de código e leitura
// de arquivos inteiros vão para Haiku. Subagentes e outros modelos nunca são afetados.
// Em qualquer erro inesperado, libera a chamada (fail-open).
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTEXT_LIMIT = Number(process.env.ORQUESTRA_OPUS_CONTEXT_LIMIT || 900000);
const READ_MAX_LINES = Number(process.env.ORQUESTRA_OPUS_READ_MAX_LINES || 200);
const DELEGATION_TOOLS = new Set([
  "Agent", "Task", "SendMessage", "AskUserQuestion", "Skill", "ToolSearch",
  "TaskStop", "ExitPlanMode", "EnterPlanMode", "ScheduleWakeup", "ListAgents",
  "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "Monitor",
]);
const LIGHT_TOOLS = new Set(["Grep", "Glob", "LS", "WebSearch", "WebFetch"]);
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// Primeiro token permitido em cada segmento de comando (separado por && || ; |).
const SHELL_ALLOW = new Set([
  "git", "gh", "rg", "grep", "ls", "dir", "pwd", "cd", "echo", "wc", "which", "where",
  "date", "jq", "sort", "uniq", "head", "test", "true", "false",
  "get-childitem", "gci", "test-path", "select-string", "get-location", "get-date",
  "select-object", "measure-object", "where-object", "foreach-object", "sort-object",
  "convertfrom-json", "convertto-json", "format-table", "format-list", "write-output",
  "out-string", "get-command", "resolve-path", "split-path", "join-path",
  "for", "do", "done", "while", "if", "then", "else", "fi", "foreach", "{", "}",
]);
// git que reescreve ou descarta trabalho fica com subagente/usuário; git de leitura, commit e push passam.
const GIT_DENY = /\bgit\s+(reset|restore|checkout\s+--|clean|stash|rebase|apply|am|cherry-pick|revert|rm|mv)\b/i;

const DELEGUE_OPUS = "Opus só planeja: grave o plano em ~/.claude/orquestra-plans/<nome>.md e entregue a uma sessão Sonnet (se o ambiente permitir iniciar uma nova sessão, use-a; caso contrário, peça /model sonnet), que orquestra os workers Haiku. Não contorne por outra ferramenta.";
const DELEGUE_SONNET = "Delegue a um worker Haiku: orquestra:implementer (padrão; explora, implementa e valida), orquestra:executor (mecânico, comandos, git), orquestra:implementer-pesado (cross-módulo, depuração difícil, esforço alto), orquestra:reviewer (revisão crítica, esforço alto). Para correções, continue o mesmo worker com SendMessage. Peça relatório curto. Não contorne por outra ferramenta.";

function deny(reason) {
  fs.writeSync(1, JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `[orquestra] ${reason}`,
    },
  }));
  process.exit(0);
}

function lastAssistantMessage(transcriptPath) {
  const fd = fs.openSync(transcriptPath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"') || !lines[i].includes('"usage"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        if (o.type === "assistant" && o.message && o.message.model && o.message.model !== "<synthetic>") {
          return o.message;
        }
      } catch { /* linha parcial no início do bloco */ }
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

function recordedModel(sessionId) {
  try {
    const sid = String(sessionId || "").replace(/[^\w-]/g, "");
    if (!sid) return "";
    return fs.readFileSync(path.join(os.tmpdir(), `orquestra-model-${sid}`), "utf8");
  } catch { return ""; }
}

function underClaudeHome(p) {
  if (!p) return false;
  const home = path.resolve(os.homedir(), ".claude").toLowerCase();
  return path.resolve(p).toLowerCase().startsWith(home + path.sep);
}

function countLines(file) {
  const st = fs.statSync(file);
  if (st.size > 2 * 1024 * 1024) return Infinity;
  const data = fs.readFileSync(file);
  let n = 1;
  for (let i = 0; i < data.length; i++) if (data[i] === 10) n++;
  return n;
}

function checkShell(cmd) {
  const stripped = cmd.replace(/\d?>&\d/g, "").replace(/\d?>\s*(\/dev\/null|\$null|nul)\b/gi, "");
  if (/(^|[^-=<])>/.test(stripped.replace(/"[^"]*"|'[^']*'/g, ""))) {
    return "Escrita em arquivo pelo shell na sessão coordenadora.";
  }
  if (GIT_DENY.test(cmd)) return "Comando git que altera ou descarta a árvore de trabalho na sessão coordenadora.";
  const unquoted = cmd.replace(/"(\\.|[^"\\])*"|'[^']*'/g, '""');
  const segments = unquoted.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const first = seg.replace(/^(\$\w+\s*=\s*)/, "").replace(/^((do|then|else|\{)\s+)+/i, "").split(/\s+/)[0].replace(/^["'&(]+|["')]+$/g, "").toLowerCase();
    if (/^(sed|awk)$/.test(first) && !/-i\b/.test(seg)) continue;
    if (!SHELL_ALLOW.has(path.basename(first).replace(/\.exe$/, ""))) {
      return `Comando "${first}" não roda na sessão coordenadora (só consultas leves e versionamento).`;
    }
  }
  return null;
}

function main(input) {
  if (input.agent_id) return;
  const tp = input.transcript_path || "";
  if (!tp || /[\\/]subagents[\\/]/.test(tp) || !fs.existsSync(tp)) return;
  if (process.env.ORQUESTRA_OPUS_SOLO === "1") return;
  if (fs.existsSync(path.join(os.tmpdir(), `orquestra-opus-solo-${input.session_id}`))) return;

  const msg = lastAssistantMessage(tp);
  const model = msg ? msg.model : (input.model || recordedModel(input.session_id));
  const isOpus = /opus/i.test(model || "");
  const isSonnet = /sonnet/i.test(model || "");
  if (!isOpus && !isSonnet) return;

  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const DELEGUE = isOpus ? DELEGUE_OPUS : DELEGUE_SONNET;

  if (tool === "Agent" || tool === "Task") {
    if (isOpus) deny(`Opus não cria subagentes; quem orquestra os Haiku é o Sonnet. ${DELEGUE_OPUS}`);
    if (ti.subagent_type === "fork") {
      deny("Fork herda o modelo e o contexto inteiro da sessão. Use um agente orquestra:* (Haiku) com brief autocontido.");
    }
    if (ti.model && !/haiku/i.test(ti.model)) {
      deny(`Subagente em "${ti.model}" não é permitido: só Haiku 5.5, variando o esforço. Use model: "haiku" (orquestra:executor, implementer, implementer-pesado ou reviewer).`);
    }
    if (!ti.model && !/^orquestra:/.test(ti.subagent_type || "")) {
      deny('Subagente sem modelo herdaria o modelo da sessão. Passe model: "haiku" ou use um agente orquestra:*.');
    }
    return;
  }
  if (DELEGATION_TOOLS.has(tool) || tool.startsWith("mcp__")) return;

  const u = (msg && msg.usage) || {};
  const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (ctx > CONTEXT_LIMIT) {
    deny(`Contexto do coordenador em ${Math.round(ctx / 1000)}k tokens, acima do limite de segurança de ${CONTEXT_LIMIT / 1000}k (ajustável por ORQUESTRA_OPUS_CONTEXT_LIMIT); cada turno relê tudo. Peça ao usuário para rodar /compact. Até lá, só delegação. ${DELEGUE}`);
  }

  if (EDIT_TOOLS.has(tool)) {
    if (underClaudeHome(ti.file_path || ti.notebook_path)) return;
    deny(`O coordenador (Opus/Sonnet) não edita nem cria arquivos de projeto. ${DELEGUE}`);
  }
  if (tool === "Read") {
    const file = ti.file_path || "";
    if (underClaudeHome(file) || /\.(png|jpe?g|gif|webp)$/i.test(file)) return;
    if (ti.limit && ti.limit <= READ_MAX_LINES) return;
    if (fs.existsSync(file) && countLines(file) <= READ_MAX_LINES) return;
    deny(`Leitura de arquivo inteiro acima de ${READ_MAX_LINES} linhas na sessão coordenadora. Use Grep e leia por faixa (offset/limit ≤ ${READ_MAX_LINES}), ou delegue a leitura ao worker que vai executar a unidade.`);
  }
  if (tool === "Bash" || tool === "PowerShell") {
    const why = checkShell(ti.command || "");
    if (why) deny(`${why} ${DELEGUE}`);
    return;
  }
  if (LIGHT_TOOLS.has(tool)) return;
  deny(`Ferramenta ${tool} não é usada pela sessão coordenadora. ${DELEGUE}`);
}

let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try { main(JSON.parse(raw)); } catch { /* fail-open */ }
  process.exit(0);
});
