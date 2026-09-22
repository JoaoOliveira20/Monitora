# Monitora

Monitora é uma pequena plataforma de monitoramento configurável: ela verifica serviços web, arquivos de log e métricas de host (CPU/RAM/disco), e envia alertas para o Discord quando algo muda de estado — tudo rodando via Docker, sem precisar de Node.js instalado no seu computador.

O objetivo é simples: monitorar múltiplos serviços sem precisar alterar código a cada novo serviço adicionado — tudo é configurado em um único arquivo JSON (`config/targets.json`).

## Sumário

- [Status atual do projeto](#status-atual-do-projeto)
- [Requisitos](#requisitos)
- [Como rodar](#como-rodar)
- [Configuração](#configuração)
  - [`.env`](#env)
  - [Configurando o Bot do Discord](#configurando-o-bot-do-discord)
  - [`config/targets.json`](#configtargetsjson)
- [Comandos](#comandos)
- [Segurança](#segurança)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Limitações conhecidas](#limitações-conhecidas-mvp)

## Status atual do projeto

O projeto está funcionalmente completo em relação ao que foi planejado originalmente:

- **Configuração dinâmica** de múltiplos targets (`config/targets.json`), sem precisar alterar código.
- **HTTP Monitor**: verifica serviços web (sucesso, erro HTTP, timeout, DNS, conexão recusada, TLS).
- **Log Monitor**: acompanha um arquivo de log incrementalmente (sem reler o arquivo inteiro a cada ciclo), procurando por padrões configuráveis; lida com rotação/truncamento/recriação do arquivo.
- **Host Monitor**: acompanha CPU, memória e disco de uma máquina através de um [Node Exporter](https://github.com/prometheus/node_exporter) (já incluso no `docker-compose.yml` deste projeto). Não lê `/proc`/`/sys` diretamente de dentro do container — isso daria métricas do container, não da máquina física.
- **Máquina de estados** por target (`UNKNOWN → UP → DOWN → UP`), com downtime calculado (para targets HTTP e Host).
- **Alertas via Discord** (webhook), com cooldown para não floodar o canal, e recuperação notificada separadamente.
- **Scheduler** que verifica cada target de forma independente, sem sobreposição, sem derrubar o processo por falha de um único serviço.
- **Bot do Discord com o comando `/status`**: mostra o estado atual conhecido de todos os targets, sem rodar nenhum healthcheck novo (lê só o que já está em memória — responde instantaneamente). Opcional: se `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` não estiverem configurados, o Monitora roda normalmente sem o bot, só sem o comando interativo.

Veja `docs/PROGRESS.md` para o histórico detalhado de desenvolvimento e decisões tomadas, e `docs/ARCHITECTURE.md` para a arquitetura completa.

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose
- Git

Não é necessário ter Node.js ou npm instalados no host — tudo roda dentro do container.

## Como rodar

```bash
git clone <url-do-seu-fork>
cd Monitora
cp .env.example .env
```

O `config/targets.json` do repositório vem com um target de exemplo **desativado** (`"enabled": false`, apontando para `https://example.com`) — edite-o (junto com o `.env`) conforme a seção [Configuração](#configuração) abaixo antes de usar de verdade. Depois:

```bash
docker compose build
docker compose up
```

O container fica rodando continuamente, verificando os targets configurados nos intervalos definidos. Para parar, `Ctrl+C` no terminal onde `docker compose up` está rodando (o processo trata `SIGTERM`/`SIGINT` e encerra de forma limpa), ou em outro terminal:

```bash
docker compose down
```

## Configuração

Dois arquivos precisam ser configurados antes do monitor ser útil de verdade: `.env` e `config/targets.json`. **Nenhum dos dois deve conter segredos reais commitados no Git** — o `.env` já está no `.gitignore`; o `config/targets.json` normalmente não tem segredos (as URLs de webhook ficam no `.env`), mas se você editar o seu localmente para testes e não quiser que essas mudanças vão para o seu fork, veja a dica no final desta seção.

### `.env`

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória? | Descrição |
|---|---|---|
| `NODE_ENV` | Não | `development` ou `production`. Já vem preenchida com `development`; o `Dockerfile` força `production` na imagem de produção. |
| `MONITOR_NAME` | Não | Nome exibido no log de inicialização e no `/status`. Se vazia, usa `"Monitora"`. |
| `DISCORD_WEBHOOK_MAIN` | Sim, se algum target usar esse nome | **Exemplo** de variável referenciada por um target no `config/targets.json` (campo `discordWebhookEnv`). O nome não é fixo — cada target aponta para a env var que quiser (veja abaixo). O valor é a URL completa do webhook do Discord (`Configurações do Canal → Integrações → Webhooks → Novo Webhook → Copiar URL`). |
| `DISCORD_WEBHOOK_URL` | Não | Reservada, não usada por nenhum código hoje — pode deixar em branco. |
| `DISCORD_TOKEN` | Não (só para o Bot `/status`) | Token do Bot do Discord. Sem ela (ou sem `DISCORD_CLIENT_ID`), o Monitora roda normalmente, só sem o comando `/status`. Veja [Configurando o Bot do Discord](#configurando-o-bot-do-discord) abaixo. |
| `DISCORD_CLIENT_ID` | Não (só para o Bot `/status`) | ID da aplicação do Discord (necessário para registrar o slash command). |
| `DISCORD_GUILD_ID` | Não | Se definida, o `/status` é registrado só nesse servidor (aparece em segundos). Se vazia, é registrado globalmente (pode levar até ~1h para propagar). O bot te ajuda a descobrir esse ID — veja o passo a passo abaixo. |

Você pode adicionar quantas variáveis `DISCORD_WEBHOOK_*` quiser, com o nome que preferir — o que importa é que o nome bata com o `discordWebhookEnv` do target correspondente em `config/targets.json`. Vários targets podem compartilhar o mesmo webhook.

**Nunca coloque a URL de um webhook diretamente no `config/targets.json` ou em qualquer arquivo versionado** — a URL do webhook contém um token secreto embutido nela mesma. Ela deve existir apenas no `.env` local (fora do Git).

### Configurando o Bot do Discord

O comando `/status` é opcional — sem ele, o Monitora continua enviando alertas via webhook normalmente. Você usa **sua própria conta** do Discord para criar e gerenciar o bot; não é preciso (nem dá) fazer login como o bot em si.

1. Vá em [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → dê um nome.
2. No menu **Bot** (lateral esquerda) → **Reset Token** → copie o token gerado para `DISCORD_TOKEN` no `.env`. **Trate esse token como uma senha**: quem o tiver pode controlar o bot.
3. No menu **General Information** → copie o **Application ID** para `DISCORD_CLIENT_ID`.
4. No menu **OAuth2 → URL Generator** → marque os escopos `bot` e `applications.commands` (nenhuma permissão de bot especial é necessária — `/status` só lê o estado em memória, não precisa de acesso a mensagens nem nada além de responder). Copie a URL gerada, abra no navegador, e escolha o servidor onde quer testar.
5. `docker compose up` (mesmo sem `DISCORD_GUILD_ID` preenchida ainda) — procure no log:
   ```
   Discord bot connected, /status command registered
   Connected to 1 guild(s): Nome do Seu Servidor (123456789012345678)
   ```
   **Copie esse ID** (o número entre parênteses) direto do log — é o jeito mais fácil, sem precisar mexer nas configurações do Discord.
6. Cole esse ID em `DISCORD_GUILD_ID` no `.env`, e rode `docker compose up` de novo (`.env` não recarrega sozinho como o código faz). Agora o `/status` é registrado só no seu servidor e aparece em segundos.

**Sem `DISCORD_GUILD_ID`, o comando ainda funciona**, só demora a aparecer no autocomplete do Discord (até ~1h, é o tempo normal de propagação de um comando global) — não é um erro. Se `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` faltarem ou forem inválidos, o Monitora loga isso claramente e continua rodando sem o bot — também não é um erro fatal.

### `config/targets.json`

Define **o que** deve ser monitorado e **como**. Adicionar ou remover um serviço não exige nenhuma alteração de código — só editar este arquivo.

O repositório já vem com um exemplo (desativado) para você copiar e adaptar:

```json
{
  "version": 1,
  "defaults": {
    "intervalSeconds": 60,
    "timeoutMs": 5000,
    "failureThreshold": 2,
    "recoveryThreshold": 1,
    "cooldownSeconds": 900
  },
  "targets": [
    {
      "id": "example-site",
      "name": "Example Site",
      "type": "http",
      "enabled": false,
      "url": "https://example.com",
      "discordWebhookEnv": "DISCORD_WEBHOOK_MAIN"
    }
  ]
}
```

- **`defaults`**: valores usados por qualquer target que não sobrescrever o campo individualmente.
- **`targets`**: lista de serviços monitorados. `"type": "http"`, `"type": "log"` e `"type": "host"` funcionam de verdade.

> **Testando localmente sem afetar o seu fork:** se você quiser editar `config/targets.json` com URLs/valores de teste sem correr o risco de commitar isso sem querer, rode `git update-index --skip-worktree config/targets.json` — o Git passa a ignorar mudanças nesse arquivo em qualquer `git add`/`commit`, mesmo em massa. Para reverter: `git update-index --no-skip-worktree config/targets.json`.

> **Mudou o `config/targets.json` com o container já rodando?** Diferente do código em `src/`, esse arquivo é lido só uma vez, na inicialização — editá-lo não reinicia o monitor sozinho. Rode `docker compose restart monitor` (ou `docker compose down && docker compose up`) para a mudança valer.

Campos comuns a todo target:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `id` | Sim | Identificador único do target (usado internamente para rastrear estado). |
| `name` | Sim | Nome legível, usado nas notificações e no `/status`. |
| `type` | Sim | `"http"`, `"log"` ou `"host"`. |
| `enabled` | Sim | `false` desativa o target sem precisar removê-lo do arquivo. |
| `intervalSeconds` | Não (usa `defaults`) | Intervalo entre checks, em segundos. |
| `timeoutMs` | Não (usa `defaults`) | Timeout do check, em milissegundos. |
| `failureThreshold` | Não (usa `defaults`) | Quantas falhas/excedências consecutivas até o target virar `DOWN` e disparar um alerta. **Só se aplica a targets `http` e `host`** — um target `log` notifica no primeiro match, sempre. |
| `recoveryThreshold` | Não (usa `defaults`) | Quantos sucessos consecutivos até um target `DOWN` virar `UP` novamente. **Só se aplica a targets `http` e `host`** — o conceito de "recuperação" não existe para `log` (um match de log é um evento pontual, não um estado contínuo). |
| `cooldownSeconds` | Não (usa `defaults`) | Tempo mínimo entre alertas repetidos enquanto o problema persiste: para `http`/`host`, entre lembretes de um serviço/threshold que continua `DOWN` (a notificação de recuperação não espera esse cooldown); para `log`, entre notificações de novos matches de padrão. |
| `discordChannelId` | Não | ID do canal do Discord. Não usado por nenhum código hoje — o `/status` responde no canal de onde foi chamado, e os alertas usam `discordWebhookEnv`, não este campo. Reservado para uma futura funcionalidade que ainda não existe. |
| `discordWebhookEnv` | Sim | Nome da variável de ambiente (definida no `.env`) que contém a URL do webhook usado para notificar sobre esse target. |

Campos específicos de `"type": "http"`:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `url` | Sim, a menos que use `urlEnv` | URL completa a ser verificada. Não use isso para endpoints internos/sensíveis — prefira `urlEnv`. |
| `urlEnv` | Sim, a menos que use `url` | Nome de uma variável de ambiente (no `.env`) que contém a URL — use para não commitar URLs internas. |
| `method` | Não (padrão `"GET"`) | Método HTTP usado no check. |

Um target `http` deve definir exatamente um de `url`/`urlEnv`, nunca os dois. Um sucesso é qualquer resposta HTTP 2xx ou 3xx dentro do timeout; 4xx, 5xx, timeout, falha de DNS, conexão recusada e falha de TLS contam como falha.

Campos específicos de `"type": "log"`:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `path` | Sim | Caminho do arquivo de log **dentro do container** (veja a nota sobre volumes abaixo). |
| `patterns` | Sim | Lista de substrings (não regex) que, se aparecerem em uma linha nova, contam como um match — ex.: `["ERROR", "FATAL"]`. |

O Log Monitor lê o arquivo de forma incremental (nunca relê o arquivo inteiro), mantendo a posição de leitura entre checks, e lida com rotação, truncamento e recriação do arquivo automaticamente. **Na primeira vez que um target é verificado, o conteúdo já existente no arquivo não é processado** (como um `tail -f`) — só as linhas escritas depois disso contam. Um match dispara uma notificação imediatamente (o cooldown só entra em ação para não notificar repetidamente por matches muito próximos entre si); `failureThreshold`/`recoveryThreshold` não se aplicam a esse tipo.

Como o arquivo de log normalmente vive no host (ou em outro container), monte-o como volume somente leitura no `docker-compose.yml`:

```yaml
services:
  monitor:
    volumes:
      - .:/app
      - node_modules:/app/node_modules
      - /caminho/no/host/app.log:/var/log/monitored/app.log:ro
```

E aponte `path` para o caminho **dentro do container** (`/var/log/monitored/app.log` no exemplo acima), não para o caminho no host.

Campos específicos de `"type": "host"`:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `metricsUrl` | Sim | URL do endpoint `/metrics` de um [Node Exporter](https://github.com/prometheus/node_exporter). Este projeto já inclui um serviço `node-exporter` no `docker-compose.yml`, acessível em `http://node-exporter:9100/metrics` de dentro do container `monitor` (mesma rede do compose). |
| `diskMountpoint` | Não (padrão `"/"`) | Qual sistema de arquivos monitorar para `diskThresholdPercent`, identificado pelo `mountpoint` reportado pelo Node Exporter. |
| `cpuThresholdPercent`, `memoryThresholdPercent`, `diskThresholdPercent` | Pelo menos um é obrigatório quando `enabled: true` | Percentual (0–100) acima do qual o target é considerado `DOWN`. Um target `host` sem nenhum threshold definido nunca dispararia alerta, então a configuração é rejeitada. |

Diferente dos outros tipos, o Host Monitor **não lê `/proc`/`/sys` de dentro do próprio container** — isso mostraria métricas do container, não da máquina física. Em vez disso, ele consulta um Node Exporter (que tem acesso real ao host) via HTTP, no mesmo formato de texto usado pelo Prometheus. O uso de CPU é calculado comparando duas leituras sucessivas (é um contador cumulativo desde o boot, não um valor instantâneo) — por isso `cpuPercent` não aparece no primeiro check de um target recém-configurado, só a partir do segundo.

> **Limitação em Docker Desktop (Windows/Mac):** o "host" que o Node Exporter enxerga é a VM interna do Docker Desktop, não a máquina física — então o mountpoint `/` padrão pode não existir na lista (a VM tem seus próprios mountpoints, como `/tmp`, `/var`, `/run`). Para ver quais mountpoints estão disponíveis no seu ambiente antes de configurar `diskMountpoint`, rode (com `docker compose up -d node-exporter` já executado):
> ```bash
> docker run --rm --network monitora_default curlimages/curl:latest -s http://node-exporter:9100/metrics | grep node_filesystem_size_bytes
> ```
> Em produção (um host Linux real), `/` funciona normalmente.

Configuração inválida é rejeitada no início da execução, com uma mensagem de erro clara indicando o que está errado — o container não vai simplesmente travar silenciosamente.

## Comandos

### Docker (uso do dia a dia)

| Comando | O que faz |
|---|---|
| `docker compose build` | Reconstrói a imagem — rode depois de mudar código ou o `Dockerfile`. |
| `docker compose up` | Sobe o Monitora (+ Node Exporter) e mostra os logs no terminal. `Ctrl+C` para parar. |
| `docker compose up -d` | Igual, mas em segundo plano (não prende o terminal). |
| `docker compose logs monitor` | Mostra os logs do serviço principal (útil com `up -d`). Adicione `-f` para acompanhar em tempo real. |
| `docker compose down` | Para e remove os containers e a rede. |
| `docker compose ps` | Mostra quais containers estão rodando. |
| `docker compose restart monitor` | Reinicia só o serviço principal — necessário depois de mudar o `.env` **ou** o `config/targets.json` (o código em `src/` recarrega sozinho em modo dev, mas variáveis de ambiente e o arquivo de configuração não — ele só é lido uma vez, na inicialização). |

### npm (rodam tanto localmente, se você tiver Node.js 22, quanto via `docker compose run --rm monitor <script>`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Roda em modo desenvolvimento, com reinício automático ao editar arquivos (usado por `docker compose up`). |
| `npm run build` | Compila o TypeScript para `dist/`. |
| `npm start` | Roda a versão compilada (`dist/index.js`) — usado na imagem de produção. |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos. |
| `npm test` | Roda a suíte de testes (testes de rede usam servidores locais efêmeros; testes do Discord usam mocks — nada depende de credenciais reais). |

## Segurança

- Nunca commite `.env`, tokens, URLs de webhook ou URLs internas sensíveis. `.env` já está no `.gitignore`.
- A URL de um webhook do Discord **é** uma credencial (contém um token) — trate como uma senha.
- Erros de conexão nunca incluem a URL completa do target nem a URL do webhook nas mensagens de log/alerta — apenas uma descrição da falha (ex.: "connection refused", "DNS resolution failed").
- **Targets `log`**: quando um `pattern` bate, a linha correspondente (truncada a 500 caracteres) é incluída na notificação enviada ao Discord. Se a aplicação monitorada loga dados sensíveis (tokens, senhas, dados pessoais) em linhas que coincidem com os `patterns` configurados, esses dados vão parar no canal do Discord. O Monitora não tenta detectar ou redigir segredos dentro de linhas de log — trate isso na aplicação monitorada (não logar segredos em texto plano) ou escolha `patterns` que evitem capturar esse tipo de linha.

## Estrutura do projeto

```text
config/targets.json     configuração dos targets monitorados
logs/                   logs de execução da própria aplicação (não os logs monitorados)
src/
  commands/              handler do comando /status (função pura, sem depender do discord.js)
  config/                carregamento e validação de config/targets.json
  discord/               bot (slash command) e notifier (webhook)
  logs/                  Log Monitor (leitura incremental de arquivos de log monitorados)
  monitoring/             scheduler, HTTP monitor, state store, alert policy, dispatch
  system/                Host Monitor (métricas via Node Exporter)
  types/                  tipos de domínio compartilhados
  index.ts                ponto de entrada: liga tudo e trata shutdown
tests/                   testes automatizados (node:test via tsx)
docs/
  ARCHITECTURE.md         arquitetura detalhada e regras arquiteturais
  PROJECT_BLUEPRINT.md    especificação original do projeto
  PROGRESS.md             histórico de desenvolvimento e decisões
```

## Limitações conhecidas (MVP)

- **Estado em memória**: reiniciar o container perde o histórico de monitoramento (últimas falhas, downtime acumulado, offset de leitura de logs, baseline de CPU, etc.). Isso é intencional para o MVP — não há banco de dados. O `/status` também reflete esse estado em memória: reiniciar o container zera o que o comando mostra.
- **Host Monitor** depende de um Node Exporter acessível — sem ele (ou com a URL errada), o target simplesmente falha a cada check com um erro claro, como qualquer outra falha de rede.
- O Bot do Discord só tem o comando `/status` — não há outros comandos interativos (ex.: pausar/reativar um target via Discord).
