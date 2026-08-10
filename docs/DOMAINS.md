# Домены, TLS, CORS и cookie

## 1. Карта доменов

| Назначение | Адрес | Тип |
| --- | --- | --- |
| Публичный сайт — **canonical** | `https://pipupi.ru` | Astro SSG, статика из Object Storage через CDN |
| Приложение за авторизацией | `https://app.pipupi.ru` | React CSR, статика |
| Backend API | `https://api.pipupi.ru` | Hono, контейнер |
| `www` | `https://www.pipupi.ru` | **301 → `https://pipupi.ru`** |
| Мобильное приложение (будущее) | — | Своего хоста не имеет. Обращается к `https://api.pipupi.ru` |

Регистратор домена — reg.ru.

**Canonical-хост — `pipupi.ru` без `www`.** Каждая публичная страница несёт `<link rel="canonical">` на форму без `www`. `sitemap.xml` содержит только canonical-адреса. Смешение форм внутри сайта считается дефектом.

---

## 2. DNS

| Запись | Хост | Значение | Назначение |
| --- | --- | --- | --- |
| `ALIAS`/`ANAME` или `A` | `pipupi.ru` | Endpoint CDN публичного сайта | Apex не поддерживает `CNAME` — нужен `ALIAS`/`ANAME` у reg.ru либо `A` на адрес CDN |
| `CNAME` | `www` | `pipupi.ru` | Далее редирект на уровне CDN, не DNS |
| `CNAME` | `app` | Endpoint хостинга приложения | — |
| `CNAME` | `api` | Endpoint backend | — |
| `TXT` | `pipupi.ru` | Токены верификации | Подтверждение владения для площадки и вебмастеров |
| `CAA` | `pipupi.ru` | Разрешённые удостоверяющие центры | Рекомендуется |
| `MX` | `pipupi.ru` | По необходимости | Почта в MVP не используется продуктом |

> **DNS-редирект не существует.** `www` → apex делается ответом 301 на уровне CDN или прокси, а не записью DNS. `CNAME` только направляет трафик; сам редирект отдаёт HTTP-слой.

Если почтовые записи не заводятся, стоит явно опубликовать `SPF` с политикой отказа и `DMARC` с `p=reject`, чтобы домен нельзя было использовать для подделки писем от нашего имени.

---

## 3. TLS

Сертификаты нужны для четырёх имён:

```
pipupi.ru
www.pipupi.ru
app.pipupi.ru
api.pipupi.ru
```

- Wildcard `*.pipupi.ru` **не покрывает apex** — `pipupi.ru` нужен отдельной записью в сертификате в любом случае.
- HTTPS обязателен везде. HTTP отвечает только 301 на HTTPS.
- `Strict-Transport-Security` включается на всех четырёх именах. `includeSubDomains` — только после того, как все поддомены гарантированно работают по HTTPS; преждевременное включение делает недоступным любой будущий поддомен без сертификата.
- Автопродление сертификатов обязательно, срок истечения — под мониторингом.

---

## 4. Cookie-стратегия

Ключевое наблюдение: `pipupi.ru`, `app.pipupi.ru` и `api.pipupi.ru` — поддомены одного registrable domain. Значит, запросы между ними **same-site, но cross-origin**. Это даёт лучший вариант, чем разные домены: работает `SameSite=Lax`, и при этом нужен явный CORS.

### 4.1. Cookie авторизации — host-only

**Решение: cookie авторизации ставится API и остаётся host-only для `api.pipupi.ru`. Атрибут `Domain` не задаётся.**

| Атрибут | Значение | Почему |
| --- | --- | --- |
| `Domain` | **не задан** | Host-only: cookie принадлежит только `api.pipupi.ru` и не отправляется на `pipupi.ru` и `app.pipupi.ru` |
| `HttpOnly` | `true` | JavaScript не читает refresh-credential |
| `Secure` | `true` | Только HTTPS |
| `SameSite` | `Lax` | `app` → `api` — same-site, поэтому `Lax` достаточно и строже, чем `None` |
| `Path` | `/api/auth` | Cookie уходит только на маршруты, которым она нужна |

**Что это даёт.** Публичный сайт никогда не видит cookie авторизации — ни в браузере, ни в логах CDN. Утечка XSS на публичном сайте, который целиком статичен и потому наиболее вероятная точка компрометации через сторонний контент, **не даёт доступа к сессии**.

> Более раннее черновое предложение использовать `Domain=.pipupi.ru` отклонено: оно раздаёт cookie авторизации всем поддоменам, включая публичный сайт, без всякой необходимости.

Refresh-credential живёт только в этой cookie и **никогда** — в `localStorage`, `sessionStorage` или любом другом JS-читаемом хранилище. Для будущего мобильного клиента предусмотрен отдельный набор маршрутов, обменивающих токены в теле запроса и не работающий с cookie.

### 4.2. Cookie атрибуции — отдельная и не авторизационная

Публичный сайт — чистый SSG на объектном хранилище. Сервера, который мог бы поставить `HttpOnly`-cookie на `pipupi.ru`, нет.

| Атрибут | Значение |
| --- | --- |
| Имя | `ATTRIBUTION_COOKIE_NAME`, по умолчанию `pip_vid` |
| Хост | `pipupi.ru`, host-only |
| `HttpOnly` | **`false`** — ставится и читается скриптом сайта |
| `Secure` | `true` |
| `SameSite` | `Lax` |
| Срок | `ATTRIBUTION_COOKIE_TTL_DAYS`, по умолчанию 90 |
| Содержимое | Случайный идентификатор. **Никаких персональных данных** |

Осознанный компромисс: cookie не `HttpOnly`, потому что при чистом SSG иначе никак. Это приемлемо, поскольку она **не является учётной записью и не даёт никаких прав** — только случайный идентификатор визита. Событийные запросы к API передают его в теле, а не cookie, поэтому публичные эндпоинты вообще не работают в режиме с учётными данными.

---

## 5. CORS

Две разные политики, а не одна общая.

### Публичные эндпоинты — `/api/public/*`

| Параметр | Значение |
| --- | --- |
| Разрешённый origin | `https://pipupi.ru` |
| `Access-Control-Allow-Credentials` | **`false`** |
| Методы | `GET`, `POST`, `OPTIONS` |

Сюда попадают отправка CTA-формы и события атрибуции. Учётные данные не нужны: `visitor_id` передаётся в теле запроса.

### Эндпоинты за авторизацией — весь остальной API

| Параметр | Значение |
| --- | --- |
| Разрешённый origin | `https://app.pipupi.ru` |
| `Access-Control-Allow-Credentials` | `true` |
| Методы | `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS` |

Origin проверяется по точному списку. Wildcard `*` не используется нигде: с `Allow-Credentials: true` он и не разрешён спецификацией, а без него — просто лишняя открытость.

```bash
CORS_PUBLIC_ORIGINS=https://pipupi.ru
CORS_APP_ORIGINS=https://app.pipupi.ru
```

---

## 6. Переменные окружения доменного слоя

```bash
# Публичные адреса
PUBLIC_SITE_URL=https://pipupi.ru
PUBLIC_APP_URL=https://app.pipupi.ru
PUBLIC_API_URL=https://api.pipupi.ru

# CORS
CORS_PUBLIC_ORIGINS=https://pipupi.ru
CORS_APP_ORIGINS=https://app.pipupi.ru

# Cookie авторизации (host-only: AUTH_COOKIE_DOMAIN намеренно отсутствует)
AUTH_COOKIE_NAME=pip_rt
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_PATH=/api/auth

# Cookie атрибуции
ATTRIBUTION_COOKIE_NAME=pip_vid
ATTRIBUTION_COOKIE_TTL_DAYS=90

# Доверенный заголовок клиентского IP за прокси и CDN
TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for
```

Переменной `AUTH_COOKIE_DOMAIN` в конфигурации **нет намеренно**: её отсутствие и есть реализация host-only-решения. Если она когда-нибудь появится — это изменение модели безопасности, требующее записанного решения.

---

## 7. Локальная разработка

| Поверхность | Адрес |
| --- | --- |
| `website` | `http://localhost:4321` |
| `webapp` | `http://localhost:5173` |
| `backend` | `http://localhost:8080` |
| PostgreSQL | `localhost:54329` |

```bash
PUBLIC_SITE_URL=http://localhost:4321
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:8080
CORS_PUBLIC_ORIGINS=http://localhost:4321
CORS_APP_ORIGINS=http://localhost:5173
AUTH_COOKIE_SECURE=false
```

**Ловушка, о которой стоит знать заранее.** Cookie не различают порты: cookie, установленная `localhost:8080`, отправляется и на `localhost:5173`, и на `localhost:4321`. Локально изоляция host-only, которая работает в продакшне, **не воспроизводится**. Поэтому проверка того, что публичный сайт не получает cookie авторизации, должна выполняться против отдельных хостов — в staging или в E2E с разными именами хостов, а не только на `localhost`.

`AUTH_COOKIE_SECURE=false` допустим **только** локально. В продакшне значение `false` должно приводить к отказу старта процесса.

---

## 8. Staging

Зарезервированные плейсхолдеры. **Окружение не создано, записи DNS не заведены.**

| Назначение | Плейсхолдер |
| --- | --- |
| Сайт | `https://staging.pipupi.ru` |
| Приложение | `https://app.staging.pipupi.ru` |
| API | `https://api.staging.pipupi.ru` |

Требования, когда окружение появится:

- отдельная база данных, **никогда** не продакшн-база;
- отдельные секреты, не пересекающиеся с продакшном;
- `X-Robots-Tag: noindex` на всех ответах и `Disallow: /` в `robots.txt` — staging не должен попадать в индекс и конкурировать с продакшн-страницами;
- отдельный бакет объектного хранилища;
- реальные персональные данные в staging не переносятся.

---

## 9. Чек-лист вывода домена в работу

- [ ] Домен `pipupi.ru` зарегистрирован на reg.ru
- [ ] `ALIAS`/`A` для apex указывает на CDN
- [ ] `CNAME` для `www`, `app`, `api` заведены
- [ ] 301 с `www.pipupi.ru` на `pipupi.ru` работает на HTTP-слое
- [ ] Сертификаты выпущены для всех четырёх имён, автопродление включено
- [ ] HTTP отвечает 301 на HTTPS
- [ ] HSTS включён; `includeSubDomains` — только после проверки всех поддоменов
- [ ] `CORS_PUBLIC_ORIGINS` и `CORS_APP_ORIGINS` заданы точными значениями
- [ ] Cookie авторизации host-only — проверено на реальных хостах, не на `localhost`
- [ ] `canonical` на всех публичных страницах указывает на форму без `www`
- [ ] `sitemap.xml` содержит только canonical-адреса
- [ ] `SPF` и `DMARC` опубликованы, если почта не используется
