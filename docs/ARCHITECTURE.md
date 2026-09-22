# Monitora — Architecture

## 1. Overview

Monitora is a small, configurable monitoring platform for web services and infrastructure.

Its purpose is to monitor multiple independent targets and notify operators when relevant state changes or thresholds are reached.

The system is designed to:

- run entirely through Docker;
- use Node.js and TypeScript;
- monitor multiple targets without modifying the monitored applications;
- add or remove targets through configuration;
- normalize monitoring results before processing them;
- keep monitoring, state management, alert policy, and notification responsibilities separated;
- use Discord as the initial notification and interaction channel;
- remain suitable for public GitHub use and third-party forks.

The architecture is intentionally smaller than a complete observability platform. The MVP should not introduce infrastructure that is not required by the defined monitoring features.

---

## 2. Architectural Goals

The architecture prioritizes:

1. Correctness
2. Security
3. Simplicity
4. Isolation between components
5. Testability
6. Observability of the monitor itself
7. Performance
8. Convenience

The system should be easy for a human developer to understand before it is optimized for abstraction or scale.

---

## 3. Technology Constraints

### Runtime

- Node.js 22 LTS
- TypeScript
- Strict TypeScript configuration

### Discord

- `discord.js` 14.x
- Discord Webhooks for alerts
- Discord Bot and Slash Commands for later interactive functionality such as `/status`

### Execution

Development and production must work through Docker.

The project must not assume Node.js, npm, Python, or another runtime is installed on the host. The expected host requirements are Docker and Git.

### Persistence

The MVP uses an in-memory State Store.

A future persistent implementation may be introduced behind the same State Store abstraction without requiring changes to monitors or notification components.

---

## 4. System Boundaries

Monitora is divided into two conceptual areas.

### Core

The core is responsible for the monitoring process itself:

- loading configuration;
- scheduling checks;
- executing monitors;
- normalizing results;
- maintaining target state;
- deciding when an alert should be emitted.

### Adapters / Integrations

Integrations connect the core to external systems:

- Discord Webhook for notifications;
- Discord Bot for interactive commands;
- Node Exporter for host metrics;
- monitored log files through read-only volumes;
- monitored HTTP services.

The core must not depend on the internal implementation details of a monitored application.

Likewise, the monitoring components must not know how Discord notifications are delivered.

---

## 5. High-Level Architecture

```text
                         targets.json
                              |
                              v
                        Config Loader
                              |
                              v
                           Scheduler
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
        HTTP Monitor    Host Monitor     Log Monitor
              |               |               |
              +---------------+---------------+
                              |
                              v
                        CheckResult
                              |
                              v
                         State Store
                              |
                              v
                        Alert Policy
                              |
                              v
                      Discord Notifier
                              |
                              v
                       Discord Webhook


Discord Bot
     |
     v
Command Handler
     |
     v
 State Store
     |
     v
 /status response
```

The important architectural boundary is the normalized result.

Monitors produce a common `CheckResult`. Components after the monitor do not need to know how the result was collected.

---

## 6. Core Flow

The normal monitoring flow is:

```text
Configuration
    ↓
Scheduler
    ↓
Monitor
    ↓
Normalized CheckResult
    ↓
State Store
    ↓
Alert Policy
    ↓
AlertEvent
    ↓
Discord Notifier
```

Each layer has one primary responsibility.

### Configuration

Describes what should be monitored and how it should behave.

It must not contain execution logic.

### Scheduler

Decides when a target should be checked.

It must keep target executions independent and prevent overlapping checks for the same target.

### Monitor

Knows how to check one type of target.

It returns a normalized result and does not send Discord messages.

### State Store

Maintains the current known state of each target.

It works with normalized results and does not depend on the internal implementation of a monitor.

### Alert Policy

Decides whether a state change or event should generate an alert.

It is responsible for thresholds, cooldown behavior, recovery notifications, and similar alert decisions.

### Discord Notifier

Delivers an already-decided alert to Discord.

It does not decide whether an alert should exist.

---

## 7. Configuration

The primary configuration file is:

```text
config/targets.json
```

A target describes something that Monitora should monitor.

Conceptually:

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

Sensitive endpoints may use environment variables:

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

Invalid configuration must be rejected during startup with a clear error.

Adding or removing a target must not require TypeScript changes.

---

## 8. Domain Model

### Target

A `Target` represents something that should be monitored.

Common properties:

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

Type-specific properties should only exist when required.

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

Host monitoring may use global or target-specific thresholds.

---

## 9. Normalized Monitoring Result

Every monitor returns a common internal result.

```text
CheckResult
├── targetId
├── success
├── checkedAt
├── durationMs
├── error
└── metadata
```

Examples of metadata:

### HTTP

```text
statusCode
responseTime
```

### Host

```text
cpuPercent
memoryPercent
diskPercent
```

### Logs

```text
pattern
line
timestamp
```

The State Store must consume `CheckResult` rather than depend on monitor-specific implementation details.

---

## 10. State Machine

The persistent state of a target is:

```text
UNKNOWN
UP
DOWN
```

`RECOVERED` is an event generated by a transition, not a persistent state.

Valid transitions:

```text
UNKNOWN → UP
UNKNOWN → DOWN
UP → DOWN
DOWN → UP
```

### Failure transition

`UP → DOWN` generates a `DOWN` event when consecutive failures reach `failureThreshold`.

### Recovery transition

`DOWN → UP` generates a `RECOVERED` event when consecutive successes satisfy `recoveryThreshold`.

---

## 11. State Isolation

Every target owns an independent state.

Conceptually:

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

A failure in one target must never change the state of another target.

There must not be global shared state that couples unrelated targets.

---

## 12. Downtime

When `UP → DOWN` occurs, the State Store records `firstFailureAt` as the beginning of the detected outage.

When `DOWN → UP` occurs:

```text
downtime = recoveredAt - firstFailureAt
```

The resulting duration should be formatted in a human-readable way for recovery notifications.

---

## 13. Cooldown and Throttling

Cooldown is configured independently per target.

Example:

```text
cooldownSeconds = 900
```

During a persistent incident, the alert policy must prevent Discord flooding.

Conceptually:

```text
DOWN alert
    ↓
15 minutes
    ↓
optional reminder
    ↓
15 minutes
    ↓
optional reminder
```

Recovery notifications are independent from the DOWN cooldown.

---

## 14. Scheduler

The scheduler must:

- respect `intervalSeconds` for each target;
- prevent concurrent checks of the same target;
- allow different targets to run independently;
- prevent one target failure from terminating the process;
- record execution failures in a structured way;
- support clean shutdown.

The scheduler should not be implemented as uncontrolled independent `setInterval` calls.

The conceptual execution unit is:

```text
check target
    ↓
wait for completion
    ↓
schedule next execution
```

A slow target must not block unrelated targets.

---

## 15. HTTP Monitor

The HTTP Monitor is responsible for:

- making HTTP requests;
- respecting timeout;
- measuring latency;
- capturing status code;
- distinguishing HTTP failures from connection failures;
- returning `CheckResult`.

It must not send messages directly to Discord.

Relevant cases include:

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

Healthy behavior should be configurable without changing the monitor implementation.

---

## 16. Host Monitoring

The container must not assume that `/proc`, `/sys`, or Node.js system libraries represent the physical host correctly.

The expected host metrics architecture is:

```text
Host
└── Node Exporter
        ↓
    Monitora
```

Node Exporter is the expected source of host metrics.

The MVP only requires:

```text
CPU
RAM
filesystem
```

Thresholds must be configurable.

A complete Prometheus deployment should not be introduced merely to obtain CPU, RAM, and disk metrics.

---

## 17. Log Monitoring

Log files should be mounted as read-only volumes whenever possible.

Example:

```yaml
volumes:
  - /var/log/myapp:/var/log/monitored/myapp:ro
```

Example target:

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

The log monitor must:

- read only new lines;
- maintain a reading offset;
- detect truncation;
- handle log rotation;
- handle recreated files;
- handle missing files;
- handle permission errors;
- avoid repeatedly notifying about the same line.

It must not reread the entire file every cycle.

---

## 18. Discord Notification

The Discord Notifier is responsible for:

- resolving the configured webhook;
- constructing embeds;
- sending alert events;
- handling delivery failures.

It must not decide whether an alert should be generated.

The notifier receives an `AlertEvent` that has already been decided by `AlertPolicy`.

```text
AlertEvent
├── type
├── targetId
├── targetName
├── occurredAt
├── message
└── metadata
```

Supported event types initially include:

```text
DOWN
RECOVERED
HOST_THRESHOLD
LOG_MATCH
```

---

## 19. Discord Bot and `/status`

The Discord Bot is a later interaction layer.

The command flow is:

```text
Discord Bot
    ↓
Command Handler
    ↓
State Store
    ↓
Status response
```

`/status` must read the current known state.

It must not rerun every healthcheck.

This keeps the command fast and preserves the separation between monitoring execution and interaction.

---

## 20. Persistence

The initial State Store is in memory.

The interface should allow a future persistent implementation without requiring changes to:

- monitors;
- alert policy;
- Discord notification;
- command handling.

Known MVP limitation:

> Restarting the container loses in-memory monitoring history.

This is acceptable for the MVP and should remain documented.

No database should be introduced in the MVP without an explicit requirement.

---

## 21. Error Handling

An individual monitoring failure must never terminate the main process.

Expected flow:

```text
Monitor failure
    ↓
failed CheckResult
    ↓
State update
    ↓
Alert decision
    ↓
continue monitoring
```

Discord delivery failures must be handled and logged without corrupting monitor state.

Critical configuration failures may prevent startup when the application cannot operate correctly.

---

## 22. Graceful Shutdown

The application must handle:

```text
SIGTERM
SIGINT
```

During shutdown it should:

1. stop scheduling new checks;
2. wait for in-progress operations when possible;
3. close Discord clients;
4. exit with an appropriate process code.

---

## 23. Security

Secrets must never be committed.

Examples include:

```text
Discord tokens
Discord webhooks
API keys
passwords
sensitive internal URLs
credentials
cookies
private certificates
```

Use `.env.example` as a reference.

The real `.env` file must remain outside Git.

Secrets must not be printed completely in logs.

Errors containing credentials, authenticated URLs, or tokens must be sanitized before logging or sending to Discord.

Log volumes should be read-only whenever possible.

---

## 24. Docker Architecture

The project must work entirely through Docker for both development and production.

The expected Docker structure includes:

- development stage;
- build stage;
- production stage.

The base runtime is Node.js 22.

Development should mount local source code and keep `node_modules` in a dedicated volume.

Example development compose pattern:

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

Ports should not be published unless the application actually needs to receive external HTTP traffic.

---

## 25. Project Structure

The initial target structure is:

```text
monitora/
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

New monitor types should have their own modules.

`index.ts` and `scheduler.ts` must not become monolithic files.

---

## 26. Extension Model

The architecture should allow additional monitor types without requiring changes throughout the system.

Potential future monitor types mentioned by the blueprint include:

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

These are extension possibilities, not MVP requirements.

A new monitor should fit the same conceptual pipeline:

```text
New Monitor
    ↓
CheckResult
    ↓
State Store
    ↓
Alert Policy
    ↓
Discord Notifier
```

Adding a monitor type must not require modifying every existing monitor.

---

## 27. Testing Strategy

Minimum unit-test coverage should include:

- `UNKNOWN → UP`;
- `UP → DOWN`;
- `DOWN → UP`;
- failure threshold;
- recovery threshold;
- cooldown;
- downtime calculation;
- configuration parsing;
- HTTP success;
- HTTP error;
- HTTP timeout;
- invalid HTTP status behavior;
- incremental log reading.

Tests must not depend on a real Discord environment.

Discord integration tests should only be introduced when they provide clear value and should use appropriate environment variables.

---

## 28. Architectural Rules

These rules are permanent boundaries:

### Rule 1 — Monitors do not know Discord

A monitor produces a normalized result.

It does not send notifications.

### Rule 2 — Discord does not own monitoring logic

The Discord integration receives events or reads state.

It does not perform healthchecks as part of normal notification processing.

### Rule 3 — Alert Policy decides whether to alert

The notifier only delivers decisions already made by the alert policy.

### Rule 4 — Configuration describes behavior

Configuration defines targets and thresholds.

It does not contain executable business logic.

### Rule 5 — State is per target

One target must never modify another target's monitoring state.

### Rule 6 — Core works with normalized data

The State Store and Alert Policy should not depend on HTTP-specific, log-specific, or host-specific implementation details.

### Rule 7 — External integrations remain replaceable

The core should not be tightly coupled to Discord implementation details.

### Rule 8 — MVP remains small

Do not introduce databases, Redis, Kafka, RabbitMQ, Kubernetes, dashboards, full Prometheus infrastructure, or other major components unless a concrete requirement requires them.

---

## 29. Non-Goals

The following are outside the MVP unless explicitly added as requirements:

- full observability platform;
- web dashboard;
- database-backed history;
- Redis;
- Kafka;
- RabbitMQ;
- Kubernetes;
- full Prometheus stack;
- application-specific business logic;
- modifying monitored applications;
- complex analytics.

The architecture may allow future expansion, but future possibilities must not become unnecessary MVP infrastructure.

---

## 30. Architectural Acceptance Test

The most important architectural test is:

> A third party should be able to fork Monitora, configure credentials, add or remove targets through configuration, and start the monitor without modifying the source code for the monitored targets.

If achieving a new target requires changing monitoring core code, the architecture should be reviewed.

---

## 31. Source of Truth

The original `AI_DEVELOPMENT_BLUEPRINT.md` remains the broader project blueprint.

This document reorganizes its technical architecture into a more focused reference for implementation.

When a requirement is not specified here, consult the original blueprint before introducing a new architectural decision.

