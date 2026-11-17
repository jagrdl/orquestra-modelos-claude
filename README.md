# Orquestra de Modelos — Claude Code

Plugin **genérico**, independente de produto, repositório, linguagem e sistema operacional. Organiza tarefas com **Opus para planejamento**, **Sonnet para coordenação** e **Haiku para execução**. Em tarefa complexa demais para o Haiku, o Sonnet pode implementar, revisar ou testar via o subagente `especialista-sonnet`, como exceção com motivo registrado.

Pode ser usado em projetos web, APIs, aplicações móveis, bibliotecas, infraestrutura, automações, documentação e repositórios de qualquer organização.

## Pré-requisitos

- Claude Code com suporte a plugins e subagentes.
- Node.js disponível no `PATH` para executar os hooks em Windows, macOS ou Linux.
- Acesso de leitura ao repositório deste plugin no GitHub, para instalá-lo. `gh` não é obrigatório para **executar** o plugin.

## Instalação

No Claude Code, execute:

```text
/plugin marketplace add jagrdl/orquestra-modelos-claude
/plugin install orquestra@orquestra-modelos-claude
```

Opcionalmente, defina o modelo da sessão e o fallback de subagentes no arquivo global de configuração do Claude Code (`~/.claude/settings.json`):

```json
{
  "model": "opus",
  "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "haiku" }
}
```

> A instalação do plugin não altera automaticamente essas configurações. Verifique a disponibilidade dos modelos na sua conta/versão do Claude Code.

## Usar em qualquer projeto

1. Abra o Claude Code na pasta do projeto desejado.
2. Descreva a tarefa normalmente: implementar, corrigir, revisar, testar ou documentar.
3. A orquestração organiza papéis conforme o modelo ativo; o worker lê as regras próprias do repositório (como `CLAUDE.md`, `AGENTS.md` e skills pertinentes).
4. Dependências, decisões de negócio, comandos de build e critérios de aceite são específicos **da tarefa/projeto**, nunca fixados pelo plugin.

O plugin **não pressupõe** GitHub Projects, GitHub CLI, monorepo, branches específicas, linguagens, frameworks, estruturas de pastas, comandos de teste ou convenções de um produto específico. Quando um recurso como `git`, `gh`, CI ou uma ferramenta externa não estiver disponível, o agente usa as alternativas autorizadas no projeto e relata limitações.

### Comportamento por modelo

| Sessão | Papel | Operações |
| --- | --- | --- |
| Opus | Planejamento e contratos | Cria plano em `~/.claude/orquestra-plans/` e entrega a uma sessão Sonnet |
| Sonnet | Coordenação e integração | Delegação, validação de evidências e relatório; exceção: subagente `especialista-sonnet` |
| Haiku | Execução | Edição de código, testes, investigação e revisão por subagentes |

O hook bloqueia implementações diretas de Opus/Sonnet, salvo pedido explícito para executar sem delegação. Detalhes em [`ORQUESTRACAO.md`](ORQUESTRACAO.md).

## Arquivos

- `agents/`: cinco subagentes sem lógica de projeto: `executor`, `implementer`, `implementer-pesado`, `reviewer` (Haiku) e `especialista-sonnet` (Sonnet, esforço alto, exceção).
- `hooks/opus-guard.js`: limites de ferramentas e de delegação.
- `hooks/record-model.js`: modelo inicial da sessão.
- `hooks/print-instructions.js`: injeta as instruções de modo multiplataforma.
- `hooks/hooks.json`: registro dos hooks.
- `tests/opus-guard.test.js`: testes de comportamento do guard e carregamento das instruções.

## Verificações

```shell
node tests/opus-guard.test.js
node -e "for (const p of ['.claude-plugin/marketplace.json','.claude-plugin/plugin.json','hooks/hooks.json']) JSON.parse(require('fs').readFileSync(p,'utf8'))"
```

## Observações

- A troca Opus → Sonnet exige uma sessão Sonnet capaz de delegar Haiku. Se não houver mecanismo automático de criação de sessão no seu ambiente, altere manualmente com `/model sonnet` e continue seguindo o plano.
- O plugin orienta agentes, mas não substitui regras do projeto, revisão humana, permissões da ferramenta ou controle de versão.
- As sessões hospedadas em `claude.ai/code` podem ter limitações próprias para instalar plugins; quando aplicável, adapte os agentes à configuração suportada pelo ambiente.
