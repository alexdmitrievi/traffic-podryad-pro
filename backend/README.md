# `@traffic/backend`

Hono API для Pipupi: `api.pipupi.ru`. Модульный монолит — границы модулей описаны в
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

**Состояние: Wave 4a–4d — рантайм, авторизация, порты провайдеров и продуктовые
модули.** Работают: валидация окружения с fail-fast по комплаенс-предохранителям,
health-маршруты, durable outbox с fencing-токенами, вход/ротация/выход с host-only
cookie и ролями, порты `LlmPort` (fake-драйвер, PII-guard, учёт `llm_runs`,
стоимостный кап), `KeywordSourcePort` (CSV, отказ целиком), `PublishingPort`
(идемпотентность) и сквозной конвейер: заявки по четырём линиям с журналом событий,
планы с одобрением по хэшу, импорт ключей и лексическая кластеризация, брифы и
черновики через outbox, публикация только по одобрению, лиды с согласием и
атрибуцией, воронка. Остались поверхности (`website`, `webapp`) и E2E — юниты 4e–4f.

| Волна | Что появилось |
| --- | --- |
| Wave 3 | `prisma/schema.prisma`, сиды справочников, `packages/contracts` в зависимостях |
| Wave 4a | `src/env.ts`, `src/db.ts`, `src/app.ts` (health), `src/outbox/**`, `src/jobs.ts`, `src/scheduler.ts`, `src/background-tasks.ts`, точки входа, первая миграция |
| Wave 4b | `src/modules/auth/**`, `src/modules/users/**`, CORS и Origin-проверки, rate limit, `create-admin` |
| Wave 4c | `src/providers/llm/**` (fake + DeepSeek, PII-guard, instrumentation, cost cap), `src/providers/keywords/**` (CSV), `src/providers/publishing/**` (fake + filesystem), контрактные сьюты |
| Wave 4d | `src/modules/service-requests/**`, `research/**`, `content/**`, `approvals/**`, `publishing/**`, `leads/**`, `attribution/**`, `analytics/**` — сквозной конвейер с одобрением по хэшу |
| Wave 4e–4f | поверхности `website`/`webapp` и E2E |

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
