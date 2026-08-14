/**
 * GEO: вопросный инвентарь и ручные снимки видимости (docs/GEO.md, юниты 2–3).
 *
 * Человек записывает вопросы, которые реально задают, и триажит их:
 * open → planned → answered, либо dismissed с обязательной причиной.
 * Для open/planned вопросов снимаются снимки видимости вручную, в реальных
 * интерфейсах поисковиков и ассистентов — без парсинга и автоматизации.
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Field, Table } from '../../components/ui'

interface GeoQuery {
  id: string
  question: string
  clusterId: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'open' | 'planned' | 'answered' | 'dismissed'
  statusReason: string | null
  notes: string | null
}

interface GeoSnapshot {
  id: string
  queryId: string
  searchEngine: string
  searchPhrase: string | null
  brandMentioned: boolean
  mentionPosition: number | null
  answerExcerpt: string | null
  capturedAt: string
  notes: string | null
}

const statusLabels: Record<GeoQuery['status'], string> = {
  open: 'open',
  planned: 'planned',
  answered: 'answered',
  dismissed: 'dismissed',
}

export function GeoPage() {
  const [queries, setQueries] = useState<GeoQuery[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [notes, setNotes] = useState('')

  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [dismissReason, setDismissReason] = useState('')

  const [snapshotQueryId, setSnapshotQueryId] = useState('')
  const [snapshots, setSnapshots] = useState<GeoSnapshot[]>([])
  const [snapEngine, setSnapEngine] = useState('yandex')
  const [snapMentioned, setSnapMentioned] = useState(false)
  const [snapPosition, setSnapPosition] = useState('')
  const [snapExcerpt, setSnapExcerpt] = useState('')
  const [snapNotes, setSnapNotes] = useState('')

  const load = async () => {
    try {
      const body = await api<{ queries: GeoQuery[] }>('GET', '/api/geo/queries')
      setQueries(body.queries)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  const loadSnapshots = async (queryId: string) => {
    if (!queryId) {
      setSnapshots([])
      return
    }
    try {
      const body = await api<{ snapshots: GeoSnapshot[] }>('GET', `/api/geo/queries/${queryId}/snapshots`)
      setSnapshots(body.snapshots)
    } catch (caught) {
      setSnapshots([])
      setError(caught instanceof Error ? caught.message : 'Снимки не загрузились')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const createQuery = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await api('POST', '/api/geo/queries', { question, priority, ...(notes ? { notes } : {}) })
      setQuestion('')
      setNotes('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Вопрос не записан')
    }
  }

  const move = async (queryId: string, status: 'planned' | 'answered') => {
    setError(null)
    try {
      await api('PATCH', `/api/geo/queries/${queryId}`, { status })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Переход не записан')
    }
  }

  const dismiss = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!dismissingId || !dismissReason.trim()) {
      setError('Для отклонения нужна причина')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await api('PATCH', `/api/geo/queries/${dismissingId}`, {
        status: 'dismissed',
        statusReason: dismissReason,
      })
      setNotice('Вопрос отклонён с причиной.')
      setDismissingId(null)
      setDismissReason('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Отклонение не записано')
    }
  }

  const createSnapshot = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!snapshotQueryId) {
      setError('Выберите вопрос для снимка')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await api('POST', `/api/geo/queries/${snapshotQueryId}/snapshots`, {
        searchEngine: snapEngine,
        brandMentioned: snapMentioned,
        ...(snapMentioned && snapPosition ? { mentionPosition: Number(snapPosition) } : {}),
        ...(snapExcerpt ? { answerExcerpt: snapExcerpt } : {}),
        ...(snapNotes ? { notes: snapNotes } : {}),
      })
      setNotice('Снимок записан.')
      setSnapExcerpt('')
      setSnapNotes('')
      setSnapPosition('')
      await loadSnapshots(snapshotQueryId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Снимок не записан')
    }
  }

  const openForSnapshots = queries.filter((entry) => entry.status === 'open' || entry.status === 'planned')

  return (
    <div>
      <Card title="Новый вопрос">
        <form onSubmit={createQuery}>
          <Field label="Вопрос">
            <textarea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              required
              placeholder="Как спрашивают реальные пользователи или машинные диалоги"
              data-testid="geo-question"
            />
          </Field>
          <Field label="Приоритет">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high')}
              data-testid="geo-priority"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </Field>
          <Field label="Заметки (необязательно)">
            <input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Button type="submit" data-testid="geo-create">
            Записать вопрос
          </Button>
        </form>
      </Card>

      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Инвентарь вопросов">
        {queries.length === 0 ? (
          <EmptyState>Вопросов пока нет.</EmptyState>
        ) : (
          <Table
            rows={queries}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Вопрос', render: (row) => row.question },
              { header: 'Приоритет', render: (row) => <code>{row.priority}</code> },
              {
                header: 'Статус',
                render: (row) => <code data-testid={`geo-status-${row.id}`}>{statusLabels[row.status]}</code>,
              },
              {
                header: 'Причина отклонения',
                render: (row) => (row.statusReason ? row.statusReason : '—'),
              },
              {
                header: 'Действия',
                render: (row) => (
                  <span className="row-actions">
                    {row.status === 'open' ? (
                      <Button onClick={() => move(row.id, 'planned')} data-testid={`geo-plan-${row.id}`}>
                        В план
                      </Button>
                    ) : null}
                    {row.status === 'planned' ? (
                      <Button onClick={() => move(row.id, 'answered')} data-testid={`geo-answer-${row.id}`}>
                        Отвечен
                      </Button>
                    ) : null}
                    {row.status === 'open' || row.status === 'planned' ? (
                      <Button
                        onClick={() => {
                          setDismissingId(dismissingId === row.id ? null : row.id)
                          setDismissReason('')
                        }}
                        data-testid={`geo-dismiss-${row.id}`}
                      >
                        Отклонить
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>

      {dismissingId ? (
        <Card title="Отклонение вопроса">
          <form onSubmit={dismiss}>
            <Field label="Причина (обязательна)">
              <input
                value={dismissReason}
                onChange={(event) => setDismissReason(event.target.value)}
                required
                placeholder="Например: повтор существующего вопроса"
                data-testid="geo-dismiss-reason"
              />
            </Field>
            <Button type="submit" data-testid="geo-dismiss-submit">
              Отклонить с причиной
            </Button>
          </form>
        </Card>
      ) : null}

      <Card title="Снимки видимости">
        <form onSubmit={createSnapshot}>
          <Field label="Вопрос">
            <select
              value={snapshotQueryId}
              onChange={(event) => {
                setSnapshotQueryId(event.target.value)
                void loadSnapshots(event.target.value)
              }}
              data-testid="snapshot-query"
            >
              <option value="">— выберите вопрос —</option>
              {openForSnapshots.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.question}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Интерфейс">
            <select value={snapEngine} onChange={(event) => setSnapEngine(event.target.value)} data-testid="snapshot-engine">
              <option value="yandex">Яндекс Поиск</option>
              <option value="google">Google</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="perplexity">Perplexity</option>
              <option value="gigachat">GigaChat</option>
              <option value="other">Другой</option>
            </select>
          </Field>
          <Field label="Бренд упомянут">
            <input
              type="checkbox"
              checked={snapMentioned}
              onChange={(event) => setSnapMentioned(event.target.checked)}
              data-testid="snapshot-mentioned"
            />
          </Field>
          {snapMentioned ? (
            <Field label="Позиция упоминания">
              <input
                type="number"
                min={1}
                value={snapPosition}
                onChange={(event) => setSnapPosition(event.target.value)}
                data-testid="snapshot-position"
              />
            </Field>
          ) : null}
          <Field label="Формулировка ответа (необязательно)">
            <textarea
              rows={2}
              value={snapExcerpt}
              onChange={(event) => setSnapExcerpt(event.target.value)}
              data-testid="snapshot-excerpt"
            />
          </Field>
          <Button type="submit" data-testid="snapshot-create">
            Записать снимок
          </Button>
        </form>

        {snapshots.length === 0 ? (
          <EmptyState>Снимков по выбранному вопросу нет.</EmptyState>
        ) : (
          <Table
            rows={snapshots}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Когда', render: (row) => new Date(row.capturedAt).toLocaleString('ru-RU') },
              { header: 'Интерфейс', render: (row) => <code>{row.searchEngine}</code> },
              {
                header: 'Бренд',
                render: (row) =>
                  row.brandMentioned ? `да, позиция ${row.mentionPosition ?? '—'}` : 'нет',
              },
              { header: 'Ответ', render: (row) => row.answerExcerpt ?? '—' },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
