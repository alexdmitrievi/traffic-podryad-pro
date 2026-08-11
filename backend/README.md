# `@traffic/backend`

Hono API для Pipupi: `api.pipupi.ru`. Модульный монолит — границы модулей описаны в
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

**Состояние: каркас воркспейса.** Исходников пока нет.

| Волна | Что появится |
| --- | --- |
| Wave 3 | `prisma/schema.prisma`, сиды справочников, `packages/contracts` в зависимостях |
| Wave 4 | `src/modules/**`, `src/providers/**`, outbox, jobs, точки входа |

Правила, которые уже действуют и проверяются `bun run architecture:check`:

- **AC-1** — SDK провайдеров и HTTP-клиенты только внутри `src/providers/**`;
- **AC-2** — `src/providers/llm/**` не импортирует `src/modules/leads` и `src/modules/attribution`;
- **AC-3** — пакетов мессенджеров, MTProto и рассылок в репозитории нет.

Переменные окружения — [.env.example](.env.example). Реальные значения живут в `.env`,
который не попадает в Git.
