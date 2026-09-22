# Discord Monitor — AI Development Blueprint

## 1. Objetivo

Desenvolver um monitor de serviços web e infraestrutura, executado integralmente em Docker e capaz de enviar alertas para Discord.

O sistema deve monitorar múltiplos projetos sem exigir alterações nos projetos monitorados. Um novo target deve ser adicionado ou removido alterando apenas configuração, sem modificar o código da aplicação.

O projeto será público no GitHub e deve ser adequado para fork por terceiros.

O projeto tem duração de 8 semanas, com aproximadamente 4 horas por dia de desenvolvimento.

---

## 2. Papel da IA durante o desenvolvimento

A IA atua como assistente de desenvolvimento e deve preservar a arquitetura definida neste documento.

A IA deve:

- analisar o estado atual do repositório antes de alterar arquivos;
- implementar uma tarefa por vez;
- preferir a menor alteração que resolva o requisito;
- reutilizar abstrações existentes;
- manter separação clara entre configuração, monitoramento, estado, política de alerta e Discord;
- executar ou propor testes verificáveis para cada mudança;
- informar arquivos alterados e comportamento esperado;
- evitar mudanças arquiteturais não solicitadas;
- evitar dependências desnecessárias;
- preservar compatibilidade com Docker;
- tratar configurações e segredos fora do Git;
- verificar documentação oficial quando uma API, biblioteca ou comportamento específico puder ter mudado.

A IA não deve:

- transformar o projeto em uma plataforma de observabilidade completa sem requisito;
- introduzir PostgreSQL, Redis, Kafka, RabbitMQ, Kubernetes ou outros componentes sem necessidade explícita;
- adicionar dashboard web como parte do MVP;
- colocar lógica específica de Laravel, Magento, Next.js ou outra aplicação no núcleo do monitor;
- colocar URL interna, token, webhook, senha ou outra credencial diretamente no código ou configuração versionada;
- criar comentários explicativos dentro do código;
- substituir uma implementação simples por uma abstração excessiva;
- refatorar arquivos não relacionados à tarefa atual apenas por preferência de estilo;
- alterar o contrato dos arquivos de configuração sem atualizar a documentação e os testes correspondentes.

---

## 3. Restrições técnicas permanentes

### Linguagem

Usar Node.js com TypeScript.

### Runtime

Node.js 22 LTS.

### Discord

Usar `discord.js` 14.x.

Webhooks são usados para alertas.

Bot e Slash Commands serão adicionados posteriormente para funcionalidades interativas como `/status`.

### Execução

Desenvolvimento e produção devem funcionar em Docker.

Não assumir Node.js, npm, pnpm, Python ou qualquer runtime instalado no host.

O host precisa apenas de Docker e Git.

### Código

TypeScript estrito.

Evitar `any` e `unknown` sempre que uma modelagem tipada puder ser usada.

Não adicionar comentários ao código-fonte.

Separar responsabilidades por módulos.

### Open Source

Nenhum segredo deve ser versionado.

Usar `.env.example` como referência.

O `.env` verdadeiro deve permanecer fora do Git.

---

## 4. Princípio arquitetural central

O monitor deve seguir o fluxo:

```text
Configuração
    ↓
Scheduler
    ↓
Monitor
    ↓
Resultado normalizado
    ↓
State Store
    ↓
Alert Policy
    ↓
Discord Notifier
```

Um monitor não deve saber como o Discord funciona.

O Discord Notifier não deve saber como HTTP, logs ou métricas são coletados.

A configuração não deve conter lógica de execução.

---

## 5. Arquitetura alvo

```text
                    targets.json
                         │
                         ▼
                   Config Loader
                         │
                         ▼
                     Scheduler
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
    HTTP Monitor    Host Monitor    Log Monitor
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                    Normalized Event
                         │
                         ▼
                     State Store
                         │
                         ▼
                    Alert Policy
                         │
                         ▼
                  Discord Notifier
                         │
                         ▼
                 Discord Webhook

Discord Bot
    │
    ▼
Command Handler
    │
    ▼
State Store
    │
    ▼
/status response
```

---

## 6. Estrutura de diretórios alvo

```text
discord-monitor/
├── config/
│   └── targets.json
├── logs/
│   └── .gitkeep
├── src/
│   ├── commands/
│   │   └── status.ts
│   ├── config/
│   │   ├── loader.ts
│   │   └── schema.ts
│   ├── discord/
│   │   ├── bot.ts
│   │   └── notifier.ts
│   ├── logs/
│   │   └── log-monitor.ts
│   ├── monitoring/
│   │   ├── http-monitor.ts
│   │   ├── scheduler.ts
│   │   └── state-store.ts
│   ├── system/
│   │   └── host-metrics.ts
│   ├── types/
│   │   └── index.ts
│   └── index.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

Novos tipos de monitor devem ser adicionados em módulos próprios sem transformar `index.ts` ou `scheduler.ts` em arquivos monolíticos.

---

## 7. Configuração dinâmica

A configuração principal deve estar em `config/targets.json`.

Exemplo:

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
      "intervalSeconds": 60,
      "timeoutMs": 5000,
      "failureThreshold": 2,
      "recoveryThreshold": 1,
      "cooldownSeconds": 900,
      "discordChannelId": "000000000000000000",
      "discordWebhookEnv": "DISCORD_WEBHOOK_MAIN"
    }
  ]
}
```

Para endpoints sensíveis, usar variável de ambiente:

```json
{
  "id": "internal-api",
  "name": "Internal API",
  "type": "http",
  "enabled": true,
  "urlEnv": "TARGET_INTERNAL_API_URL",
  "discordChannelId": "000000000000000000",
  "discordWebhookEnv": "DISCORD_WEBHOOK_MAIN"
}
```

O sistema deve rejeitar configuração inválida no startup com erro claro.

Adicionar ou remover um target não pode exigir alteração de TypeScript.

---

## 8. Variáveis de ambiente

`.env.example` deve conter apenas nomes de variáveis e valores vazios ou exemplos claramente fictícios.

Base inicial:

```text
NODE_ENV=development
MONITOR_NAME=Discord Monitor
DISCORD_WEBHOOK_URL=
DISCORD_WEBHOOK_MAIN=
DISCORD_WEBHOOK_ALPHASHIRT=
DISCORD_WEBHOOK_MAGENTO=
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
TARGET_INTERNAL_API_URL=
```

Não assumir que todas precisam existir ao mesmo tempo. A validação deve considerar a fase atual do sistema.

---

## 9. Docker

### Dockerfile

Deve existir estágio de desenvolvimento, build e produção.

Base esperada:

```dockerfile
FROM node:22.23.2-alpine3.24 AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY config ./config

CMD ["npm", "run", "dev"]

FROM development AS build

RUN npm run build

FROM node:22.23.2-alpine3.24 AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config

CMD ["npm", "start"]
```

Depois de existir `package-lock.json`, preferir `npm ci` quando apropriado para instalação determinística.

### docker-compose.yml

Desenvolvimento deve montar o código local e preservar `node_modules` em volume separado:

```yaml
services:
  monitor:
    build:
      context: .
      target: development
    env_file:
      - .env
    volumes:
      - .:/app
      - node_modules:/app/node_modules
    restart: unless-stopped

volumes:
  node_modules:
```

Não publicar portas HTTP se a aplicação não precisar receber tráfego externo.

---

## 10. Modelo de domínio inicial

### Target

Um target representa algo que deve ser monitorado.

Propriedades mínimas:

```text
id
name
type
enabled
intervalSeconds
timeoutMs
failureThreshold
recoveryThreshold
cooldownSeconds
discordChannelId
discordWebhookEnv
```

Campos específicos devem existir somente quando necessários ao tipo de monitor.

### HTTP Target

```text
url
urlEnv
method
```

### Log Target

```text
path
patterns
```

### Host Target

Pode usar configuração global ou específica para thresholds.

---

## 11. Normalização de resultados

Todos os monitores devem retornar um formato interno consistente.

Modelo conceitual:

```text
CheckResult
├── targetId
├── success
├── checkedAt
├── durationMs
├── error
└── metadata
```

Para HTTP, `metadata` pode conter:

```text
statusCode
responseTime
```

Para host:

```text
cpuPercent
memoryPercent
diskPercent
```

Para logs:

```text
pattern
line
timestamp
```

O State Store trabalha com resultados normalizados e não deve depender da implementação interna de cada monitor.

---

## 12. Máquina de estados

Estado persistente inicial:

```text
UNKNOWN
UP
DOWN
```

`RECOVERED` é uma transição/evento e não precisa ser estado persistente.

Fluxo:

```text
UNKNOWN → UP
UNKNOWN → DOWN
UP → DOWN
DOWN → UP
```

`UP → DOWN` gera evento DOWN quando o número de falhas consecutivas atinge `failureThreshold`.

`DOWN → UP` gera evento RECOVERED quando o serviço volta conforme `recoveryThreshold`.

---

## 13. Estado por target

Cada target deve possuir estado independente.

Modelo conceitual:

```text
MonitorState
├── targetId
├── status
├── consecutiveFailures
├── consecutiveSuccesses
├── firstFailureAt
├── lastCheckedAt
├── lastSuccessAt
├── lastFailureAt
├── lastLatencyMs
├── lastError
└── lastAlertAt
```

Não usar estado global compartilhado entre targets de forma que a falha de um serviço altere o estado de outro.

---

## 14. Downtime

Quando ocorre `UP → DOWN`, guardar `firstFailureAt` referente ao início da indisponibilidade detectada.

Quando ocorre `DOWN → UP`, calcular:

```text
recoveredAt - firstFailureAt
```

O resultado deve ser exibido de forma legível no alerta de recuperação.

---

## 15. Cooldown e throttling

Cada target possui seu próprio cooldown.

Exemplo:

```text
cooldownSeconds = 900
```

Durante um incidente persistente:

```text
DOWN alert
↓
15 min
↓
optional reminder
↓
15 min
↓
optional reminder
```

A política deve impedir flooding do Discord.

Recuperação deve gerar uma notificação independente do cooldown de DOWN.

---

## 16. Scheduler

Requisitos:

- respeitar `intervalSeconds` por target;
- impedir execução concorrente do mesmo target;
- permitir que targets diferentes sejam verificados de forma independente;
- não derrubar o processo por falha de um target;
- registrar falhas de execução de forma estruturada;
- poder ser encerrado de maneira limpa.

Evitar implementar o scheduler como uma coleção de `setInterval` sem controle de sobreposição.

A unidade de execução deve ser conceitualmente:

```text
check target
↓
aguardar conclusão
↓
programar próxima execução
```

---

## 17. HTTP Monitor

Responsabilidades:

- fazer request HTTP;
- respeitar timeout;
- medir latência;
- capturar status code;
- diferenciar erro HTTP de erro de conexão;
- retornar `CheckResult`;
- não enviar mensagens diretamente ao Discord.

Casos que devem ser tratados:

```text
200
3xx
4xx
5xx
timeout
DNS error
connection refused
TLS error
```

O comportamento considerado saudável deve ser configurável sem alterar a implementação do monitor.

---

## 18. Discord Notifier

Responsabilidades:

- resolver o webhook configurado;
- montar Embed;
- enviar evento ao Discord;
- tratar falha de envio;
- não decidir quando um alerta deve ser emitido.

O Notifier recebe eventos já decididos pela `AlertPolicy`.

Exemplo conceitual:

```text
AlertEvent
├── type: DOWN | RECOVERED | HOST_THRESHOLD | LOG_MATCH
├── targetId
├── targetName
├── occurredAt
├── message
└── metadata
```

---

## 19. Formato dos alertas

Os embeds devem ser consistentes.

### DOWN

```text
🔴 Service DOWN

Service: Example Site
Status: HTTP 500
Failures: 2
Detected at: 14:21:12
```

### RECOVERED

```text
🟢 Service RECOVERED

Service: Example Site
Downtime: 14m 28s
Recovered at: 14:35:40
```

### Host threshold

```text
🟠 Host threshold exceeded

CPU: 94%
Memory: 68%
Disk: 72%
```

A interface do Discord deve permanecer simples e legível.

---

## 20. Host Monitoring

Não assumir que `/proc`, `/sys` ou bibliotecas Node executadas dentro do container representam corretamente o host físico.

O desenho esperado para a sprint de host metrics é:

```text
Host
└── Node Exporter
       │
       ▼
Discord Monitor
```

Node Exporter será usado como fonte de métricas de máquina.

O monitor deve consumir somente as métricas necessárias ao MVP:

```text
CPU
RAM
filesystem
```

Thresholds devem ser configuráveis.

Não adicionar Prometheus completo somente para cumprir CPU/RAM/disco.

---

## 21. Log Monitoring

Arquivos de log devem ser montados como volumes somente leitura quando possível.

Exemplo:

```yaml
volumes:
  - /var/log/myapp:/var/log/monitored/myapp:ro
```

Configuração:

```json
{
  "id": "app-log",
  "name": "Application Log",
  "type": "log",
  "enabled": true,
  "path": "/var/log/monitored/myapp/app.log",
  "patterns": [
    "ERROR",
    "CRITICAL",
    "FATAL"
  ],
  "discordWebhookEnv": "DISCORD_WEBHOOK_MAIN"
}
```

O monitor deve:

- ler apenas novas linhas;
- manter offset da leitura;
- detectar truncamento;
- lidar com log rotation;
- lidar com arquivo recriado;
- tratar arquivo inexistente;
- tratar permissão negada;
- evitar notificar repetidamente a mesma linha.

Não ler o arquivo inteiro em cada ciclo.

---

## 22. Slash command `/status`

O Bot do Discord será adicionado na sprint 4.

`/status` deve consultar o estado atual conhecido e não executar novamente todos os healthchecks.

Resposta esperada:

```text
Discord Monitor

🟢 Example Site
UP · 183 ms

🟢 API
UP · 241 ms

🔴 Magento
DOWN · 7m 32s

Host
CPU 34%
RAM 61%
DISK 72%
```

O comando deve responder rapidamente usando `StateStore`.

---

## 23. Persistência

Não implementar banco de dados no MVP inicial.

O primeiro `StateStore` deve funcionar em memória.

A interface do State Store deve permitir futura implementação persistente sem alterar monitores ou Discord.

Limitação conhecida:

Se o container reiniciar, o histórico em memória é perdido.

Isso é aceitável no MVP e deve ser documentado.

---

## 24. Concorrência e isolamento

Um target lento não pode bloquear todos os demais.

Exemplo:

```text
Target A → timeout 10s
Target B → 200 em 150ms
Target C → 200 em 200ms
```

B e C devem continuar sendo processados independentemente de A.

Dois checks simultâneos do mesmo target devem ser evitados.

---

## 25. Tratamento de erros

Nenhum erro individual de monitoramento deve finalizar o processo principal.

Exemplo conceitual:

```text
HTTP target falhou
↓
CheckResult de falha
↓
State update
↓
Alert decision
↓
next target
```

Falha no Discord deve ser registrada e tratada sem destruir o estado dos monitores.

Falha de configuração crítica deve impedir o startup quando a aplicação não puder operar corretamente.

---

## 26. Graceful shutdown

Tratar:

```text
SIGTERM
SIGINT
```

Durante shutdown:

- parar novos checks;
- aguardar operações em andamento quando possível;
- fechar clientes do Discord;
- finalizar o processo com código apropriado.

---

## 27. Segurança

Nunca versionar:

```text
Discord tokens
Discord webhooks
API keys
senhas
URLs internas sensíveis
credenciais
cookies
certificados privados
```

Nunca imprimir segredo completo em logs.

Quando um erro contém URL autenticada, token ou credencial, sanitizar a mensagem antes de registrar ou enviar ao Discord.

Volume de logs deve ser somente leitura sempre que possível.

---

## 28. Testes mínimos

O projeto deve ter testes unitários para:

- transição `UNKNOWN → UP`;
- transição `UP → DOWN`;
- transição `DOWN → UP`;
- failure threshold;
- recovery threshold;
- cooldown;
- cálculo de downtime;
- parsing da configuração;
- comportamento do HTTP Monitor em sucesso, erro, timeout e status inválido;
- leitura incremental dos logs.

Testes não devem depender de um Discord real.

Testes de integração com Discord devem existir somente quando agregarem valor e devem usar variáveis de ambiente apropriadas.

---

## 29. Critérios de aceite por sprint

### Sprint 1 — Semanas 1–2

Aceito quando:

- aplicação inicia em Docker;
- Webhook funciona;
- Embed é enviado;
- configuração é carregada de arquivo;
- múltiplos targets podem existir;
- HTTP healthcheck funciona;
- target pode ser desativado via configuração;
- timeout é respeitado;
- nenhuma URL sensível precisa ser commitada.

### Sprint 2 — Semanas 3–4

Aceito quando:

- estados são mantidos por target;
- DOWN ocorre após número configurado de falhas;
- RECOVERED ocorre após recuperação;
- downtime é calculado;
- cooldown evita flood;
- targets continuam independentes.

### Sprint 3 — Semanas 5–6

Aceito quando:

- CPU pode ser consultada;
- RAM pode ser consultada;
- disco pode ser consultado;
- thresholds podem gerar alerta;
- logs são monitorados incrementalmente;
- log rotation não causa leitura duplicada massiva;
- eventos de log podem gerar alerta.

### Sprint 4 — Semanas 7–8

Aceito quando:

- `/status` responde no Discord;
- aplicação trata falhas sem cair;
- shutdown é limpo;
- logs da própria aplicação são úteis;
- documentação permite fork;
- documentação explica configuração;
- Docker funciona para desenvolvimento e produção;
- projeto está pronto para publicação pública.

---

## 30. Cronograma de desenvolvimento

### Semana 1

- criar repositório;
- Dockerfile;
- docker-compose;
- TypeScript;
- `.env.example`;
- Webhook Discord;
- primeiro Embed;
- estrutura inicial de módulos.

### Semana 2

- Config Loader;
- schema da configuração;
- múltiplos targets;
- HTTP Monitor;
- timeout;
- scheduler inicial;
- primeiro fluxo completo `target → monitor → Discord`.

### Semana 3

- State Store;
- estados `UNKNOWN`, `UP`, `DOWN`;
- failure threshold;
- testes de transição.

### Semana 4

- recovery threshold;
- RECOVERED;
- downtime;
- cooldown;
- alert policy;
- testes dos cenários de incidente.

### Semana 5

- Node Exporter;
- host metrics;
- CPU/RAM/disco;
- thresholds;
- alertas.

### Semana 6

- volume de logs;
- leitura incremental;
- patterns;
- rotação;
- deduplicação básica;
- testes.

### Semana 7

- Discord Bot;
- Slash Command `/status`;
- melhoria do scheduler;
- tratamento de erros;
- graceful shutdown;
- revisão de performance.

### Semana 8

- testes finais;
- correção de edge cases;
- limpeza do projeto;
- segurança;
- README;
- exemplos de configuração;
- instruções de fork;
- preparação para GitHub público.

---

## 31. Dia 1 — implementação mínima obrigatória

Objetivo único:

```text
Container Docker → Discord Webhook → Embed
```

Não implementar no Dia 1:

```text
Scheduler
HTTP Monitor
State Store
Logs
Host Metrics
Slash Commands
Banco
Redis
Prometheus
Dashboard
```

### `.env`

```text
NODE_ENV=development
MONITOR_NAME=Discord Monitor
DISCORD_WEBHOOK_URL=
```

### `src/index.ts`

```ts
import { EmbedBuilder, WebhookClient } from "discord.js";

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const monitorName = process.env.MONITOR_NAME ?? "Discord Monitor";
const environment = process.env.NODE_ENV ?? "development";

if (!webhookUrl) {
  throw new Error("DISCORD_WEBHOOK_URL is required");
}

const webhook = new WebhookClient({ url: webhookUrl });

const embed = new EmbedBuilder()
  .setTitle("Monitor online")
  .setDescription("O container conseguiu se comunicar com o Discord via Webhook.")
  .addFields(
    { name: "Aplicação", value: monitorName, inline: true },
    { name: "Ambiente", value: environment, inline: true }
  )
  .setTimestamp();

try {
  await webhook.send({
    username: monitorName,
    embeds: [embed]
  });
} catch (error) {
  console.error("Discord webhook failed", error);
  process.exitCode = 1;
} finally {
  webhook.destroy();
}
```

### Comando de validação

```bash
docker compose build
docker compose run --rm monitor npm run once
```

### Resultado esperado

O canal configurado deve receber um Embed indicando que o container conseguiu enviar uma mensagem ao Discord.

---

## 32. Protocolo para a IA executar tarefas

Quando receber uma tarefa de implementação, seguir esta ordem:

### Etapa A — inspeção

Ler os arquivos relevantes do estado atual do projeto antes de propor mudanças.

Identificar:

- arquitetura existente;
- scripts disponíveis;
- dependências;
- configuração;
- testes existentes;
- diferenças em relação a este blueprint.

### Etapa B — escopo

Definir exatamente quais arquivos precisam mudar para atender a tarefa.

Não alterar arquivos não relacionados sem necessidade técnica.

### Etapa C — implementação

Implementar a menor solução completa que preserve:

- TypeScript estrito;
- separação de responsabilidades;
- Docker;
- configuração dinâmica;
- segurança;
- compatibilidade com o roadmap.

### Etapa D — validação

Executar, quando possível:

```bash
npm run typecheck
npm run build
```

E os testes correspondentes à tarefa.

Quando a alteração envolver Docker, validar também:

```bash
docker compose build
docker compose config
```

### Etapa E — resposta

A resposta da IA deve informar:

1. o que foi implementado;
2. quais arquivos foram alterados;
3. como validar;
4. limitações ou decisões importantes;
5. próximos passos somente quando relevantes à tarefa atual.

---

## 33. Regra contra overengineering

Antes de adicionar uma nova tecnologia, responder internamente:

1. Qual requisito atual exige essa tecnologia?
2. Existe solução nativa da stack atual?
3. A tecnologia reduz complexidade ou apenas adiciona infraestrutura?
4. O projeto realmente precisa dela dentro das 8 semanas?

Se a resposta não justificar a dependência, não adicionar.

A arquitetura deve ser extensível, mas o MVP deve permanecer pequeno.

---

## 34. Regra para novas funcionalidades

Toda nova funcionalidade deve indicar:

```text
Configuração
Domínio
Execução
Estado
Notificação
Teste
Documentação
```

Não implementar uma funcionalidade somente no caminho feliz.

Exemplo para novo monitor:

```text
NewMonitor
   ↓
CheckResult
   ↓
StateStore
   ↓
AlertPolicy
   ↓
DiscordNotifier
```

---

## 35. Regra de extensão para novos monitores

No futuro, podem existir:

```text
http
tcp
docker
database
ssl
ping
log
host
```

Adicionar um tipo novo não deve exigir alteração em todos os monitores existentes.

O núcleo trabalha com interfaces e resultados normalizados.

A configuração decide qual monitor executar.

---

## 36. Definição de pronto do projeto

O projeto final será considerado pronto quando:

- roda integralmente via Docker;
- monitora múltiplos targets;
- targets são configuráveis sem alterar TypeScript;
- HTTP status e timeout são monitorados;
- estados DOWN e RECOVERED funcionam;
- downtime é calculado;
- cooldown evita flooding;
- CPU, RAM e disco podem ser monitorados;
- logs podem ser monitorados via volume;
- `/status` funciona;
- erros não derrubam o processo inteiro;
- secrets não estão no Git;
- testes mínimos existem;
- README é suficiente para um novo usuário fazer fork e executar o projeto.

---

## 37. Ordem de prioridade

Quando houver conflito entre funcionalidades, usar esta prioridade:

```text
1. Correção
2. Segurança
3. Simplicidade
4. Isolamento entre componentes
5. Testabilidade
6. Observabilidade do próprio monitor
7. Performance
8. Conveniência
```

Não sacrificar correção ou segurança para acelerar uma feature.

---

## 38. Comandos esperados

Desenvolvimento:

```bash
docker compose build
docker compose up
```

Execução única:

```bash
docker compose run --rm monitor npm run once
```

Validação TypeScript:

```bash
docker compose run --rm monitor npm run typecheck
```

Build:

```bash
docker compose run --rm monitor npm run build
```

---

## 39. Resultado esperado do projeto

O resultado não deve ser somente um bot que envia mensagens.

O resultado deve ser uma pequena plataforma de monitoramento configurável cujo núcleo desconhece detalhes dos sistemas monitorados e cuja camada Discord funciona como mecanismo de notificação e interação.

O teste arquitetural mais importante é:

> Um terceiro deve conseguir fazer fork, configurar credenciais, adicionar novos targets no arquivo de configuração e iniciar o monitor sem precisar alterar o código-fonte.

