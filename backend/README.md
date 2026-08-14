# `@traffic/backend`

Hono API для Pipupi: `api.pipupi.ru`. Модульный монолит — границы модулей описаны в
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

**Состояние: Wave 4a — рантайм.** Работают: валидация окружения с fail-fast по
комплаенс-предохранителям, health-маршруты, durable outbox с fencing-токенами, реестр
периодических задач и три точки входа (`api`, `worker`, `cron`). Продуктовые модули и
провайдеры — следующие юниты (4b–4f).

| Волна | Что появилось |
| --- | --- |
| Wave 3 | `prisma/schema.prisma`, сиды справочников, `packages/contracts` в зависимостях |
| Wave 4a | `src/env.ts`, `src/db.ts`, `src/app.ts` (health), `src/outbox/**`, `src/jobs.ts`, `src/scheduler.ts`, `src/background-tasks.ts`, точки входа, первая миграция |
| Wave 4b–4f | `src/modules/**`, `src/providers/**`, поверхности и E2E |

## Команды

```bash
bun run dev                # API в watch-режиме
bun run api                # точка входа API
bun run worker             # дренаж outbox
bun run cron               # периодические задачи, один проход
bun run test               # unit-тесты (без Docker)
bun run test:integration   # generate + migrate deploy в тестовую БД + integration-сьют (нужен Docker)
bun run db:migrate         # prisma migrate dev против локальной dev-БД
bun run db:seed            # валидация и upsert справочников (--write)
```

Правила, которые уже действуют и проверяются `bun run architecture:check`:

- **AC-1** — SDK провайдеров и HTTP-клиенты только внутри `src/providers/**`;
- **AC-2** — `src/providers/llm/**` не импортирует `src/modules/leads` и `src/modules/attribution`;
- **AC-3** — пакетов мессенджеров, MTProto и рассылок в репозитории нет.

Процесс **отказывается стартовать** (ненулевой код выхода), если
`REQUIRE_HUMAN_APPROVAL=false`, `OUTBOUND_MESSAGING_ENABLED=true`, `PII_TO_LLM_ALLOWED=true`
или `AUTH_COOKIE_SECURE=false` в продакшне — [../docs/COMPLIANCE.md](../docs/COMPLIANCE.md).

Переменные окружения — [.env.example](.env.example). Реальные значения живут в `.env`,
который не попадает в Git.
