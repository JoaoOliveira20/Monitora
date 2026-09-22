# Monitora — Development Progress

## Current Status

Ambiente inicial validado (incluindo `docker compose up` real) e repositório no GitHub (`origin/main`). Config Loader + schema, HTTP Monitor, Scheduler, State Store, Alert Policy e Discord Notifier implementados e testados. O núcleo completo do fluxo documentado (`Configuração → Scheduler → Monitor → CheckResult → State Store → Alert Policy → AlertEvent → Discord Notifier`) já existe e foi validado em pedaços, mas nada ainda está "ligado" em `src/index.ts` (não há um processo real rodando isso continuamente, nem enviando notificações de verdade). Log/Host Monitor e Discord Bot (`/status`) ainda não existem.

## Current Task

Nenhuma tarefa em execução no momento. A implementação do Discord Notifier foi concluída.

## Completed

- Leitura de `CLAUDE.md`, `docs/PROJECT_BLUEPRINT.md` e `docs/ARCHITECTURE.md` antes de qualquer alteração.
- Estrutura inicial de diretórios criada: `config/`, `src/`, `tests/`, `logs/`.
- `package.json` configurado com scripts `dev`, `build`, `start`, `typecheck`, `test`.
- TypeScript configurado em modo strict (`tsconfig.json` para typecheck de `src` + `tests`; `tsconfig.build.json`, que estende o base, para build apenas de `src`).
- `discord.js` 14.x instalado como dependência (ainda não utilizado em código — apenas a dependência está preparada, conforme solicitado).
- `tsx` e `typescript` instalados como devDependencies para execução/watch em desenvolvimento e testes.
- `src/index.ts` criado com o mínimo necessário para validar que o runtime, o build e o start funcionam (lê `NODE_ENV`/`MONITOR_NAME` e loga uma mensagem de inicialização). Nenhuma lógica de monitoramento ou notificação foi implementada.
- Teste unitário mínimo (`tests/resolve-monitor-name.test.ts`) usando o test runner nativo do Node (`node:test`), executado via `tsx`.
- `config/targets.json` criado com estrutura mínima válida (`version`, `defaults`, `targets: []`), sem targets fictícios.
- `.env.example`, `.gitignore` e `.dockerignore` criados. Nenhum segredo foi versionado.
- `.env` local criado (fora do Git, apenas com placeholders vazios) para permitir a validação do `docker compose config`/`build`.
- `Dockerfile` multi-stage (`development`, `build`, `production`) com Node 22 Alpine, usando `npm ci` para instalação determinística.
- `docker-compose.yml` para desenvolvimento, sem portas publicadas e sem serviços externos (nada de Postgres/Redis/Kafka/etc.). Inclui `CHOKIDAR_USEPOLLING=true` para o hot-reload do `tsx watch` funcionar corretamente com bind mount no Docker Desktop/Windows.
- `package-lock.json` gerado.
- Repositório Git inicializado, primeiro commit criado e enviado para `git@github.com:JoaoOliveira20/Monitora.git` (branch `main`). Confirmado que `.env` não foi versionado.
- **Config Loader + schema de validação** (`src/config/schema.ts`, `src/config/loader.ts`):
  - `schema.ts` define os tipos de domínio (`Target`, `HttpTarget`, `LogTarget`, `HostTarget`, `MonitoraConfig`, `TargetDefaults`) e `parseMonitoraConfig(raw: unknown)`, que valida a estrutura completa do JSON (sem `any`, com type narrowing manual) e aplica os `defaults` a campos de target ausentes. Rejeita: tipos de target desconhecidos, HTTP target sem `url`/`urlEnv` ou com os dois ao mesmo tempo, log target sem `patterns`, ids de target duplicados, `version`/`defaults` ausentes ou inválidos.
  - `loader.ts` define `loadTargetsConfig(configPath?)`, que lê `config/targets.json` do disco, faz `JSON.parse`, chama `parseMonitoraConfig`, e — para cada target com `enabled: true` — valida que as variáveis de ambiente referenciadas (`discordWebhookEnv`, e `urlEnv` quando presente) realmente existem no ambiente, falhando com `ConfigValidationError` e mensagem clara caso contrário. Não resolve/substitui os valores (isso fica para o HTTP Monitor e o Discord Notifier, que ainda serão implementados).
  - `ConfigValidationError` é uma classe de erro dedicada para diferenciar falhas de configuração de outros erros no startup.
  - Testado com `tests/config-schema.test.ts` (12 casos) e `tests/config-loader.test.ts` (5 casos), usando fixtures em `tests/fixtures/`.
  - Validado manualmente que o `config/targets.json` real do projeto (com `targets: []`) é aceito sem erros pelo loader.
- **CheckResult genérico** (`src/types/index.ts`): `CheckResult<Metadata = unknown>` com `targetId`, `success`, `checkedAt`, `durationMs`, `error?`, `metadata`. Parametrizado por tipo para cada monitor poder tipar seu próprio `metadata` sem o State Store/Alert Policy precisarem conhecer detalhes de cada monitor (Rule 6 da arquitetura).
- **HTTP Monitor** (`src/monitoring/http-monitor.ts`): `checkHttpTarget(target: HttpTarget): Promise<CheckResult<HttpCheckMetadata>>`, usando `fetch` nativo do Node com `AbortController` para timeout e `redirect: "manual"` para capturar o status 3xx literal (ver "Technical Notes"). Resolve `url`/`urlEnv` (decisão já registrada na etapa anterior). Sucesso = status 2xx ou 3xx; 4xx/5xx é falha com `error: "unexpected HTTP status <code>"`. Falhas de conexão são categorizadas (timeout, DNS, connection refused, TLS) sem nunca incluir a URL bruta na mensagem de erro (segurança — evita vazar credenciais embutidas na URL ou URLs internas sensíveis). Não manda nada ao Discord, não conhece Scheduler.
  - 8 testes (`tests/http-monitor.test.ts`) usando um servidor HTTP local efêmero (`node:http`, porta 0) — sem depender de rede externa: sucesso 200, redirect 3xx, erro 4xx, erro 5xx, timeout, connection refused, `urlEnv` ausente, `urlEnv` resolvido corretamente.
- **Scheduler** (`src/monitoring/scheduler.ts`): classe `Scheduler(targets, checkTarget, callbacks?)` — recebe a lista de `Target[]` (do config) e uma função `checkTarget: (target: Target) => Promise<CheckResult>` injetada de fora (não conhece HTTP/Log/Host Monitor nem Discord). Cada target roda seu próprio laço independente ("self-scheduling": check → aguarda conclusão → espera `intervalSeconds` → repete), o que garante naturalmente que nunca há dois checks simultâneos do mesmo target, e que um target lento não bloqueia os outros (laços independentes). `start()` ignora targets com `enabled: false` e lança erro se chamado enquanto já está rodando. Falhas em `checkTarget` são capturadas (nunca derrubam o loop nem o processo) e reportadas via callback `onCheckError`; resultados bem-sucedidos vão para `onResult`. `stop()` usa `AbortController` para interromper a espera entre execuções imediatamente (não espera o intervalo inteiro passar) mas aguarda (`Promise.allSettled`) qualquer check já em andamento terminar antes de resolver — shutdown limpo conforme a arquitetura.
  - 9 testes (`tests/scheduler.test.ts`), com timers reais (delays pequenos, sem mock de tempo): intervalo respeitado, sem sobreposição do mesmo target, isolamento entre targets (lento não bloqueia rápido), continua agendando após falha, callback de resultado, ignora desabilitados, `stop()` rápido, `stop()` espera check em andamento, `start()` duplo lança erro. Suíte rodada 3x seguidas para checar estabilidade de timing — sem flakiness observada.
- **State Store em memória** (`src/monitoring/state-store.ts`), com os tipos `TargetStatus`, `MonitorState`, `StateTransition` adicionados a `src/types/index.ts`. Classe `StateStore` com `Map<targetId, MonitorState>` interno (nunca compartilha estado entre targets). `recordCheckResult(target, result)` aplica a máquina de estados `UNKNOWN → UP → DOWN` e retorna a `StateTransition` só quando o status realmente muda (senão `undefined`). Duas interpretações registradas onde a doc não era 100% explícita:
  1. `UNKNOWN → UP` ocorre no primeiro sucesso (não exige `recoveryThreshold`) — não faz sentido "confirmar recuperação" de um estado que nunca foi ruim.
  2. `UNKNOWN → DOWN` exige `failureThreshold` (mesma regra de `UP → DOWN`), para não gerar falso positivo numa falha isolada logo na inicialização.
  3. `firstFailureAt`/downtime são contados desde a **primeira falha da sequência consecutiva atual**, não desde o momento em que `DOWN` foi oficialmente confirmado — dá um downtime mais preciso do ponto de vista do usuário final.
  - `lastAlertAt` existe no `MonitorState` (parte do domínio documentado), mas nada escreve nele ainda — isso é responsabilidade da Alert Policy (próxima etapa), que ainda não existe. Não foi criado nenhum método especulativo pra isso.
  - 13 testes (`tests/state-store.test.ts`): transições UNKNOWN→UP, UNKNOWN→DOWN (com failureThreshold), UP→DOWN, DOWN→UP (com recoveryThreshold), reset de contador de falha/sucesso, **flapping** (uma recuperação parcial interrompida por nova falha reseta o contador de sucessos), downtime calculado desde a primeira falha (não desde a confirmação), `firstFailureAt` fixo através de múltiplas falhas mas `lastFailureAt` avançando, `lastSuccessAt`/`lastFailureAt` como históricos independentes, isolamento entre targets.
  - `recordAlertSent(targetId, sentAt)` adicionado depois (junto com a Alert Policy): atualiza `lastAlertAt` no `MonitorState`; no-op se o target não tem estado registrado. 2 testes novos.
- **Alert Policy** (`src/monitoring/alert-policy.ts`) e os tipos `AlertEvent`/`AlertEventType`/`DownAlertMetadata`/`RecoveredAlertMetadata` em `src/types/index.ts`. Função pura `evaluateAlert(target, state, transition, now): AlertEvent | undefined` — sem estado próprio, sem I/O, não conhece Discord. Regras implementadas, lendo a doc com cuidado porque "thresholds/cooldown" na seção 6 da arquitetura é atribuído à Alert Policy mas a *máquina de estados* (seção 10) já vive no State Store — a interpretação adotada foi: o State Store decide QUANDO o status muda; a Alert Policy decide SE/QUANDO isso vira uma notificação:
  1. Transição para `DOWN` (de `UP` ou `UNKNOWN`) sempre gera um evento `DOWN` — o primeiro alerta de um incidente nunca é bloqueado por cooldown.
  2. Transição `DOWN → UP` sempre gera um evento `RECOVERED`, também ignorando cooldown ("Recovery notifications are independent from the DOWN cooldown", `docs/ARCHITECTURE.md` seção 13).
  3. Sem transição (status já era o mesmo) mas ainda `DOWN`: gera um "reminder" (`DOWN` de novo) somente se `cooldownSeconds` já passou desde `lastAlertAt` (ou se `lastAlertAt` nunca foi setado — cenário defensivo: o alerta anterior foi decidido mas o envio pode ter falhado antes de chamar `recordAlertSent`, não deveria esperar o cooldown inteiro de novo).
  - `formatDuration(ms)` exportada separadamente (função pura, ex.: `90000 → "1m 30s"`) — usada para formatar o downtime na mensagem do evento `RECOVERED`; reutilizável pelo futuro Discord Notifier.
  - Quem chama `stateStore.recordAlertSent()` e quando (antes ou depois de confirmar entrega no Discord) é decisão do futuro orquestrador (`src/index.ts`), não da Alert Policy — mantém a função de decisão pura e testável.
  - 11 testes (`tests/alert-policy.test.ts`): `formatDuration` em 3 formatos, DOWN imediato em ambas as transições de origem, mensagem/metadata incluindo `lastError`, RECOVERED com downtime formatado e ignorando cooldown, nenhum alerta sem transição enquanto UP, reminder bloqueado antes do cooldown, reminder liberado após o cooldown, reminder liberado quando `lastAlertAt` nunca foi setado.
  - Testado manualmente um incidente completo de ponta a ponta (script `tsx` descartável, não commitado): 2 falhas → `DOWN` imediato → silêncio dentro do cooldown → reminder `DOWN` após 900s → `RECOVERED` com "30m 0s" de downtime contado desde a primeira falha, não desde a confirmação. Comportamento exatamente como esperado.
- **`AlertEvent` fortalecido para discriminated union real** (`src/types/index.ts`): antes `metadata: DownAlertMetadata | RecoveredAlertMetadata` não estava amarrado ao campo `type`, exigindo type assertions em quem consumisse o evento. Agora `DownAlertEvent`/`RecoveredAlertEvent` são interfaces próprias unidas em `AlertEvent`, e o TypeScript faz o narrowing automático (`if (event.type === "DOWN") { event.metadata.consecutiveFailures }` sem assertion). `alert-policy.ts` não precisou de nenhuma mudança — já retornava exatamente essa shape.
- **Discord Notifier** (`src/discord/notifier.ts`): `sendAlertToDiscord(target, event): Promise<{ success: boolean; error?: string }>`. Resolve o webhook via `target.discordWebhookEnv` (a resolução que tínhamos adiado desde a etapa do Config Loader), monta o embed com `discord.js` `EmbedBuilder` seguindo o formato documentado em `docs/PROJECT_BLUEPRINT.md` seção 19 (🔴/🟢, campos Service/Failures/Detected at/Error para DOWN, Service/Downtime/Recovered at para RECOVERED), envia via `WebhookClient`, e nunca decide se deve alertar (isso já foi decidido pela Alert Policy).
  - **Achado crítico de segurança durante a investigação** (script `tsx` descartável contra o domínio real do Discord, com um webhook inventado que obviamente não existe — só para inspecionar a *forma* do erro, sem usar nenhuma credencial real): o erro `DiscordAPIError` lançado pelo `discord.js` tem um campo `.url` que expõe **a URL completa do webhook, token incluído**, em texto puro. Logar o erro ingenuamente (`console.error(error)` ou até `error.message` em alguns casos) vazaria o token. `describeDeliveryFailure()` extrai só `.status`/`.code` (seguros) e nunca toca em `.url` ou no objeto de erro bruto. Testado explicitamente (`sendAlertToDiscord reports a Discord API failure without leaking the webhook URL`) com regex negativo confirmando que o token fake de 68 caracteres não aparece na mensagem de erro retornada.
  - Testes usam `node:test`'s `mock.method(WebhookClient.prototype, "send", ...)` — mock nativo, sem dependência extra — em vez de um Discord real (regra explícita do CLAUDE.md). Precisei descobrir empiricamente o formato exigido pela validação de URL do `discord.js` (`id` com 17-19 dígitos, `token` com exatamente 68 caracteres `[\w-]`, lido do código-fonte instalado em `node_modules/discord.js/src/util/Util.js`) para conseguir construir uma URL de webhook fake que passasse pela validação e chegasse até o mock.
  - 9 testes (`tests/discord-notifier.test.ts`): envio bem-sucedido, `discordWebhookEnv` ausente (falha sem tentar enviar), falha da API do Discord sem vazar a URL, fallback genérico para erro não reconhecido, `client.destroy()` sempre chamado (inclusive em erro), conteúdo do embed DOWN (com e sem `lastError`), conteúdo do embed RECOVERED (com e sem `downtimeMs`).

## In Progress

- Nenhuma tarefa em andamento.

## Next Steps

- Montar o "cabo" em `src/index.ts`: carregar a config, criar o `Scheduler` com uma função de dispatch por `target.type` (hoje só `http` tem monitor implementado — `log`/`host` devem lançar erro claro), ligar ao `StateStore`, à `evaluateAlert` e ao `sendAlertToDiscord`, chamando `stateStore.recordAlertSent()` só depois que `sendAlertToDiscord` confirmar sucesso (ver decisão registrada em "Technical Notes"). Hoje nenhuma dessas peças está conectada — todas existem isoladas e testadas.
- Depois disso, considerar o Discord Bot (`/status`, lê o `StateStore` sem rodar healthchecks) — não é prioridade imediata, mencionado aqui só para não esquecer que faz parte do roadmap documentado.
- Em algum ponto (provavelmente depois do State Store, antes do Discord Notifier), montar o "cabo" em `src/index.ts` que carrega a config, cria o `Scheduler` com uma função de dispatch por `target.type` (hoje só `http` tem monitor implementado) e liga ao State Store — hoje nada disso está conectado ainda.

Nenhum desses itens foi iniciado — devem ser tratados como tarefas incrementais separadas, uma de cada vez, conforme o protocolo definido em `CLAUDE.md`.

## Blockers

- Nenhum bloqueio técnico. O Docker Desktop precisou ser iniciado manualmente no começo da sessão de preparação do ambiente; numa sessão seguinte, com o Docker Desktop já rodando, `docker compose up` (não só `build`) foi validado com sucesso, incluindo hot-reload dentro do container.

## Technical Notes

- O projeto usa ESM nativo (`"type": "module"` no `package.json`) com `module`/`moduleResolution` `NodeNext` no TypeScript. Isso significa que futuras importações relativas entre arquivos `.ts` devem referenciar a extensão `.js` (ex.: `import { x } from "./foo.js"`, mesmo o arquivo fonte sendo `foo.ts`). Esse é o padrão oficial do TypeScript para NodeNext e já foi validado em `tests/resolve-monitor-name.test.ts`, que importa `../src/index.js`.
- Testes usam o test runner nativo do Node (`node:test`) executado via `tsx --test`, sem adicionar Jest/Vitest como dependência — decisão alinhada com a regra de evitar dependências desnecessárias. O script `test` usa explicitamente o glob `"tests/**/*.test.ts"` porque passar apenas o diretório `tests/` para `tsx --test` falhou nesta versão/plataforma (`ERR_UNSUPPORTED_DIR_IMPORT` no Node 24 local via tsx). Isso está documentado aqui para não ser "redescoberto" como bug em uma sessão futura.
- Dockerfile usa `node:22-alpine` (tag flutuante dentro da major 22) em vez de um patch fixo (ex.: `node:22.23.2-alpine3.24`, como no exemplo do blueprint). Decisão consciente para evitar depender de uma tag de patch específica que pode deixar de existir; caso o time prefira reprodutibilidade estrita, é possível fixar depois.
- Não foram criados os diretórios `src/commands/`, `src/discord/`, `src/logs/`, `src/monitoring/`, `src/system/`, `src/types/` vazios (`src/config/` já existe, criado nesta etapa). Os demais serão criados quando a primeira implementação real de cada módulo for feita, conforme a regra de não criar arquivos vazios apenas para preencher diretórios.
- `loader.ts` valida a *presença* das variáveis de ambiente referenciadas por targets habilitados, mas não resolve o valor final (não transforma `urlEnv` em `url`, nem lê o valor real do webhook). Decisão: a arquitetura atribui explicitamente a "resolução do webhook configurado" ao Discord Notifier (`docs/ARCHITECTURE.md`, seção 18); por simetria, a resolução de `url`/`urlEnv` fica para o HTTP Monitor. O Config Loader só garante fail-fast no startup se uma env var referenciada por um target habilitado não existir.
- `checkHttpTarget` usa `fetch(url, { redirect: "manual" })` em vez do padrão (`"follow"`). Confirmado empiricamente (script `tsx` descartável) que, diferente do comportamento de browser (onde `redirect: "manual"` zera o status por privacidade cross-origin), no Node/undici o `response.status` real (302, etc.) fica visível com `redirect: "manual"`. Isso é necessário porque a arquitetura lista "3xx" como um caso relevante que o HTTP Monitor deve tratar — com `redirect: "follow"` (padrão) nunca veríamos um 3xx, só o status final após seguir a cadeia.
- `checkHttpTarget` nunca inclui a URL bruta do target nas mensagens de erro (`error` do `CheckResult`), só uma categoria (`"DNS resolution failed"`, `"connection refused"`, `"TLS handshake failed"`, `"request timed out after Xms"`, ou o fallback genérico `"request failed"`). Decisão de segurança: a URL pode conter credenciais embutidas ou ser uma URL interna sensível, e a arquitetura exige sanitizar esse tipo de informação antes de logar ou mandar pro Discord (`docs/ARCHITECTURE.md`, seção 23).
- Ao testar a categorização de erro de conexão, o primeiro teste usava `http://127.0.0.1:1` (porta 1) esperando `ECONNREFUSED`, mas o `fetch`/undici bloqueia portas "inseguras" (a mesma lista de "forbidden ports" dos browsers) antes mesmo de tentar conectar, lançando `cause: Error("bad port")` sem `.code`. Isso caía no fallback genérico `"request failed"` — funcionalmente correto (`success: false`), mas a categorização ficava errada. Corrigido usando uma porta alta válida (`59999`) sem nada escutando, que gera o `ECONNREFUSED` real esperado. Documentado aqui porque não é óbvio e pode confundir uma sessão futura mexendo nesses testes.
- O `Scheduler` trabalha diretamente com o tipo `Target` (união `HttpTarget | LogTarget | HostTarget` de `src/config/schema.ts`) em vez de ser genérico (`<T>`). Decisão consciente: o Scheduler sempre vai lidar com targets vindos da configuração do Monitora, não há requisito real para generalizar além disso — generics aqui seriam abstração sem benefício concreto (regra do CLAUDE.md contra abstração prematura).
- `Scheduler.stop()` usa `AbortController.abort()` para interromper apenas a espera (`delay` entre execuções), nunca o check em andamento — abortar um check no meio poderia deixar o HTTP Monitor (ou um monitor futuro) em estado inconsistente. Isso é o que permite "parar novos checks; aguardar operações em andamento quando possível" (regra de graceful shutdown) sem sacrificar a resposta rápida do `stop()`.
- Decisão em aberto para quando o Discord Notifier existir: `recordAlertSent()` deve ser chamado **depois** que o Notifier confirma que o envio ao Discord teve sucesso, não antes (otimista). Motivo: se o envio falhar (rede, Discord fora do ar, webhook inválido) e já tivéssemos marcado `lastAlertAt`, o sistema esperaria o `cooldownSeconds` inteiro antes de tentar notificar de novo, mesmo que a falha tenha sido transitória — indo contra "Discord delivery failures must be handled... without corrupting monitor state" (`docs/ARCHITECTURE.md` seção 21). A Alert Policy não decide isso sozinha (é pura, sem acesso ao StateStore) — fica para o orquestrador em `src/index.ts`.
- Limitação conhecida e aceita por ora: um host target sem nenhum dos três campos de threshold (`cpuThresholdPercent`, `memoryThresholdPercent`, `diskThresholdPercent`) é aceito pelo schema, mas nunca vai gerar alerta (não há threshold "global" de host implementado, só os campos por-target). Como o Host Monitor ainda não existe, o impacto é zero por ora; reavaliar quando o Host Monitor for implementado — pode fazer sentido exigir pelo menos um threshold definido quando `enabled: true`.
- O ambiente de validação local tinha Node.js, npm e Docker instalados no host (usados para gerar `package-lock.json` e rodar as validações mais rápido), mas o projeto continua desenhado para não exigir Node/npm no host — tudo roda também via Docker, como validado nesta sessão.
- `tsx watch` (usado em `npm run dev`) depende de `chokidar` para detectar mudanças de arquivo. Em bind mounts do Docker Desktop no Windows, eventos de sistema de arquivos (inotify) nem sempre se propagam para dentro do container — o hot-reload silenciosamente não disparava, apesar do arquivo já estar atualizado dentro do container (confirmado com `docker compose exec monitor cat src/index.ts`). Corrigido setando `CHOKIDAR_USEPOLLING: "true"` no `environment` do serviço `monitor` em `docker-compose.yml`. Validado com um teste real de edição de arquivo: o container detectou a mudança e reiniciou o processo (`tsx` logou `change in ./src/index.ts Rerunning...`).

## Recent Changes

- Criação de toda a base técnica descrita em "Completed" acima, em uma sessão inicial de preparação de ambiente.
- Revisão do Docker com o Docker Desktop já em execução (`docker compose up`, hot-reload real, build de produção isolado). Dois problemas corrigidos:
  1. **Bug em `resolveMonitorName`** (`src/index.ts`): usava `env.MONITOR_NAME ?? "Monitora"`, que não trata string vazia como "não definido". Como `.env.example` intencionalmente deixa `MONITOR_NAME=` vazio (regra do CLAUDE.md de não colocar valores fictícios), qualquer fork que copiasse o exemplo sem preencher via ver o log `" starting in development mode"` sem nome. Trocado para `env.MONITOR_NAME || "Monitora"`. Adicionado teste de regressão (`resolveMonitorName falls back to default when empty`).
  2. **Hot-reload não funcionava em `docker compose up`** por causa do bind mount no Windows (ver nota acima sobre `CHOKIDAR_USEPOLLING`). Corrigido em `docker-compose.yml`.
- Repositório Git inicializado (`git init`), primeiro commit criado e enviado para o GitHub (`origin/main`), a pedido do usuário, que já havia criado o repositório remoto.
- Implementado o Config Loader e o schema de validação de `config/targets.json` (`src/config/schema.ts`, `src/config/loader.ts`), com 17 testes novos (`tests/config-schema.test.ts`, `tests/config-loader.test.ts`, `tests/fixtures/`).
- Revisão do Config Loader/schema logo em seguida (exploração manual de casos-limite via script `tsx` descartável, não só leitura estática). Dois achados reais corrigidos:
  1. **Thresholds de host sem limite superior**: `cpuThresholdPercent: 500` passava sem erro (era só `must be a positive number`). Trocado `optionalPositiveNumber` por `optionalPercentage`, que exige `0 < valor <= 100`, para os três campos de threshold do host target.
  2. **`url` do HTTP target sem validação de formato**: `url: "not-a-url-at-all"` passava sem erro. Adicionada `requireUrlString` (usa o `URL` nativo do Node em try/catch) aplicada ao campo `url` quando presente (não se aplica a `urlEnv`, que é só o nome de uma env var). Dois testes de regressão adicionados.
- Implementado o HTTP Monitor (`src/monitoring/http-monitor.ts`) e o tipo `CheckResult` genérico (`src/types/index.ts`), com 8 testes novos usando servidor HTTP local efêmero. Durante a implementação, uma investigação empírica (scripts `tsx` descartáveis, depois apagados) confirmou o comportamento de `redirect: "manual"` no Node e revelou que a porta 1 é bloqueada pelo `fetch`/undici antes de tentar conectar — o teste inicial de "connection refused" estava testando o cenário errado e foi corrigido para usar uma porta alta válida.
- Implementado o Scheduler (`src/monitoring/scheduler.ts`), com 9 testes novos cobrindo intervalo, ausência de sobreposição, isolamento entre targets, resiliência a falhas e shutdown limpo.
- Implementado o State Store (`src/monitoring/state-store.ts`) e os tipos `TargetStatus`/`MonitorState`/`StateTransition` (`src/types/index.ts`), com 13 testes novos cobrindo a máquina de estados, thresholds, flapping, downtime e isolamento entre targets.
- Revisão completa de tudo implementado até então, incluindo dois testes de integração de ponta a ponta (scripts `tsx` descartáveis): (1) Config → Scheduler → HTTP Monitor → State Store rodando juntos contra um servidor HTTP local, confirmando `UNKNOWN → UP → DOWN → UP` com downtime correto; (2) mais tarde, depois da Alert Policy, um incidente completo com reminder de cooldown. Nenhum bug novo encontrado no código já revisado individualmente — o valor da revisão foi confirmar que as peças se encaixam sem atrito de tipos.
- Implementado o método `StateStore.recordAlertSent()` e a Alert Policy (`src/monitoring/alert-policy.ts`, função pura `evaluateAlert`), com os tipos `AlertEvent`/`DownAlertMetadata`/`RecoveredAlertMetadata` (`src/types/index.ts`). 13 testes novos (11 da Alert Policy + 2 do `recordAlertSent`).
- Fortalecido `AlertEvent` para discriminated union real (`type` amarrado a `metadata` sem precisar de assertions). Implementado o Discord Notifier (`src/discord/notifier.ts`, `sendAlertToDiscord`), com 9 testes novos usando o mock nativo do `node:test` (sem Discord real). Durante a implementação, uma investigação empírica (script `tsx` descartável contra o domínio real do Discord, sem credenciais reais) revelou que o erro `DiscordAPIError` do `discord.js` expõe a URL completa do webhook — token incluído — no campo `.url`; o notifier foi escrito para nunca tocar nesse campo, e isso está coberto por um teste dedicado com regex negativo.

## Validation

Comandos executados e resultados:

```bash
npm install
# OK — 29 pacotes instalados, 0 vulnerabilidades, package-lock.json gerado.

npm run typecheck
# OK — tsc --noEmit -p tsconfig.json sem erros.

npm run build
# OK — tsc -p tsconfig.build.json gerou dist/index.js.

npm test
# OK — 76 testes passaram (tsx --test "tests/**/*.test.ts"): 3 de src/index.ts, 14 de src/config/schema.ts,
# 5 de src/config/loader.ts, 8 de src/monitoring/http-monitor.ts, 9 de src/monitoring/scheduler.ts,
# 15 de src/monitoring/state-store.ts, 11 de src/monitoring/alert-policy.ts, 9 de src/discord/notifier.ts
# (mock nativo do node:test, sem Discord real).
# Suíte completa rodada 3x seguidas para checar flakiness de timing nos testes do Scheduler — estável nas 3.

npm start
# OK — "Monitora starting in development mode" impresso via dist/index.js.

docker compose config
# OK — configuração válida, sem portas publicadas, sem serviços externos, incluindo CHOKIDAR_USEPOLLING.

docker compose build
# OK — imagem de desenvolvimento construída com sucesso (target development).

docker compose up -d
# OK — container subiu (STATUS: Up), log inicial correto ("Monitora starting in development mode").

docker compose exec monitor cat src/index.ts
# OK — confirmado que o bind mount reflete o arquivo do host corretamente dentro do container.

# Teste manual de hot-reload: editado src/index.ts no host enquanto o container rodava.
# Resultado: tsx detectou a mudança ("change in ./src/index.ts Rerunning...") e reiniciou o processo.

docker compose down
# OK — container, rede e nada ficou pendurado.

docker build --target production -t monitora-production .
# OK — imagem de produção construída com sucesso (build multi-stage completo).

docker run --rm monitora-production
# OK — sem .env, container usa NODE_ENV=production da imagem: "Monitora starting in production mode".

docker run --rm --env-file .env monitora-production
# OK — container de produção iniciou e executou "npm start" corretamente.

# --- após implementar o Config Loader ---

docker compose build
# OK — imagem de desenvolvimento reconstruída com src/config/ novo.

docker build --target production -t monitora-production .
# OK — imagem de produção reconstruída (o build stage roda "npm run build" dentro do container,
# validando o typecheck/compilação do novo módulo também dentro do Docker, não só localmente).

# --- após implementar o HTTP Monitor ---

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/ e src/types/ novos.

# --- após implementar o Scheduler ---

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/scheduler.ts novo.

# --- após implementar o State Store ---

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/state-store.ts novo.

# --- após a revisão geral + Alert Policy ---

npx tsx <script descartável>
# OK (2x) — integração de ponta a ponta confirmada manualmente antes e depois da Alert Policy;
# scripts não commitados (removidos após a checagem).

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/alert-policy.ts novo.

# --- após implementar o Discord Notifier ---

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/discord/notifier.ts novo.
```

Script avulso rodado localmente (`tsx`, depois apagado) confirmando que `loadTargetsConfig()` aceita o `config/targets.json` real do projeto (`targets: []`) sem erros.

Todas as validações mínimas exigidas passaram, incluindo execução real via `docker compose up` (não só `build`).
