# Monitora — Development Progress

## Current Status

Ambiente inicial validado (incluindo `docker compose up` real, não só `build`) e o repositório já está no GitHub (`origin/main`). O Config Loader e o schema de validação de `config/targets.json` foram implementados e testados. Scheduler, HTTP/Log/Host Monitor, State Store, Alert Policy e Discord Notifier ainda não existem.

## Current Task

Nenhuma tarefa em execução no momento. A implementação do Config Loader + schema foi concluída.

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

## In Progress

- Nenhuma tarefa em andamento.

## Next Steps

- Implementar o `HTTP Monitor` (`src/monitoring/http-monitor.ts`) retornando `CheckResult` normalizado (sucesso, erro HTTP, timeout, DNS/conexão recusada/TLS).
- Implementar o `Scheduler` (`src/monitoring/scheduler.ts`) respeitando `intervalSeconds` por target e evitando execuções concorrentes do mesmo target.
- Implementar o `State Store` em memória (`src/monitoring/state-store.ts`) com a máquina de estados `UNKNOWN → UP → DOWN` e cálculo de downtime.
- Somente depois disso, implementar a `Alert Policy` e o `Discord Notifier` com o envio real de embeds.

Nenhum desses itens foi iniciado — devem ser tratados como tarefas incrementais separadas, uma de cada vez, conforme o protocolo definido em `CLAUDE.md`.

## Blockers

- Nenhum bloqueio técnico. O Docker Desktop precisou ser iniciado manualmente no começo da sessão de preparação do ambiente; numa sessão seguinte, com o Docker Desktop já rodando, `docker compose up` (não só `build`) foi validado com sucesso, incluindo hot-reload dentro do container.

## Technical Notes

- O projeto usa ESM nativo (`"type": "module"` no `package.json`) com `module`/`moduleResolution` `NodeNext` no TypeScript. Isso significa que futuras importações relativas entre arquivos `.ts` devem referenciar a extensão `.js` (ex.: `import { x } from "./foo.js"`, mesmo o arquivo fonte sendo `foo.ts`). Esse é o padrão oficial do TypeScript para NodeNext e já foi validado em `tests/resolve-monitor-name.test.ts`, que importa `../src/index.js`.
- Testes usam o test runner nativo do Node (`node:test`) executado via `tsx --test`, sem adicionar Jest/Vitest como dependência — decisão alinhada com a regra de evitar dependências desnecessárias. O script `test` usa explicitamente o glob `"tests/**/*.test.ts"` porque passar apenas o diretório `tests/` para `tsx --test` falhou nesta versão/plataforma (`ERR_UNSUPPORTED_DIR_IMPORT` no Node 24 local via tsx). Isso está documentado aqui para não ser "redescoberto" como bug em uma sessão futura.
- Dockerfile usa `node:22-alpine` (tag flutuante dentro da major 22) em vez de um patch fixo (ex.: `node:22.23.2-alpine3.24`, como no exemplo do blueprint). Decisão consciente para evitar depender de uma tag de patch específica que pode deixar de existir; caso o time prefira reprodutibilidade estrita, é possível fixar depois.
- Não foram criados os diretórios `src/commands/`, `src/discord/`, `src/logs/`, `src/monitoring/`, `src/system/`, `src/types/` vazios (`src/config/` já existe, criado nesta etapa). Os demais serão criados quando a primeira implementação real de cada módulo for feita, conforme a regra de não criar arquivos vazios apenas para preencher diretórios.
- `loader.ts` valida a *presença* das variáveis de ambiente referenciadas por targets habilitados, mas não resolve o valor final (não transforma `urlEnv` em `url`, nem lê o valor real do webhook). Decisão: a arquitetura atribui explicitamente a "resolução do webhook configurado" ao Discord Notifier (`docs/ARCHITECTURE.md`, seção 18); por simetria, a resolução de `url`/`urlEnv` fica para o HTTP Monitor. O Config Loader só garante fail-fast no startup se uma env var referenciada por um target habilitado não existir.
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
# OK — 22 testes passaram (tsx --test "tests/**/*.test.ts"): 3 de src/index.ts (incluindo a regressão do bug
# de MONITOR_NAME vazio), 14 de src/config/schema.ts (incluindo os 2 achados da revisão: threshold > 100% e
# URL malformada), 5 de src/config/loader.ts.

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
```

Script avulso rodado localmente (`tsx`, depois apagado) confirmando que `loadTargetsConfig()` aceita o `config/targets.json` real do projeto (`targets: []`) sem erros.

Todas as validações mínimas exigidas passaram, incluindo execução real via `docker compose up` (não só `build`).
