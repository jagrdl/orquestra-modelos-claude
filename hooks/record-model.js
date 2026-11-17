#!/usr/bin/env node
// SessionStart: grava o modelo da sessão em arquivo temporário (por session_id) para o
// opus-guard decidir já na 1ª chamada de ferramenta, antes de existir mensagem do assistente
// no transcript. Não imprime nada (stdout do SessionStart vira contexto). Fail-open.
const fs = require("fs");
const os = require("os");
const path = require("path");

let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const sid = String(input.session_id || "").replace(/[^\w-]/g, "");
    if (sid && input.model) {
      fs.writeFileSync(path.join(os.tmpdir(), "orquestra-model-" + sid), String(input.model));
    }
  } catch { /* fail-open */ }
  process.exit(0);
});
