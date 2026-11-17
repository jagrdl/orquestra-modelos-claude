#!/usr/bin/env node
// Carrega as instruções do plugin com Node.js em Windows, macOS e Linux.
// Executa sem alterar arquivos nem depender de shell específico.
const fs = require("fs");
const path = require("path");
try {
  process.stdout.write(fs.readFileSync(path.join(__dirname, "..", "ORQUESTRACAO.md"), "utf8"));
} catch (error) {
  process.stderr.write("[orquestra] Não foi possível carregar as instruções: " + error.message + "\n");
  process.exitCode = 1;
}
