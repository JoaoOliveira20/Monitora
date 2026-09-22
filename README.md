# Monitora

Monitora é uma pequena plataforma de monitoramento configurável, que verifica serviços web e infraestrutura e envia alertas para o Discord quando algo muda de estado.

O objetivo é simples: monitorar múltiplos serviços (sites, APIs) sem precisar alterar código a cada novo serviço adicionado — tudo é configurado em um único arquivo JSON. Todo o projeto roda via Docker; o host só precisa ter Docker e Git instalados.

## Status atual do projeto

O núcleo de monitoramento está completo e funcional:

- **Configuração dinâmica** de múltiplos targets (`config/targets.json`), sem precisar alterar código.
- **HTTP Monitor**: verifica serviços web (sucesso, erro HTTP, timeout, DNS, conexão recusada, TLS).
- **Máquina de estados** por target (`UNKNOWN → UP → DOWN → UP`), com downtime calculado.
- **Alertas via Discord** (webhook), com cooldown para não floodar o canal, e recuperação notificada separadamente.
- **Scheduler** que verifica cada target de forma independente, sem sobreposição, sem derrubar o processo por falha de um único serviço.

O que **ainda não existe**:

- Monitor de logs (`type: "log"` na config) — a configuração é aceita, mas o check falha com um erro claro em vez de rodar.
- Monitor de host/CPU-RAM-disco (`type: "host"` na config) — mesma situação.
- Bot do Discord com slash commands (ex.: `/status`) — hoje só existe o envio de alertas via webhook, não um bot interativo.

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

O `config/targets.json` do repositório vem com a lista de targets vazia — edite-o (junto com o `.env`) conforme a seção [Configuração](#configuração) abaixo. Com pelo menos um target habilitado apontando para um webhook do Discord válido, o monitor já funciona. Depois:

```bash
docker compose build
docker compose up
```

O container fica rodando continuamente, verificando os targets configurados nos intervalos definidos. Para parar:

```bash
docker compose down
```

Ou, em outro terminal, `Ctrl+C` no terminal onde `docker compose up` está rodando — o processo trata `SIGTERM`/`SIGINT` e encerra de forma limpa.

## Configuração

Dois arquivos precisam ser configurados antes do monitor ser útil de verdade: `.env` e `config/targets.json`. Nenhum dos dois deve conter segredos reais commitados no Git — o `.env` já está no `.gitignore`.

### `.env`

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória? | Descrição |
|---|---|---|
| `NODE_ENV` | Não | `development` ou `production`. Já vem preenchida com `development`; o `Dockerfile` força `production` na imagem de produção. |
| `MONITOR_NAME` | Não | Nome exibido no log de inicialização. Se vazia, usa `"Monitora"`. |
| `DISCORD_WEBHOOK_MAIN` | Sim, se algum target usar esse nome | **Exemplo** de variável referenciada por um target no `config/targets.json` (campo `discordWebhookEnv`). O nome não é fixo — cada target aponta para a env var que quiser (veja abaixo). O valor é a URL completa do webhook do Discord (`Configurações do Canal → Integrações → Webhooks`). |
| `DISCORD_WEBHOOK_URL`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | Não, ainda | Reservadas para quando o Bot do Discord (`/status`) existir. Não usadas por nenhum código hoje — pode deixar em branco. |

Você pode adicionar quantas variáveis `DISCORD_WEBHOOK_*` quiser, com o nome que preferir — o que importa é que o nome bata com o `discordWebhookEnv` do target correspondente em `config/targets.json`. Vários targets podem compartilhar o mesmo webhook.

**Nunca coloque a URL de um webhook diretamente no `config/targets.json` ou em qualquer arquivo versionado** — a URL do webhook contém um token secreto embutido nela mesma. Ela deve existir apenas no `.env` local (fora do Git).

### `config/targets.json`

Define **o que** deve ser monitorado e **como**. Adicionar ou remover um serviço não exige nenhuma alteração de código — só editar este arquivo.

Estrutura geral:

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
      "enabled": true,
      "url": "https://example.com",
      "method": "GET",
      "discordWebhookEnv": "DISCORD_WEBHOOK_MAIN"
    }
  ]
}
```

- **`defaults`**: valores usados por qualquer target que não sobrescrever o campo individualmente.
- **`targets`**: lista de serviços monitorados. Hoje, apenas `"type": "http"` funciona de verdade (`"log"` e `"host"` são aceitos pela configuração, mas o check falha com um erro claro até esses monitores serem implementados).

Campos comuns a todo target:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `id` | Sim | Identificador único do target (usado internamente para rastrear estado). |
| `name` | Sim | Nome legível, usado nas notificações. |
| `type` | Sim | `"http"` (único funcional hoje), `"log"` ou `"host"`. |
| `enabled` | Sim | `false` desativa o target sem precisar removê-lo do arquivo. |
| `intervalSeconds` | Não (usa `defaults`) | Intervalo entre checks, em segundos. |
| `timeoutMs` | Não (usa `defaults`) | Timeout do check, em milissegundos. |
| `failureThreshold` | Não (usa `defaults`) | Quantas falhas consecutivas até o target virar `DOWN` e disparar um alerta. |
| `recoveryThreshold` | Não (usa `defaults`) | Quantos sucessos consecutivos até um target `DOWN` virar `UP` novamente. |
| `cooldownSeconds` | Não (usa `defaults`) | Tempo mínimo entre alertas repetidos ("lembretes") enquanto o target continua `DOWN`. A notificação de recuperação não espera esse cooldown. |
| `discordChannelId` | Não | ID do canal do Discord (reservado para uso futuro pelo Bot; não é necessário hoje). |
| `discordWebhookEnv` | Sim | Nome da variável de ambiente (definida no `.env`) que contém a URL do webhook usado para notificar sobre esse target. |

Campos específicos de `"type": "http"`:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `url` | Sim, a menos que use `urlEnv` | URL completa a ser verificada. Não use isso para endpoints internos/sensíveis — prefira `urlEnv`. |
| `urlEnv` | Sim, a menos que use `url` | Nome de uma variável de ambiente (no `.env`) que contém a URL — use para não commitar URLs internas. |
| `method` | Não (padrão `"GET"`) | Método HTTP usado no check. |

Um target `http` deve definir exatamente um de `url`/`urlEnv`, nunca os dois. Um sucesso é qualquer resposta HTTP 2xx ou 3xx dentro do timeout; 4xx, 5xx, timeout, falha de DNS, conexão recusada e falha de TLS contam como falha.

Configuração inválida é rejeitada no início da execução, com uma mensagem de erro clara indicando o que está errado — o container não vai simplesmente travar silenciosamente.

## Scripts disponíveis

Todos rodam tanto localmente (se você tiver Node.js 22 instalado) quanto dentro do container via `docker compose run --rm monitor <script>`:

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

## Estrutura do projeto

```text
config/targets.json     configuração dos targets monitorados
src/
  config/                carregamento e validação de config/targets.json
  discord/               envio de notificações ao Discord (webhook)
  monitoring/             scheduler, monitores, state store, alert policy
  types/                  tipos de domínio compartilhados
  index.ts                ponto de entrada: liga tudo e trata shutdown
tests/                   testes automatizados (node:test via tsx)
docs/
  ARCHITECTURE.md         arquitetura detalhada e regras arquiteturais
  PROJECT_BLUEPRINT.md    especificação original do projeto
  PROGRESS.md             histórico de desenvolvimento e decisões
```

## Limitações conhecidas (MVP)

- **Estado em memória**: reiniciar o container perde o histórico de monitoramento (últimas falhas, downtime acumulado, etc.). Isso é intencional para o MVP — não há banco de dados.
- Apenas o **HTTP Monitor** está implementado; targets `log`/`host` são aceitos na configuração, mas não são verificados de verdade ainda.
- Não há Bot do Discord nem comando `/status` ainda — as notificações são só via webhook, em uma via.
