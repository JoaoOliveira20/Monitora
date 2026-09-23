# Configuração do Monitora

Este documento explica como configurar sua própria instalação do Monitora, e a diferença entre arquivos **públicos** (versionados, servem de exemplo para qualquer pessoa) e arquivos **locais** (sua configuração real, nunca vão para o GitHub).

Para a referência completa de cada campo de `config/targets.json` e de cada variável de `.env`, veja o [`README.md`](../README.md#configuração) — este documento foca no fluxo de configuração, não repete a referência de campos.

## Configuração local

Depois de clonar o repositório, crie seus dois arquivos locais a partir dos exemplos públicos:

```bash
cp .env.example .env
cp config/targets.example.json config/targets.json
```

Edite os dois com seus valores reais (webhooks, tokens, os serviços que você quer monitorar). Nenhum dos dois vai para o Git — veja a seção seguinte.

## Arquivos versionados vs. arquivos locais

| Arquivo | Versionado? | O que é |
|---|---|---|
| `.env.example` | **Sim**, público | Lista todas as variáveis de ambiente suportadas, com valores vazios/fictícios e comentários explicando cada uma. |
| `config/targets.example.json` | **Sim**, público | Exemplo válido (contra o schema real do projeto) demonstrando os três tipos de target suportados (`http`, `log`, `host`). Todos os targets vêm desativados (`enabled: false`) — é só um modelo pra copiar e adaptar. |
| `.env` | **Não**, local | Seus segredos reais (tokens, webhooks). Já está no `.gitignore`. |
| `config/targets.json` | **Não**, local | Os serviços que você está monitorando de verdade — pode conter domínios internos, URLs específicas da sua infraestrutura, etc. Está no `.gitignore`. |

Se você clonar o repositório, só vai ver os dois arquivos `.example`/`.example.json` — `config/targets.json` e `.env` não existem até você criá-los com os comandos acima.

## Secrets

Segredos (tokens do Discord, URLs de webhook) **nunca** vão em `config/targets.json` nem em nenhum arquivo versionado. Eles só existem como variáveis de ambiente, em `.env`:

- `config/targets.json` referencia o **nome** da variável (`discordWebhookEnv`, `urlEnv`), nunca o valor.
- O valor real (a URL do webhook, por exemplo) mora só no `.env`, que nunca é commitado.

Essa separação existe justamente para que `config/targets.json` pudesse, em tese, ser compartilhado sem vazar nada — mesmo assim, ele continua fora do Git por padrão, porque os *nomes* dos seus serviços/domínios já são informação da sua instalação.

## Criando sua própria configuração

Depois de copiar `config/targets.example.json` para `config/targets.json`, edite a lista de `targets`: adicione um objeto por serviço que você quer monitorar (`type: "http"`, `"log"` ou `"host"`), removendo os exemplos que não fizerem sentido pra você e ajustando `id`, `name`, `url`/`path`/`metricsUrl` conforme o tipo. O `config/targets.example.json` já mostra a forma válida de cada tipo — use como modelo. A referência completa de cada campo (obrigatório vs. opcional, o que cada um faz) está no README, seção [`config/targets.json`](../README.md#configtargetsjson).

Depois de editar `config/targets.json` com o container já rodando, é preciso `docker compose restart monitor` — o arquivo só é lido na inicialização, não recarrega sozinho como o código em `src/`.

## Regra de manutenção dos arquivos de exemplo

`config/targets.example.json` e `.env.example` **não são arquivos descartáveis** — são parte da API pública/contrato de configuração do projeto, no mesmo nível que o código.

**Sempre que uma nova opção de configuração for adicionada ao Monitora — um novo campo no schema de targets, uma nova variável de ambiente, um novo valor padrão — o arquivo de exemplo correspondente deve ser atualizado na mesma alteração.**

Exemplos do que exige atualizar o example junto:

- Um novo campo no schema (`src/config/schema.ts`), como um futuro `timeoutMs` com outro nome ou um novo tipo de target → atualizar `config/targets.example.json` pra demonstrá-lo.
- Uma nova variável de ambiente usada pelo código (ex.: um futuro `MONITORA_LOG_LEVEL`) → atualizar `.env.example` com a variável (vazia ou com um valor fictício) e um comentário explicando pra que serve.
- Uma mudança nos valores padrão de `defaults` → atualizar o `config/targets.example.json` pra continuar refletindo um cenário razoável.

Um teste automatizado (`tests/config-examples.test.ts`) valida que `config/targets.example.json` continua sendo aceito pelo schema real e que `.env.example` não contém nenhum segredo real — mas isso só garante que o example não está *quebrado*, não que ele está *completo* ou *atualizado*. A responsabilidade de manter os examples representativos das opções disponíveis é humana (ou do agente), não automatizada.
