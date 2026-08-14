# `@traffic/backend`

Hono API для Pipupi: `api.pipupi.ru`. Модульный монолит — границы модулей описаны в
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

**Состояние: Wave 4a–4b — рантайм и авторизация.** Работают: валидация окружения с
fail-fast по комплаенс-предохранителям, health-маршруты, durable outbox с
fencing-токенами, реестр периодических задач, три точки входа (`api`, `worker`, `cron`),
вход/ротация/выход с host-only cookie, роли с немедленным действием и защита «ноль
администраторов». Продуктовые модули, провайдеры и поверхности — следующие юниты
(4c–4f).

| Волна | Что появилось |
| --- | --- |
| Wave 3 | `prisma/schema.prisma`, сиды справочников, `packages/contracts` в зависимостях |
| Wave 4a | `src/env.ts`, `src/db.ts`, `src/app.ts` (health), `src/outbox/**`, `src/jobs.ts`, `src/scheduler.ts`, `src/background-tasks.ts`, точки входа, первая миграция |
| Wave 4b | `src/modules/auth/**`, `src/modules/users/**`, CORS и Origin-проверки, rate limit, `create-admin` |
| Wave 4c–4f | `src/providers/**`, продуктовые модули, поверхности и E2E |

## Команды

```bash
bun run dev                # API в watch-режиме
bun run api                # точка входа API
bun run worker             # дренаж outbox
bun run cron               # периодические задачи, один проход
bun run create:admin       # первый администратор (CREATE_ADMIN_EMAIL / CREATE_ADMIN_PASSWORD)
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
