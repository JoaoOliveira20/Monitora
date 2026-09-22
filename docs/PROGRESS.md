# Monitora — Development Progress

## Current Status

Todos os três tipos de monitor documentados (HTTP, Log, Host) estão implementados, ligados e testados. `src/index.ts` roda o ciclo completo: Config → Scheduler → Monitor (dispatch por `target.type`) → CheckResult → State Store → Alert Policy (`DOWN`/`RECOVERED`/`LOG_MATCH`/`HOST_THRESHOLD`) → Discord Notifier. O Host Monitor consulta um Node Exporter via HTTP (nunca lê `/proc`/`/sys` do container, conforme a arquitetura exige) — o Node Exporter roda como serviço no `docker-compose.yml`. A **estrutura de diretórios agora bate exatamente** com `docs/PROJECT_BLUEPRINT.md`/`docs/ARCHITECTURE.md` (`src/logs/log-monitor.ts`, `src/system/host-metrics.ts`), corrigida após uma auditoria de conformidade pedida pelo usuário. `README.md` reflete esse estado. Repositório no GitHub (`origin/main`). Só o Discord Bot (`/status`) ainda não existe — é o único item pendente do roadmap documentado.

## Current Task

Nenhuma tarefa em execução no momento. Uma auditoria pedida pelo usuário contra `docs/PROJECT_BLUEPRINT.md` encontrou uma divergência estrutural real (ver "Recent Changes") — corrigida: `src/logs/log-monitor.ts` e `src/system/host-metrics.ts` agora batem exatamente com a estrutura de diretórios documentada em `docs/PROJECT_BLUEPRINT.md` (seção 6) e `docs/ARCHITECTURE.md` (seção 25).

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
- **`src/index.ts` ligado ao núcleo completo.** `src/monitoring/dispatch.ts` (`checkTarget`, hoje `createDispatcher()`, ver abaixo) decide qual monitor rodar por `target.type`. `host` lança erro claro (`"host monitor is not implemented yet"`), capturado pelo `onCheckError` do Scheduler sem derrubar o processo. 3 testes (`tests/dispatch.test.ts`).
  - `index.ts`: carrega a config (`loadConfigOrExit`, sai com código 1 e mensagem clara em erro crítico de configuração), cria o `StateStore`, cria o `Scheduler` com o dispatcher, liga `onResult` → `stateStore.recordCheckResult` → `evaluateAlert` → (se houver evento) `sendAlertToDiscord`, e trata `SIGTERM`/`SIGINT` parando o Scheduler antes de sair (`process.exit(0)`).
  - `main()` só roda quando o arquivo é o entrypoint real do processo (guard via `import.meta.url` comparado a `pathToFileURL(process.argv[1])`), não quando importado por um teste — ver bug encontrado abaixo.
  - `resolveMonitorName` continua exportado e com seus 3 testes originais intactos.
- **`README.md`** criado na raiz do projeto: o que é o Monitora, status atual (o que funciona vs o que falta — Log/Host Monitor e Discord Bot), requisitos, quick start (`git clone` → `.env` → `config/targets.json` → `docker compose up`), tabela de configuração de `.env` (deixando claro que `DISCORD_WEBHOOK_MAIN` é só um exemplo de nome, e que `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`DISCORD_GUILD_ID` são reservadas e não usadas ainda), tabela de campos de `config/targets.json` (comuns + específicos de `http`), scripts disponíveis, segurança, estrutura do projeto, limitações conhecidas do MVP. Cada comando documentado (`docker compose build/up/down`, `docker compose run --rm monitor <script>`) foi validado rodando de verdade antes de ser escrito, não só copiado de memória.
- **Log Monitor** (`src/monitoring/log-monitor.ts`, classe `LogMonitor`). Diferente do HTTP Monitor (stateless), o Log Monitor precisa manter estado *entre* chamadas (offset de leitura, inode do arquivo) — a interface `TargetChecker = (target) => Promise<CheckResult>` do Scheduler não previa isso. Resolvido com o mesmo padrão do `StateStore`: uma classe com `Map<targetId, LogReadState>` interno. `dispatch.ts` virou `createDispatcher()`, uma factory que instancia o `LogMonitor` uma vez e devolve a função `TargetChecker` — `index.ts` e os testes foram ajustados de acordo.
  - Lê o arquivo incrementalmente (`fs.open` + `read` a partir do offset salvo, nunca o arquivo inteiro), corta a leitura no último byte `0x0a` (`\n`) completo — nunca em nível de caractere, então nunca corta um caractere UTF-8 multi-byte no meio, mesmo que o boundary de leitura caia lá; uma linha sem `\n` final é deixada para o próximo ciclo.
  - Detecta rotação/recriação comparando `stats.ino` entre checks; detecta truncamento quando `stats.size < offset salvo`; em ambos os casos, reseta o offset para 0 e processa o conteúdo do arquivo "novo" normalmente (diferente da primeira leitura, ver abaixo). Confirmado empiricamente (script `tsx` descartável) que `stats.ino` muda ao recriar um arquivo mesmo neste ambiente Windows, então os testes locais são confiáveis mesmo sem rodar em Linux.
  - **Na primeira vez que um target é visto** (sem estado salvo), o Log Monitor não processa o conteúdo já existente — só registra a posição atual e passa a processar dali em diante (comportamento `tail -f`, não `cat`). Decisão deliberada: sem isso, ligar o monitor pela primeira vez num log com histórico geraria alertas retroativos de erros antigos/já resolvidos.
  - Arquivo ausente ou sem permissão de leitura retorna `CheckResult` de falha com mensagem categorizada (`"log file not found"`, `"permission denied reading log file"`), nunca lança exceção — consistente com o padrão do HTTP Monitor. O `path` nunca aparece na mensagem de erro (mesma cautela de segurança já aplicada em outros monitores).
  - Linha correspondente truncada a 500 caracteres antes de virar `metadata.matchedLine` — ver risco de segurança documentado abaixo e no README.
  - 11 testes (`tests/log-monitor.test.ts`): comportamento tail-f na primeira leitura, detecção de match em linha nova, sem match não reporta nada, múltiplos matches num único ciclo, linha parcial (sem `\n`) não processada até completar, nunca relê linha já processada, truncamento, rotação/recriação, arquivo inexistente, arquivo que aparece depois de ausente, isolamento entre targets.
- **Achado de design real durante a validação de integração via Docker** (não um bug de implementação — a lógica do Log Monitor em si estava correta desde a primeira tentativa, 11/11 testes passando de cara): reaproveitar a máquina de estados `UNKNOWN → UP → DOWN` do State Store (pensada para HTTP, onde "sucesso" = "serviço no ar continuamente") não se encaixa na semântica de um log, onde "sem match neste ciclo" é o normal na maioria dos ciclos — mesmo logo depois de notificar um erro. Resultado: toda linha de erro isolada gerava um ciclo `DOWN` → `RECOVERED` no ciclo seguinte (já que não há mais match a partir do momento em que a linha foi processada), duplicando notificações para o mesmo evento. Confirmado ao vivo dentro do Docker com um arquivo montado via volume `:ro`. A própria arquitetura já previa a solução: `AlertEvent` sempre teve `LOG_MATCH` como um tipo de evento à parte de `DOWN`/`RECOVERED` (`docs/ARCHITECTURE.md`, seção 18) — só não tinha sido implementado ainda porque o Log Monitor não existia. Corrigido:
  1. Novo tipo `LOG_MATCH` em `AlertEvent` (`src/types/index.ts`), com `LogCheckMetadata` movido de `log-monitor.ts` para lá (tipo compartilhado entre o monitor e a Alert Policy, análogo a `CheckResult`).
  2. `evaluateAlert` ganhou um parâmetro `result: CheckResult` e ramifica por `target.type === "log"` logo no início: um match gera `LOG_MATCH` imediatamente (respeitando `cooldownSeconds` entre matches, para não floodar em caso de várias linhas de erro em sequência), e a transição `DOWN`/`RECOVERED` do State Store é **completamente ignorada** para esse tipo — nunca gera `DOWN` nem `RECOVERED` para um log target, mesmo que o State Store reporte uma transição internamente (`consecutiveFailures`/`status` do `MonitorState` continuam sendo atualizados normalmente, só não alimentam mais mensagens de alerta HTTP-shaped).
  3. Consequência aceita e documentada (README): `failureThreshold`/`recoveryThreshold` são efetivamente ignorados para targets `log` — um match sempre notifica na primeira ocorrência (não faz sentido "confirmar" um erro de log com múltiplas ocorrências consecutivas do mesmo jeito que faz sentido para uma falha de rede).
  4. Discord Notifier ganhou `buildLogMatchEmbed` (🟠 "Log Pattern Matched", campos Service/Matches/Detected at/Pattern/Line).
  - Retestado ao vivo no mesmo cenário Docker que revelou o bug: uma linha ERROR agora gera exatamente 1 tentativa de notificação em 12s (6 ciclos de check), não mais o flapping `DOWN`→`RECOVERED`. Uma segunda linha de erro pouco depois foi corretamente suprimida pelo cooldown (900s configurado, ~17s decorridos) — confirma que o cooldown entre matches distintos também funciona.
  - Testes atualizados/adicionados: `evaluateAlert` ganhou 4 testes novos para o caminho `log` (`tests/alert-policy.test.ts`, agora 20 testes no arquivo), `sendAlertToDiscord` ganhou 2 testes para o embed `LOG_MATCH` (`tests/discord-notifier.test.ts`, agora 11), `dispatch.test.ts` teve seu teste de log atualizado para confirmar o dispatch real (antes testava só o erro "not implemented").
- **Host Monitor implementado** (`src/monitoring/host-monitor.ts`, classe `HostMonitor`), consultando um Node Exporter via HTTP (nunca lê `/proc`/`/sys` do próprio container, conforme `docs/ARCHITECTURE.md` seção 16 exige explicitamente). Antes de implementar, pausei para alinhar com o usuário uma decisão de infraestrutura real: adicionar o Node Exporter como serviço no `docker-compose.yml` (escolhido) vs. deixar totalmente fora do escopo. Peças:
  - **`src/config/schema.ts`**: `HostTarget` ganhou `metricsUrl` (obrigatório, validado como URL) e `diskMountpoint` (opcional, default `"/"`). Também resolvida a dívida técnica registrada na etapa do Config Loader ("host target sem nenhum threshold é aceito mas nunca alerta"): agora rejeitado com erro claro quando `enabled: true` e nenhum dos três thresholds está definido.
  - **`src/monitoring/prometheus-parser.ts`** (função pura, sem estado): `parsePrometheusText()` faz parsing do formato de exposição de texto do Prometheus (linha por linha, ignora comentários/linhas vazias, extrai `metric_name{labels} value`, suporta notação científica). `findSample`/`findSamples` para consultar por nome + filtro de labels. 8 testes com uma fixture realista baseada no formato real do node_exporter.
  - **`src/monitoring/network-errors.ts`** (novo): extraí `describeFetchFailure` (categoriza timeout/DNS/connection refused/TLS) de `http-monitor.ts` para um módulo compartilhado, já que o Host Monitor precisava exatamente da mesma lógica — duplicar teria sido um retrocesso real. `http-monitor.ts` atualizado para importar dali; nenhum teste quebrou.
  - **`HostMonitor.checkTarget`**: busca o texto do Node Exporter (timeout via `AbortController`, mesmo padrão do HTTP Monitor), faz o parsing, e calcula: memória e disco a partir de valores instantâneos (`node_memory_MemTotal_bytes`/`MemAvailable_bytes`, `node_filesystem_size_bytes`/`avail_bytes` filtrado por `diskMountpoint`); CPU a partir do **delta entre duas leituras sucessivas** de `node_cpu_seconds_total` (é um contador cumulativo desde o boot, não um valor instantâneo — soma todos os cores/modos, calcula `1 - (delta idle / delta total)`). Por isso a classe mantém estado interno (`Map<targetId, CpuSnapshot>`, mesmo padrão do `LogMonitor`) e `cpuPercent` fica `undefined` no primeiro check de cada target (sem baseline ainda). `success: false` quando qualquer métrica configurada excede seu threshold. 9 testes (`tests/host-monitor.test.ts`) com um servidor HTTP local servindo texto Prometheus controlável — cobrindo cálculo de memória/disco, ausência de CPU na primeira leitura, cálculo correto do delta de CPU na segunda, threshold excedido, todos os thresholds normais, `diskMountpoint` customizado, connection refused, status HTTP não-OK, isolamento de baseline de CPU entre targets.
  - **Alert Policy**: ao contrário do Log Monitor, aqui a decisão foi **reaproveitar** a máquina de estados `UP`/`DOWN` do State Store (não criar um caminho totalmente à parte) — "CPU alta" é um estado contínuo que pode persistir e se recuperar, semanticamente muito mais parecido com "serviço fora do ar" do que com "linha de log apareceu". `evaluateAlert` ganhou um terceiro branch (`target.type === "host"`): transição para `DOWN` gera `HOST_THRESHOLD` (não `DOWN`) imediatamente; transição `DOWN → UP` gera `RECOVERED` (tipo reaproveitado); reminders durante um threshold persistente respeitam `cooldownSeconds` igual ao HTTP. 4 testes novos.
  - **Discord Notifier**: `buildHostThresholdEmbed`, seguindo o formato exato documentado no blueprint (🟠 "Host threshold exceeded", campos Service/CPU/Memory/Disk/Detected at, métricas ausentes mostradas como "unknown"). 2 testes novos.
  - **`docker-compose.yml`**: serviço `node-exporter` (`prom/node-exporter:v1.8.2`), com os volumes/flags padrão para expor métricas do host (`/proc`, `/sys`, `/` montados read-only), sem porta publicada (acessível só via rede interna do compose, nome do serviço `node-exporter:9100`).
  - **Achado empírico real durante a validação de integração**: rodando o Node Exporter de verdade via `docker compose up -d node-exporter` e inspecionando `/metrics` (container `curlimages/curl` na mesma rede), confirmei que em Docker Desktop no Windows o "host" que o Node Exporter enxerga é a VM interna do Docker Desktop (WSL2), não o Windows físico — e essa VM **não tem um mountpoint `/` tradicional** (tem `/tmp`, `/var`, `/run`, `/mnt/docker-desktop-disk`, etc., mas nenhum listado como `mountpoint="/"`). Isso não é um bug do projeto — é assim que o Docker Desktop funciona — mas o default `diskMountpoint: "/"` não funciona out-of-the-box nesse ambiente específico. Documentado com destaque no README (com o comando exato para listar mountpoints disponíveis) para não confundir quem testar localmente no Windows/Mac; em produção (host Linux real), `/` funciona normalmente.
  - **Validação de integração real** (não só `npm test`): subi o stack completo via `docker compose up -d --build` com um host target real (`cpuThresholdPercent: 0.01`, para garantir que o threshold seria excedido de imediato) apontando para `http://node-exporter:9100/metrics` e `diskMountpoint: "/tmp"` (mountpoint real disponível no ambiente). Confirmado: o Monitora conectou ao Node Exporter real, calculou as métricas, gerou `HOST_THRESHOLD`, e tentou notificar (falhou com webhook fake, como esperado). Esperei ~23s (7+ ciclos de 3s) e confirmei exatamente 1 tentativa de alerta — cooldown respeitado, sem o problema de flapping que apareceu no Log Monitor (confirma que reaproveitar DOWN/RECOVERED foi a decisão certa aqui). `docker compose down` do stack completo (monitor + node-exporter) em ~1s, sem precisar do timeout forçado. `.env`/`config/targets.json` reais restaurados ao final.
- **Estrutura de diretórios corrigida para bater com `docs/PROJECT_BLUEPRINT.md` (seção 6) e `docs/ARCHITECTURE.md` (seção 25)**, a pedido do usuário após uma auditoria de conformidade. Ambos os documentos especificam, de forma idêntica, `src/logs/log-monitor.ts` e `src/system/host-metrics.ts` — eu tinha colocado os dois em `src/monitoring/` (com o nome `host-monitor.ts` em vez de `host-metrics.ts`) sem nunca ter checado contra a árvore documentada nem registrado isso como uma decisão consciente. Corrigido: `git mv src/monitoring/log-monitor.ts src/logs/log-monitor.ts`, `git mv src/monitoring/host-monitor.ts src/system/host-metrics.ts` (a classe continua se chamando `HostMonitor` — só o arquivo mudou de nome), `git mv tests/host-monitor.test.ts tests/host-metrics.test.ts`, e `dispatch.ts` atualizado para os novos caminhos. `network-errors.ts` e `prometheus-parser.ts` continuam em `src/monitoring/` (não são módulos de monitor específico, são utilitários compartilhados — não fazia sentido movê-los, e a doc não pede isso). `alert-policy.ts`/`dispatch.ts` também continuam em `src/monitoring/`: são peças centrais do pipeline (mencionadas no fluxo arquitetural principal), não específicas de um tipo de monitor, e a árvore documentada não lista um arquivo dedicado para elas — mantê-las ali é a leitura mais razoável. 124/124 testes continuaram passando sem nenhuma mudança de lógica, apenas de localização/imports; rebuild limpo de `dist/` necessário (o `tsc` não remove arquivos órfãos de localizações antigas automaticamente) e Docker revalidado do zero.

## In Progress

- Nenhuma tarefa em andamento.

## Next Steps

- Único item pendente do roadmap documentado: o Discord Bot (`/status`, lê o `StateStore` sem rodar healthchecks — ver `docs/ARCHITECTURE.md` seção 19). Vai exigir decisões novas: `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`DISCORD_GUILD_ID` (já reservadas no `.env.example` mas nunca usadas) precisam ser lidas de verdade, registro de slash command, e um processo de longa duração adicional (o bot) rodando junto do scheduler dentro do mesmo container — pensar se isso cabe no mesmo `index.ts` ou precisa de outra estrutura.

Nenhum desses itens foi iniciado — devem ser tratados como tarefas incrementais separadas, uma de cada vez, conforme o protocolo definido em `CLAUDE.md`.

## Blockers

- Nenhum bloqueio técnico. O Docker Desktop precisou ser iniciado manualmente no começo da sessão de preparação do ambiente; numa sessão seguinte, com o Docker Desktop já rodando, `docker compose up` (não só `build`) foi validado com sucesso, incluindo hot-reload dentro do container.

## Technical Notes

- O projeto usa ESM nativo (`"type": "module"` no `package.json`) com `module`/`moduleResolution` `NodeNext` no TypeScript. Isso significa que futuras importações relativas entre arquivos `.ts` devem referenciar a extensão `.js` (ex.: `import { x } from "./foo.js"`, mesmo o arquivo fonte sendo `foo.ts`). Esse é o padrão oficial do TypeScript para NodeNext e já foi validado em `tests/resolve-monitor-name.test.ts`, que importa `../src/index.js`.
- Testes usam o test runner nativo do Node (`node:test`) executado via `tsx --test`, sem adicionar Jest/Vitest como dependência — decisão alinhada com a regra de evitar dependências desnecessárias. O script `test` usa explicitamente o glob `"tests/**/*.test.ts"` porque passar apenas o diretório `tests/` para `tsx --test` falhou nesta versão/plataforma (`ERR_UNSUPPORTED_DIR_IMPORT` no Node 24 local via tsx). Isso está documentado aqui para não ser "redescoberto" como bug em uma sessão futura.
- Dockerfile usa `node:22-alpine` (tag flutuante dentro da major 22) em vez de um patch fixo (ex.: `node:22.23.2-alpine3.24`, como no exemplo do blueprint). Decisão consciente para evitar depender de uma tag de patch específica que pode deixar de existir; caso o time prefira reprodutibilidade estrita, é possível fixar depois.
- `src/commands/` (para o futuro `status.ts` do Bot) ainda não existe — é o único diretório da árvore documentada que falta, e só faz sentido criá-lo junto com a primeira implementação real dele (regra de não criar diretórios vazios só para preencher). Todos os outros (`src/config/`, `src/discord/`, `src/logs/`, `src/monitoring/`, `src/system/`, `src/types/`) já existem e batem com a estrutura documentada.
- `loader.ts` valida a *presença* das variáveis de ambiente referenciadas por targets habilitados, mas não resolve o valor final (não transforma `urlEnv` em `url`, nem lê o valor real do webhook). Decisão: a arquitetura atribui explicitamente a "resolução do webhook configurado" ao Discord Notifier (`docs/ARCHITECTURE.md`, seção 18); por simetria, a resolução de `url`/`urlEnv` fica para o HTTP Monitor. O Config Loader só garante fail-fast no startup se uma env var referenciada por um target habilitado não existir.
- `checkHttpTarget` usa `fetch(url, { redirect: "manual" })` em vez do padrão (`"follow"`). Confirmado empiricamente (script `tsx` descartável) que, diferente do comportamento de browser (onde `redirect: "manual"` zera o status por privacidade cross-origin), no Node/undici o `response.status` real (302, etc.) fica visível com `redirect: "manual"`. Isso é necessário porque a arquitetura lista "3xx" como um caso relevante que o HTTP Monitor deve tratar — com `redirect: "follow"` (padrão) nunca veríamos um 3xx, só o status final após seguir a cadeia.
- `checkHttpTarget` nunca inclui a URL bruta do target nas mensagens de erro (`error` do `CheckResult`), só uma categoria (`"DNS resolution failed"`, `"connection refused"`, `"TLS handshake failed"`, `"request timed out after Xms"`, ou o fallback genérico `"request failed"`). Decisão de segurança: a URL pode conter credenciais embutidas ou ser uma URL interna sensível, e a arquitetura exige sanitizar esse tipo de informação antes de logar ou mandar pro Discord (`docs/ARCHITECTURE.md`, seção 23).
- Ao testar a categorização de erro de conexão, o primeiro teste usava `http://127.0.0.1:1` (porta 1) esperando `ECONNREFUSED`, mas o `fetch`/undici bloqueia portas "inseguras" (a mesma lista de "forbidden ports" dos browsers) antes mesmo de tentar conectar, lançando `cause: Error("bad port")` sem `.code`. Isso caía no fallback genérico `"request failed"` — funcionalmente correto (`success: false`), mas a categorização ficava errada. Corrigido usando uma porta alta válida (`59999`) sem nada escutando, que gera o `ECONNREFUSED` real esperado. Documentado aqui porque não é óbvio e pode confundir uma sessão futura mexendo nesses testes.
- O `Scheduler` trabalha diretamente com o tipo `Target` (união `HttpTarget | LogTarget | HostTarget` de `src/config/schema.ts`) em vez de ser genérico (`<T>`). Decisão consciente: o Scheduler sempre vai lidar com targets vindos da configuração do Monitora, não há requisito real para generalizar além disso — generics aqui seriam abstração sem benefício concreto (regra do CLAUDE.md contra abstração prematura).
- `Scheduler.stop()` usa `AbortController.abort()` para interromper apenas a espera (`delay` entre execuções), nunca o check em andamento — abortar um check no meio poderia deixar o HTTP Monitor (ou um monitor futuro) em estado inconsistente. Isso é o que permite "parar novos checks; aguardar operações em andamento quando possível" (regra de graceful shutdown) sem sacrificar a resposta rápida do `stop()`.
- **Decisão revertida na integração final** (ver "Recent Changes" para o bug real que motivou isso): `recordAlertSent()` é chamado assim que `deliverAlert` decide enviar um `AlertEvent`, **antes** de saber se `sendAlertToDiscord` teve sucesso — não depois, como planejado originalmente na etapa da Alert Policy. A ideia original (marcar só após sucesso, para não perder uma tentativa por causa de uma falha transitória) parecia mais correta na teoria, mas na prática, testando com uma falha de entrega *persistente*, isso fazia o sistema ignorar o cooldown por completo (retry a cada ciclo de check). Marcar `lastAlertAt` de forma otimista é mais simples e realmente cumpre "prevenir flooding" — o trade-off aceito é que uma falha de entrega isolada só será re-tentada no próximo `cooldownSeconds`, não imediatamente. A mensagem de erro continua sendo logada (`console.error`) para visibilidade, então a falha não é silenciosa.
- `process.on("SIGTERM"/"SIGINT", ...)` **não mantém o event loop do Node vivo por si só**. Sem nenhum target habilitado (ou, de forma mais geral, sem nenhum handle/timer ativo), o processo encerra naturalmente assim que o event loop esvazia — mesmo com os listeners de sinal registrados. `keepProcessAlive()` em `src/index.ts` existe só para isso: um `setInterval` de ~24.8 dias (`2_147_483_647`ms, o teto de um timeout de 32 bits) que nunca dispara de verdade, limpo (`clearInterval`) no `shutdown()`.
- **Testar sinais (SIGTERM/SIGINT) no host Windows não é confiável.** `child_process.kill("SIGTERM")` no Windows força terminação incondicional do processo alvo — é uma limitação documentada do próprio Node.js, não um bug do projeto (Windows não tem sinais POSIX nativos, e o Node só emula isso parcialmente). O shutdown gracioso só foi validado de verdade dentro do container Docker (Linux), via `docker stop`/`docker compose down`, onde sinais funcionam normalmente. Registrado aqui para não ser "redescoberto" numa sessão futura tentando testar sinais direto no host.
- **Resolvido** (era uma limitação conhecida registrada antes do Host Monitor existir): um host target sem nenhum dos três campos de threshold agora é rejeitado pelo schema quando `enabled: true` (ver "Completed" — etapa do Host Monitor).
- O ambiente de validação local tinha Node.js, npm e Docker instalados no host (usados para gerar `package-lock.json` e rodar as validações mais rápido), mas o projeto continua desenhado para não exigir Node/npm no host — tudo roda também via Docker, como validado nesta sessão.
- `tsx watch` (usado em `npm run dev`) depende de `chokidar` para detectar mudanças de arquivo. Em bind mounts do Docker Desktop no Windows, eventos de sistema de arquivos (inotify) nem sempre se propagam para dentro do container — o hot-reload silenciosamente não disparava, apesar do arquivo já estar atualizado dentro do container (confirmado com `docker compose exec monitor cat src/index.ts`). Corrigido setando `CHOKIDAR_USEPOLLING: "true"` no `environment` do serviço `monitor` em `docker-compose.yml`. Validado com um teste real de edição de arquivo: o container detectou a mudança e reiniciou o processo (`tsx` logou `change in ./src/index.ts Rerunning...`).
- **Tensão real e consciente com a Rule 6 da arquitetura** (`docs/ARCHITECTURE.md`, seção 28: *"State Store and Alert Policy should not depend on HTTP-specific, log-specific, or host-specific implementation details"*), encontrada numa auditoria pedida pelo usuário: `alert-policy.ts` tem `if (target.type === "log")` / `if (target.type === "host")` e importa `LogCheckMetadata`/`HostCheckMetadata` — ela sabe da existência desses tipos e tem lógica dedicada para cada um. Isso não é descuido; é uma tensão inerente entre duas regras da própria doc: os Monitors só podem retornar `CheckResult` genérico (não sabem nada de "tipos de alerta"), mas a arquitetura também define 4 tipos de `AlertEvent` estruturalmente diferentes (`DOWN`/`RECOVERED`/`LOG_MATCH`/`HOST_THRESHOLD`) — alguém precisa decidir qual gerar, e só a Alert Policy tem informação suficiente pra isso. Não encontrei uma forma de satisfazer as duas regras 100% sem inventar uma abstração nova só para isso (o que seria abstração prematura, contra a regra 9 do `CLAUDE.md`). Registrado aqui para transparência; revisitar se um dia parecer que vale a pena resolver de verdade.

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
- Ligado `src/index.ts` ao núcleo completo (`src/monitoring/dispatch.ts` novo, 3 testes). Validação foi além de `npm test`: rodei o processo de verdade dentro do Docker, com um target HTTP real apontando para um servidor de teste no host (`host.docker.internal`), e depois derrubei esse servidor para forçar uma falha real. Essa validação (não só testes unitários) encontrou 2 bugs reais, ambos corrigidos:
  1. **O processo morria sozinho segundos após iniciar quando `config.targets` está vazio** (exatamente o estado atual de `config/targets.json`). Sem nenhum target habilitado, o `Scheduler` não cria nenhum timer, e nada mais mantém o event loop do Node vivo — os listeners de `SIGTERM`/`SIGINT` sozinhos não seguram o processo. O container saía com exit code 0 silenciosamente, sem nunca esperar um sinal de verdade. Corrigido com um `setInterval` "heartbeat" (`keepProcessAlive`, ~24.8 dias, nunca dispara de verdade) que mantém o processo vivo até `shutdown()` limpar o timer.
  2. **Cooldown completamente ignorado durante uma falha persistente de entrega ao Discord.** A decisão registrada na etapa da Alert Policy era marcar `lastAlertAt` só após confirmação de sucesso do envio — mas isso significa que, se o envio *sempre* falhar (webhook inválido, Discord fora do ar por um período longo), `lastAlertAt` nunca é setado, e a Alert Policy trata cada novo check como "nunca alertei ainda", tentando reenviar a **cada ciclo de check** (a cada `intervalSeconds`, não a cada `cooldownSeconds`) — na prática, sem cooldown nenhum. Confirmado ao vivo: 5 tentativas em ~15s com um webhook fake. Corrigido revertendo a decisão: `recordAlertSent` agora é chamado assim que o alerta é **decidido**, não quando é **entregue com sucesso**. Retestado no mesmo cenário: exatamente 1 tentativa em 15s (o esperado, já que `cooldownSeconds` era 900).
- Criado `README.md`. Cada comando documentado nele foi validado rodando de verdade (`docker compose build/up/down`, `docker compose run --rm monitor npm run typecheck`, `docker compose run --rm monitor npm test`), não só descrito de memória. Aproveitado para remover uma entrada desatualizada em "Next Steps" (mencionava "montar o cabo em `src/index.ts`... hoje nada disso está conectado ainda", que já tinha sido concluído numa etapa anterior e não tinha sido removida).
- Implementado o Log Monitor (`src/monitoring/log-monitor.ts`, 11 testes) e `createDispatcher()` (antes `checkTarget` livre) para acomodar seu estado interno. Validação de integração real via Docker com um arquivo de log montado via volume `:ro` (o cenário documentado na arquitetura) revelou um problema real de design — reaproveitar a máquina de estados DOWN/RECOVERED do HTTP para logs gerava um ciclo de flapping DOWN→RECOVERED a cada linha de erro isolada. Corrigido implementando o tipo de evento `LOG_MATCH` que a arquitetura já prevía mas nunca tinha sido implementado: `evaluateAlert` agora ramifica por `target.type`, ignorando completamente a transição DOWN/RECOVERED do State Store para targets `log` (que passam a nunca gerar DOWN/RECOVERED, só LOG_MATCH). Discord Notifier ganhou o embed correspondente. Retestado ao vivo no mesmo cenário: 1 notificação por evento de erro, cooldown respeitado entre matches distintos. README e config/targets.json real restaurados sem alterações permanentes de teste.
- Antes de implementar o Host Monitor, pausei para alinhar com o usuário: adicionar o Node Exporter ao `docker-compose.yml` (escolhido) vs. deixar de fora. Implementado `src/monitoring/host-monitor.ts` (classe `HostMonitor`, consulta HTTP a um Node Exporter, nunca lê `/proc`/`/sys` do container), `src/monitoring/prometheus-parser.ts` (parser do formato de exposição do Prometheus, função pura, 8 testes), e `src/monitoring/network-errors.ts` (extraído de `http-monitor.ts` para compartilhar a categorização de erros de rede com o novo monitor, evitando duplicação). Schema (`HostTarget`) ganhou `metricsUrl`/`diskMountpoint`, e a dívida técnica de "host target sem threshold nunca alerta" foi resolvida com uma validação explícita. Diferente do Log Monitor, a Alert Policy para `host` **reaproveita** a máquina de estados DOWN/RECOVERED (decisão consciente: "CPU alta" é um estado contínuo que se recupera, ao contrário de uma linha de log) — só troca o tipo do evento de `DOWN` para `HOST_THRESHOLD`. Discord Notifier ganhou o embed correspondente, no formato exato do blueprint. Validação de integração real com o Node Exporter rodando de verdade via `docker compose up -d node-exporter` revelou que, em Docker Desktop no Windows, a VM interna do Docker Desktop não tem um mountpoint `/` tradicional — documentado no README com o comando exato para investigar isso em qualquer ambiente. Retestado o stack completo (monitor + node-exporter reais) com `diskMountpoint: "/tmp"`: `HOST_THRESHOLD` disparado corretamente, exatamente 1 tentativa em ~23s (cooldown respeitado, sem o flapping que apareceu no Log Monitor). `.env`/`config/targets.json` reais restaurados ao final.

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
# OK — 124 testes passaram (tsx --test "tests/**/*.test.ts"): 3 resolve-monitor-name, 18 config-schema,
# 5 config-loader, 8 http-monitor, 9 scheduler, 16 state-store, 21 alert-policy, 13 discord-notifier,
# 3 dispatch, 11 log-monitor, 9 host-monitor, 8 prometheus-parser (mock nativo do node:test onde
# aplicável, sem Discord real, sem rede externa — host-monitor usa um servidor HTTP local servindo
# texto Prometheus controlável, não o Node Exporter real).
# Suíte completa rodada 3x seguidas para checar flakiness de timing nos testes do Scheduler — estável nas 3.
# Confirmado que importar src/index.ts (para tests/resolve-monitor-name.test.ts) não dispara mais o
# bootstrap real (carregar config, iniciar scheduler) — a mensagem de log de startup não vaza mais no
# output de "npm test" desde a correção do bug de efeito colateral no import.

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

# --- após ligar src/index.ts ao núcleo (validação de integração real, não só npm test) ---

docker run -d --name <teste> monitora-production
# BUG #1 encontrado: container saía sozinho (exit 0) segundos após iniciar, com targets: [] (estado real
# do projeto). Corrigido com keepProcessAlive(). Retestado: container ficou "Up" indefinidamente.

docker stop <teste>   /   docker compose down
# OK, após a correção: "received SIGTERM, shutting down" aparece no log, container para em <1s
# (não precisa do timeout de 10s + SIGKILL forçado do Docker).

# Target HTTP real habilitado (intervalSeconds: 3) apontando para um servidor de teste no host
# (host.docker.internal, --add-host=host.docker.internal:host-gateway), com SMOKE_TEST_WEBHOOK
# apontando para um webhook Discord fake (formato válido, id/token inexistentes de verdade):
#   - servidor de teste no ar: requests chegando a cada 3s, confirmado no log do servidor de teste.
#   - servidor de teste derrubado (taskkill): após failureThreshold, "failed to deliver alert..." aparece.
#   - BUG #2 encontrado: 5 tentativas de alerta em ~15s, mesmo com cooldownSeconds=900 (o cooldown
#     estava sendo ignorado por completo durante falha persistente de entrega). Corrigido revertendo
#     quando recordAlertSent() é chamado (ver "Technical Notes"). Retestado: exatamente 1 tentativa em 15s.
# config/targets.json real (targets: []) restaurado ao final; nenhuma alteração permanente.

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/index.ts (ligado) e src/monitoring/dispatch.ts novo.

# --- após criar o README.md ---

docker compose run --rm monitor npm run typecheck
# OK — comando exatamente como documentado no README funciona.

docker compose run --rm monitor npm test
# OK — 79/79 testes passando também via docker compose run (não só localmente).

# --- após implementar o Log Monitor e corrigir o achado de design LOG_MATCH ---

npx tsx <script descartável>
# OK — confirmado empiricamente que stats.ino muda ao recriar um arquivo neste ambiente Windows,
# antes de escrever os testes que dependem disso.

npm run typecheck && npm run build && npm test
# OK — 97/97 testes, incluindo os 11 novos do Log Monitor passando de primeira (11/11 na primeira
# execução, sem precisar de correções).

docker build --target production -t monitora-production .
docker run -d --name <teste> -v "<dir-host>:/var/log/monitored:ro" -e SMOKE_TEST_WEBHOOK=<webhook fake> monitora-production
# Target log real (path: /var/log/monitored/app.log, intervalSeconds: 3, failureThreshold: 1) escrevendo
# no arquivo do HOST e observando o container:
#   - ACHADO DE DESIGN (não bug de implementação): 1ª rodada, escrevi uma linha ERROR e vi DUAS
#     tentativas de "failed to deliver alert" em 5s — o State Store confirmava DOWN no ciclo com match
#     e RECOVERED no ciclo seguinte (sem mais match, já que o offset já tinha avançado), gerando
#     flapping a cada linha de erro isolada. Corrigido implementando LOG_MATCH (ver "Recent Changes").
#   - Retestado do zero após a correção: uma linha ERROR gera exatamente 1 tentativa de notificação em
#     12s (6 ciclos). Uma segunda linha de erro ~17s depois foi corretamente suprimida pelo cooldown
#     (900s configurado) — confirma que o cooldown entre matches distintos também funciona.
# Diretório de log temporário e container de teste removidos ao final; config/targets.json real
# restaurado sem alterações permanentes.

docker compose build && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/log-monitor.ts novo e o dispatch atualizado.

# --- após implementar o Host Monitor e o serviço node-exporter no compose ---

docker compose config
# OK — sintaxe válida com o novo serviço node-exporter (imagem prom/node-exporter:v1.8.2, volumes
# read-only de /proc, /sys e /, sem porta publicada).

docker compose up -d node-exporter
docker run --rm --network monitora_default curlimages/curl:latest -s http://node-exporter:9100/metrics
# OK — Node Exporter real respondendo métricas reais. node_cpu_seconds_total e
# node_memory_Mem{Total,Available}_bytes presentes como esperado.
# ACHADO: node_filesystem_size_bytes/avail_bytes NUNCA aparece com mountpoint="/" neste ambiente
# (Docker Desktop/Windows) — a VM interna do Docker Desktop não expõe um "/" tradicional (tem /tmp,
# /var, /run, /mnt/docker-desktop-disk, etc.). Não é um bug; documentado no README com o comando
# exato usado aqui para diagnosticar isso em qualquer ambiente.

docker compose up -d --build
# Stack completo (monitor real + node-exporter real) com um host target real
# (metricsUrl: http://node-exporter:9100/metrics, diskMountpoint: /tmp, cpuThresholdPercent: 0.01
# para garantir excedência imediata, discordWebhookEnv apontando para um webhook fake):
#   - "loaded 1 target(s), 1 enabled" confirmado no log.
#   - "failed to deliver alert... HOST_THRESHOLD" apareceu (webhook fake, como esperado) — confirma
#     que o Monitora conectou ao Node Exporter real, calculou métricas reais e decidiu alertar.
#   - Esperado ~23s (7+ ciclos de 3s): exatamente 1 tentativa de alerta, não repetida — cooldown
#     respeitado, sem o flapping que apareceu na etapa do Log Monitor (confirma que reaproveitar a
#     máquina de estados DOWN/RECOVERED foi a decisão correta para host, diferente de log).

docker compose down
# OK — stack completo (monitor + node-exporter) parado em ~1s, sem precisar do timeout de 10s.
# .env e config/targets.json reais restaurados ao final; nenhuma alteração permanente de teste.

npm run typecheck && npm run build && npm test
# OK — 124/124 testes.

docker compose build monitor && docker build --target production -t monitora-production .
# OK — ambas as imagens reconstruídas com src/monitoring/host-monitor.ts, prometheus-parser.ts e
# network-errors.ts novos.
```

Script avulso rodado localmente (`tsx`, depois apagado) confirmando que `loadTargetsConfig()` aceita o `config/targets.json` real do projeto (`targets: []`) sem erros.

Todas as validações mínimas exigidas passaram, incluindo execução real via `docker compose up` (não só `build`), com um Node Exporter de verdade (não mockado) na validação final.
