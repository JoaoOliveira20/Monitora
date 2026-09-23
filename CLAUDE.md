# Monitora — Claude Code Instructions

## 1. Purpose

You are working on Monitora, a small configurable monitoring platform built with Node.js, TypeScript, and Docker.

Your role is to assist development while preserving the architecture and constraints defined by the project documentation.

The goal is not to maximize abstraction or code volume.

The goal is to produce code that is:

- correct;
- secure;
- simple;
- readable by humans;
- well structured;
- testable;
- maintainable;
- consistent with the architecture;
- appropriate for the current scope.

---

## 2. Source of Truth

Before implementing a task, read:

1. `CLAUDE.md`
2. `docs/ARCHITECTURE.md`
3. `AI_DEVELOPMENT_BLUEPRINT.md` when additional detail is required.

The original blueprint is the broader project specification.

Do not silently replace documented requirements with personal architectural preferences.

If the documentation does not define a decision, inspect the existing project and choose the smallest reasonable solution. If the decision has significant architectural consequences, stop and ask before making it.

---

## 3. Core Development Principles

Always:

- inspect the current repository before modifying files;
- understand existing code before replacing it;
- implement one task at a time;
- prefer the smallest complete change that solves the requirement;
- reuse existing abstractions when appropriate;
- preserve clear module boundaries;
- avoid unnecessary dependencies;
- preserve Docker compatibility;
- keep secrets outside version control;
- add or update tests when behavior changes;
- validate the implementation after changes;
- keep documentation synchronized with meaningful architectural changes.

Do not implement future roadmap items unless explicitly requested.

Do not turn a simple requirement into a large refactor.

---

## 4. Architecture Rules

The core flow is:

```text
Configuration
    ↓
Scheduler
    ↓
Monitor
    ↓
CheckResult
    ↓
State Store
    ↓
Alert Policy
    ↓
AlertEvent
    ↓
Discord Notifier
```

### Monitors

Monitors know how to perform checks.

They must return normalized results.

They must not send Discord notifications.

### State Store

The State Store manages state per target.

It must not depend on implementation details of a specific monitor.

### Alert Policy

Alert Policy decides whether an event should produce a notification.

It owns threshold, cooldown, recovery, and related alert decisions.

### Discord Notifier

The Discord Notifier delivers already-decided alert events.

It must not contain monitoring logic or decide whether an alert should exist.

### Discord Bot

The Discord Bot is an interaction layer.

`/status` reads the State Store and does not rerun all healthchecks.

### Configuration

Configuration describes targets and behavior.

It must not contain executable logic.

---

## 5. Technology Rules

Use:

- Node.js 22 LTS;
- TypeScript;
- strict TypeScript;
- `discord.js` 14.x;
- Docker for development and production.

Do not assume the host has Node.js, npm, Python, or another runtime installed.

The host should only need Docker and Git.

Avoid `any`.

Avoid `unknown` when a precise type can model the value.

Do not introduce a new runtime, framework, database, queue, cache, or infrastructure component without a concrete requirement.

---

## 6. Human-Readable Code

Human readability is a first-class project requirement.

Code should be understandable by a developer reading it for the first time.

Prefer:

- explicit names;
- small focused functions;
- clear control flow;
- predictable module boundaries;
- simple data structures;
- direct implementations;
- consistent naming;
- types that communicate intent.

Avoid:

- clever one-liners when they reduce readability;
- deeply nested control flow;
- unnecessary generic abstractions;
- premature design patterns;
- functions that do many unrelated things;
- unexplained abbreviations;
- magic values when a named constant improves understanding.

The code should be easy to debug without needing to reconstruct the author's intentions.

---

## 7. Function and Variable Naming

Function names must be intuitive and describe what the function actually does.

Prefer names such as:

```text
loadConfiguration()
checkHttpTarget()
updateTargetState()
shouldSendAlert()
sendDiscordAlert()
calculateDowntime()
readNewLogLines()
scheduleNextCheck()
```

Avoid vague names such as:

```text
process()
handle()
doThing()
run()
execute()
manage()
data()
helper()
```

A generic name is acceptable only when the surrounding context makes its meaning genuinely obvious.

Variables should communicate their purpose.

Prefer:

```text
target
targetState
checkResult
failureCount
recoveryThreshold
webhookUrl
```

over ambiguous names such as:

```text
data
item
value
obj
result2
tmp
```

---

## 8. Comments in Source Code

Do not add comments to application source code.

The code itself must communicate intent through:

- good names;
- small functions;
- clear types;
- module boundaries;
- straightforward control flow.

Do not compensate for unclear code by adding explanatory comments.

If something is difficult to understand, first improve the structure or naming.

Documentation belongs in Markdown documentation, not as explanatory comments inside the implementation.

This rule does not prohibit required tool directives, configuration syntax, generated-file markers, or language/compiler directives when they are technically necessary.

---

## 9. Abstraction and Quality

The requirement to keep code simple does not mean writing low-quality code.

Use abstractions when they provide a real architectural benefit.

Good abstraction:

```text
Monitor
    ↓
CheckResult
```

This allows HTTP, host, and log monitors to share the same downstream processing model.

Bad abstraction:

Creating several generic layers, factories, registries, interfaces, or utility classes when only one implementation exists and there is no current requirement for the abstraction.

Before introducing an abstraction, ask:

1. What concrete problem does it solve?
2. Does it reduce coupling?
3. Does it improve testability?
4. Does it make the architecture clearer?
5. Is it required now?

If the answer is mostly no, keep the implementation direct.

---

## 10. Separation of Responsibilities

Keep these responsibilities separate:

```text
Configuration
Scheduler
Monitoring
State
Alert Policy
Notification
Discord Commands
```

Do not place unrelated responsibilities into the same module merely because it is convenient.

Do not allow:

```text
HTTP Monitor → Discord
```

or:

```text
Log Monitor → Discord
```

or:

```text
Discord Command → execute every healthcheck
```

The intended boundaries must remain intact.

---

## 11. Configuration Rules

Targets are configured through:

```text
config/targets.json
```

Adding or removing a target must not require TypeScript changes.

Sensitive values must use environment variables.

Never commit:

- Discord tokens;
- Discord webhooks;
- API keys;
- passwords;
- private certificates;
- credentials;
- sensitive internal URLs;
- cookies;
- other secrets.

Keep `.env` outside Git.

Keep `.env.example` safe and free of real credentials.

`config/targets.json` is local, installation-specific configuration and is gitignored — it is never committed. `config/targets.example.json` is the public, versioned template that a fresh clone starts from (`docs/CONFIGURATION.md` documents this flow in full). The same public/local split applies to `.env.example` (public) vs. `.env` (local, gitignored).

**Configuration examples are part of the public contract of the project.** Whenever the configuration schema, environment variables, defaults, or supported configuration options change, update the corresponding example files (`config/targets.example.json`, `.env.example`) and `docs/CONFIGURATION.md` in the same task — not as a follow-up. This is not optional documentation polish: an out-of-date example is actively misleading to anyone setting up the project from scratch, since it is the first (and often only) reference they read.

If a configuration contract changes, update:

- the configuration schema;
- relevant tests (including `tests/config-examples.test.ts`, which validates that `config/targets.example.json` still parses against the real schema);
- documentation (`README.md`, `docs/CONFIGURATION.md`);
- `config/targets.example.json` and `.env.example`.

---

## 12. Docker Rules

Docker is part of the application architecture, not an optional deployment detail.

Development and production must remain functional through Docker.

When changing dependencies or runtime behavior, verify Docker compatibility.

Do not introduce host-runtime assumptions.

Do not publish HTTP ports unless the application actually needs external HTTP traffic.

When appropriate, validate:

```bash
docker compose config
docker compose build
```

---

## 13. Error Handling

Individual monitoring failures must not terminate the main process.

Expected pattern:

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

Critical configuration errors may prevent startup.

Discord delivery failures must not destroy monitoring state.

Do not silently swallow errors that are useful for diagnosing failures.

Do not leak secrets through error messages or logs.

---

## 14. Testing

When behavior changes, add or update tests when practical.

The minimum project test coverage includes:

- state transitions;
- failure threshold;
- recovery threshold;
- cooldown;
- downtime;
- configuration parsing;
- HTTP success;
- HTTP errors;
- HTTP timeout;
- incremental log reading.

Tests must not depend on a real Discord server for normal unit testing.

After implementation, run the most relevant validation available.

At minimum, when the project supports these scripts:

```bash
npm run typecheck
npm run build
```

For Docker-related changes:

```bash
docker compose config
docker compose build
```

Run targeted tests before broader tests when that is faster and meaningful.

---

## 15. Implementation Workflow

For every implementation task:

### Step 1 — Read

Read the relevant project documentation and existing code.

### Step 2 — Inspect

Identify:

- current architecture;
- relevant modules;
- existing types;
- existing tests;
- package dependencies;
- configuration;
- Docker setup.

### Step 3 — Scope

Determine the smallest set of files that must change.

Do not modify unrelated files for style preferences.

### Step 4 — Plan

Before editing, understand:

- what behavior is changing;
- which module owns the behavior;
- which existing abstraction should be reused;
- what tests validate the change.

### Step 5 — Implement

Make the smallest complete implementation.

Do not implement future features.

Do not add speculative infrastructure.

### Step 6 — Validate

Run appropriate type checking, tests, build, and Docker validation.

### Step 7 — Review

Before finishing, check:

- architecture boundaries;
- naming;
- readability;
- security;
- unnecessary complexity;
- accidental unrelated changes.

### Step 8 — Report

The final response should state:

1. what was implemented;
2. files changed;
3. validation performed;
4. important decisions or limitations;
5. relevant next step, only if useful.

---

## 16. No Unrequested Refactors

Do not refactor unrelated code merely because you prefer another style.

If a refactor is necessary to safely implement the requested feature, keep it scoped to that need.

If a larger architectural refactor appears useful but is not required, mention it instead of silently performing it.

---

## 17. No Unnecessary Dependencies

Before adding a dependency:

1. identify the concrete requirement;
2. check whether the current stack already provides the capability;
3. check whether a small local implementation is clearer;
4. consider the maintenance cost;
5. verify compatibility with Node.js 22 and Docker.

Do not add infrastructure simply because it is common in larger monitoring platforms.

The MVP explicitly avoids unnecessary introduction of:

```text
PostgreSQL
Redis
Kafka
RabbitMQ
Kubernetes
full Prometheus stack
web dashboard
```

unless a concrete requirement changes that decision.

---

## 18. Security During Development

Never put credentials into:

- source code;
- committed configuration;
- tests;
- example files;
- logs;
- Discord messages.

When errors may contain sensitive information, sanitize them before logging or notifying.

Do not expose full authenticated URLs.

Use environment variables for secrets.

---

## 19. Documentation Rules

Documentation must remain useful to a human developer.

When an architectural behavior changes, update the appropriate Markdown documentation.

Do not create documentation for trivial implementation details that are already obvious from the code.

When documenting a decision, explain:

- what the system does;
- why the boundary exists;
- what another developer should or should not change.

Keep the documentation aligned with the actual implementation.

---

## 20. Scope Control

Monitora is not intended to become a complete observability platform during the MVP.

Do not add features simply because they could be useful someday.

Future monitor types may include:

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

These are extension possibilities, not permission to implement them without a task.

---

## 21. Definition of Done

A task is not complete merely because the code compiles.

When applicable, a task is complete when:

- the requested behavior works;
- architecture boundaries are preserved;
- TypeScript remains strict;
- names are clear;
- code is readable by humans;
- no unnecessary comments were added;
- no secrets were introduced;
- tests cover meaningful behavior;
- Docker compatibility is preserved;
- relevant validation passes;
- documentation is updated when necessary.

---

## 22. Priority When Requirements Conflict

Use this order:

```text
1. Correctness
2. Security
3. Simplicity
4. Component isolation
5. Testability
6. Observability
7. Performance
8. Convenience
```

Do not sacrifice correctness or security for speed of implementation.

Do not sacrifice architectural boundaries merely to reduce the number of files.

Do not sacrifice readability merely to make an implementation shorter.

---

## 23. Final Principle

Build Monitora as software that a human developer can understand, maintain, debug, and extend.

Prefer boring, explicit, correct code over clever code.

Prefer a small number of well-defined modules over a large abstraction system.

Prefer an intuitive function name over a clever generic helper.

Prefer a simple implementation that satisfies the requirement over infrastructure created for hypothetical future requirements.

The architecture should be extensible, but the MVP should remain small.
