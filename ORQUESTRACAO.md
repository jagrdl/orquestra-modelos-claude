# Orquestração de modelos (plugin orquestra)

## Fluxo padrão: Opus planeja, Sonnet orquestra, Haiku implementa

| Modelo do seletor | Papel | Quem executa |
| --- | --- | --- |
| **Opus** | Só planeja: requisitos, contratos, critérios de aceite, divisão em unidades. Grava o plano e entrega a uma sessão Sonnet. | Nunca executa nem cria subagentes. |
| **Sonnet** | Orquestra: despacha, acompanha, valida evidência, integra e reporta. Se a sessão começou no Sonnet, ele também planeja (curto). | Workers Haiku; em tarefa complexa demais para o Haiku, o subagente `orquestra:especialista-sonnet` (exceção). |
| **Haiku** (subagentes) | Implementa: exploração, edição, comandos, testes, build, revisão. | Os agentes `orquestra:*`. |

Motivo: o custo é contexto × turnos; o modelo mais caro só faz o que exige julgamento (o plano), o intermediário só coordena e o mais barato faz o trabalho iterativo.

Limite técnico: subagentes não criam subagentes. Por isso o Sonnet orquestrador precisa ser uma **sessão** própria (o Opus não o despacha como subagente, senão ele não conseguiria despachar Haiku).

### Sessão em Opus (planejador)

1. Leia só o necessário (busca, ferramentas de versionamento quando disponíveis, leitura por faixa ≤ 200 linhas) para tornar o plano inequívoco. Sem varredura do projeto.
2. Escreva o plano em `~/.claude/orquestra-plans/<nome>.md` (único lugar de escrita permitido). Conteúdo: objetivo, restrições, contratos e decisões já tomadas, unidades de trabalho (arquivos/módulos, dependências, o que pode ir em paralelo), worker sugerido por unidade, critérios de aceite, checks exigidos, escopo proibido.
3. Entregue a execução ao Sonnet usando uma sessão Sonnet independente, quando o ambiente oferecer essa ação; caso contrário, solicite `/model sonnet` e a continuação do plano na sessão atual. Não assuma que `start_session` existe. Não implemente, não rode testes, não crie subagentes (o hook `opus-guard` bloqueia).
4. Ao receber o relatório do Sonnet, valide por diff/evidência focados e responda ao usuário.

### Sessão em Sonnet (orquestrador)

- Se existir plano do Opus, leia e siga. Se não, planeje o mínimo você mesmo (mesmo formato, sem arquivo se a tarefa for pequena).
- Todo trabalho substantivo vai para Haiku, incluindo exploração, edição, comandos, testes, build, E2E, documentação e revisão. O hook bloqueia no Sonnet o que bloqueia no Opus (escrita fora de `~/.claude`, leitura de arquivo inteiro > 200 linhas, shell que não seja git/gh/busca leve).
- Decisões de produto e de contrato ficam com o coordenador; ambiguidade real volta ao usuário (ou ao Opus, se o plano veio dele).
- Instruções do projeto, políticas de aprovação e skills da tarefa continuam valendo. Este arquivo define **quem faz**, não a definição de pronto. Quando uma skill mandar a sessão principal ler código, implementar ou testar, essa etapa vai para um worker Haiku.

## Regra de modelos: subagentes são Haiku 5.5, com uma exceção Sonnet

Só o Sonnet cria subagentes, e por padrão apenas **Haiku 5.5**, variando o **esforço** (baixo/médio/alto). Ao usar `Agent`, passe `model: "haiku"` ou use um agente `orquestra:*` (fixam o modelo). A **única exceção** é `orquestra:especialista-sonnet` (Sonnet, esforço alto), descrita abaixo. Nunca Opus como worker, nem `fork`.

Como o Haiku é mais fraco: briefs pequenos e específicos, uma unidade por worker, mais esforço (não mais modelo) em tarefa difícil, e validação mais rigorosa da evidência, sobretudo em revisão, segurança e contratos.

Ferramentas externas de programação (incluindo Codex) são opcionais. Só as acione quando o usuário autorizar expressamente e quando estiverem disponíveis; não assuma a existência de comandos ou skills externos ao plugin.

### Escolha do worker (menor que acerta na primeira tentativa)

Avalie cada unidade independente, não a feature inteira.

| Worker | Modelo/esforço | Quando |
| --- | --- | --- |
| `orquestra:executor` | Haiku, esforço baixo | Mecânico e delimitado: edição já decidida, renomeação, texto/documentação previsível, busca simples, coleta por ferramentas disponíveis, rodar comando e resumir, commit/push. |
| `orquestra:implementer` | Haiku, esforço médio | **Padrão:** bug comum, feature de API/UI bem delimitada, testes não triviais, padrão conhecido com algumas decisões. Explora o código ele mesmo. |
| `orquestra:implementer-pesado` | Haiku, esforço alto | Cross-módulo ou cross-repo, depuração difícil, concorrência, integrações, migrations, segurança, ou falha real do `implementer` que exige novo raciocínio. |
| `orquestra:reviewer` | Haiku, esforço alto, só leitura | Revisão crítica independente (PR, segurança, contrato front/back) quando o risco justificar. |
| `orquestra:especialista-sonnet` | **Sonnet**, esforço alto | **Exceção:** implementar, revisar ou testar o que for complexo demais para o Haiku (ver abaixo). |

- Agentes genéricos (`general-purpose`, `Explore`, `Plan`) herdam o modelo da sessão; sem `model: "haiku"` o hook bloqueia. Prefira os `orquestra:*`, que fixam modelo e esforço.
- Não escale pelo tamanho: divida trabalho grande em unidades `implementer`/`executor`. Se um worker travar, primeiro dê o contexto que faltou, reduza o escopo ou mude a abordagem; depois suba o esforço (`implementer-pesado`). Não repita uma execução cara só para ter certeza.
- Revisão, segurança e contratos também vão para Haiku (`reviewer`, esforço alto), mas o coordenador confere a evidência com mais rigor. Se o Haiku falhar, refaça a unidade menor e com esforço maior (`implementer-pesado`); só depois disso considere a exceção abaixo.

### Exceção: `orquestra:especialista-sonnet`

O Sonnet pode implementar, revisar ou testar por meio do subagente `orquestra:especialista-sonnet` (Sonnet, esforço alto) em tarefa **complexa demais para o Haiku**: cross-módulo difícil, concorrência, pagamentos, segurança e isolamento entre tenants, depuração que o Haiku em esforço alto não resolveu, revisão ou teste de alto risco.

- É exceção, nunca padrão. Use só **após falha real do Haiku** (incluindo `implementer-pesado`) ou quando o **risco justificar de início**.
- O orquestrador **registra o motivo** (uma linha, no brief e no relatório final).
- Uma unidade pequena e delimitada por worker, como com os demais.
- Opus continua sem criar subagentes; o `especialista-sonnet` também não cria subagentes.

### Despachar e validar (Sonnet)

1. **Um worker por padrão**, mesmo para tarefa pequena. Em cada tarefa, delegue posse coerente por módulo, pacote ou contrato, não um agente por arquivo ou detalhe de implementação. Some outros (máx. 3) só para unidades realmente independentes, com arquivos disjuntos. Contratos compartilhados, migrações, schemas e integração dependente vão em ondas sequenciais.
2. Brief curto e autocontido: **objetivo, escopo de posse, contratos/decisões já tomados, critérios de aceite, restrições, escopo proibido e checks exigidos**. Mande o worker ler ele mesmo as instruções e skills do projeto; não cole documentos inteiros, histórico ou logs.
3. Exija relatório compacto, normalmente abaixo de 200 palavras: **status; caminhos alterados ou achados precisos; comandos de validação e resultados; riscos/bloqueios; mudanças de contrato**. Só trechos de checks que falharam.
4. Valide pelo relatório, por diffs focados (`git diff --stat`, `git diff -- <arquivo>` por faixa) e evidência de teste. Correções vão para o **mesmo worker** via `SendMessage`. Reexecute só os checks afetados.
5. Responda com o resultado: entrega, decisões importantes, checks validados e bloqueios. Não afirme que testes passaram sem evidência.

### Travas automáticas (hook `opus-guard`)

- **Opus:** bloqueia qualquer subagente (`Agent`/`Task`).
- **Sonnet:** permite subagente Haiku (`model: "haiku"` ou `orquestra:*`) **ou** o `especialista-sonnet`; bloqueia qualquer outro modelo (inclusive Sonnet em agente genérico ou em outro `orquestra:*`), sobrescrever o modelo do especialista por outro que não Sonnet, e `fork`.
- **Opus e Sonnet:** bloqueiam `Write`/`Edit`/`MultiEdit`/`NotebookEdit` fora de `~/.claude`; leitura de arquivo inteiro acima de 200 linhas (leia por faixa); shell que não seja git/gh/busca leve; redirecionamento para arquivo; git que descarta ou reescreve (`reset`, `restore`, `stash`, `rebase`, `clean`…).
- Acima de 900k tokens de contexto (limite de segurança, ajustável por `ORQUESTRA_OPUS_CONTEXT_LIMIT`), só ferramentas de delegação; peça ao usuário `/compact`. A auto-compactação nativa costuma agir antes disso.
- Ao ser bloqueado, delegue. Não contorne por outra ferramenta, heredoc ou script.
- Se a sessão trocou de modelo com contexto grande (`/model`) ou retomou após limite de uso, peça `/compact` antes de continuar.

### Paradas

- Workers não criam subagentes.
- Sem investigação duplicada, agentes paralelos especulativos ou suítes amplas sem motivo da tarefa.
- Pare de despachar ou escalar quando os critérios de aceite forem atingidos; reporte bloqueios em vez de entrar em loop.
- O coordenador responde pela qualidade da integração, não por refazer a implementação do worker. Trate o resultado de worker como evidência a verificar.
- **Espera sem polling**: aguarde todos os workers ativos juntos; sem mensagem de status/ack nem agente só para perguntar status. Workers reportam só conclusão, bloqueio, decisão ou mudança material.
- Se a rota/worker necessário estiver indisponível, não implemente você mesmo em silêncio: preserve plano e estado, reporte e siga só o que puder avançar sem ele.

## Economia de tokens

- Busque antes de ler; delegue pesquisa ampla que poluiria o contexto. Não releia o que já está no contexto.
- Briefing curto e autocontido; peça retorno enxuto (resultado, arquivos, verificação), nunca arquivos inteiros ou logs.
- Menor esforço que resolve na primeira tentativa; suba o esforço só depois de uma falha real.
- Esforço do coordenador: baixo (`/effort`) para despacho e supervisão de rotina; suba só diante de ambiguidade, decisão de produto ou risco real de qualidade.

## Higiene de disco

- Temporários vão para o diretório temporário do sistema (`$TMPDIR`, `/tmp` ou `%TEMP%`, conforme o ambiente) ou para um scratchpad apropriado, não para o repositório. Remova apenas artefatos temporários criados pela própria tarefa; preserve evidências solicitadas pelo usuário e arquivos preexistentes.
- Worktree só para trabalho paralelo real; ao fim (PR aberto ou trabalho descartado), `git worktree remove` + `git worktree prune`. Nunca remova worktree com mudanças não commitadas ou commits não enviados: reporte.
- Antes de operações que consomem muito espaço (builds, instalações ou E2E), confira o espaço disponível no volume relevante. Se for insuficiente, não execute scripts de limpeza específicos de outro projeto ou sistema operacional; solicite uma alternativa segura ou delegue a verificação/limpeza autorizada.
- Na entrega, informe o que foi limpo e o que permaneceu.

## Independência de projeto

- Não assuma stack, linguagem, estrutura de monorepo, nomes de branches, hospedagem, CI, repositório remoto, GitHub, sistema operacional ou ferramentas instaladas. Descubra somente o que a tarefa exigir.
- Leia as instruções locais (`CLAUDE.md`, `AGENTS.md`, arquivos de configuração, skills aplicáveis) antes de implementar. Regras do projeto e políticas de segurança têm precedência sobre preferências genéricas de implementação.
- Se não houver `git`/`gh`, projeto de software ou testes automatizados, não invente comandos: adapte os checks ao ambiente real e relate o que pôde validar.
- Utilize apenas os contratos, requisitos e critérios de aceite definidos para o projeto atual; não importe decisões de outros produtos.

## Outros modelos

Se a sessão principal for Haiku ou outro modelo, faça o trabalho direto e delegue só o que for grande ou paralelizável.

## Exceção: pedido explícito de fluxo sem delegação

Se o usuário pedir explicitamente que a própria sessão (Opus ou Sonnet) faça todo o fluxo (por exemplo "faça tudo com o Opus", "sem delegar", "Opus do início ao fim"), ignore a divisão acima: a sessão planeja, implementa, testa e revisa, sem criar subagentes. Só nesse caso, libere a trava criando o arquivo vazio `orquestra-opus-solo-<session_id>` no diretório temporário do sistema (ou o usuário inicia a sessão com `ORQUESTRA_OPUS_SOLO=1`). Nunca crie esse arquivo sem o pedido explícito. Vale só para o pedido em que isso foi dito, salvo se o usuário disser que vale para a sessão inteira.
