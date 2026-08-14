/**
 * GEO: вопросный инвентарь, ручные снимки видимости и ответные ассеты
 * (docs/GEO.md, юниты 2–4).
 *
 * Человек записывает вопросы, которые реально задают, и триажит их:
 * open → planned → answered, либо dismissed с обязательной причиной.
 * Для open/planned вопросов снимаются снимки видимости вручную, в реальных
 * интерфейсах поисковиков и ассистентов — без парсинга и автоматизации.
 * Ответные ассеты строятся только на верифицированных claims и одобряются
 * через общий gate, привязанный к content hash.
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

interface VerifiedClaim {
  id: string
  statement: string
}

interface GeoAnswer {
  id: string
  queryId: string
  question: string
  bodyMarkdown: string
  contentHash: string
  linkedClaimIds: string[]
  isApproved: boolean
  approvalId: string | null
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

  const [answers, setAnswers] = useState<GeoAnswer[]>([])
  const [verifiedClaims, setVerifiedClaims] = useState<VerifiedClaim[]>([])
  const [newAnswerQueryId, setNewAnswerQueryId] = useState('')
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)
  const [answerBody, setAnswerBody] = useState('')
  const [answerClaimIds, setAnswerClaimIds] = useState<string[]>([])

  const load = async () => {
    try {
      const body = await api<{ queries: GeoQuery[] }>('GET', '/api/geo/queries')
      setQueries(body.queries)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  const loadAnswers = async () => {
    try {
      const body = await api<{ answers: GeoAnswer[] }>('GET', '/api/geo/answers')
      setAnswers(body.answers)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ответы не загрузились')
    }
  }

  const loadVerifiedClaims = async () => {
    try {
      const body = await api<{ claims: Array<{ id: string; statement: string }> }>(
        'GET',
        '/api/evidence/claims?status=verified',
      )
      setVerifiedClaims(body.claims)
    } catch {
      setVerifiedClaims([])
    }
  }

  const openAnswer = (answer: GeoAnswer) => {
    setSelectedAnswerId(answer.id)
    setAnswerBody(answer.bodyMarkdown)
    setAnswerClaimIds(answer.linkedClaimIds)
  }

  useEffect(() => {
    void load()
    void loadAnswers()
    void loadVerifiedClaims()
  }, [])

  const selectedAnswer = answers.find((entry) => entry.id === selectedAnswerId) ?? null
  const plannedWithoutAnswer = queries.filter(
    (entry) =>
      entry.status === 'planned' && !answers.some((answer) => answer.queryId === entry.id),
  )

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

  const createAnswer = async () => {
    if (!newAnswerQueryId) {
      setError('Выберите planned-вопрос для ответа')
      return
    }
    setError(null)
    setNotice(null)
    try {
      const answer = await api<GeoAnswer>('POST', `/api/geo/queries/${newAnswerQueryId}/answer`, {
        bodyMarkdown: '',
        linkedClaimIds: [],
      })
      setNotice('Ответ создан; напишите текст, привяжите факты и одобрите.')
      setNewAnswerQueryId('')
      await loadAnswers()
      await load()
      openAnswer({ ...answer, question: '', isApproved: false, approvalId: null })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ответ не создан')
    }
  }

  const saveAnswer = async () => {
    if (!selectedAnswerId) return
    setError(null)
    setNotice(null)
    try {
      const saved = await api<GeoAnswer>('PATCH', `/api/geo/answers/${selectedAnswerId}`, {
        bodyMarkdown: answerBody,
        linkedClaimIds: answerClaimIds,
      })
      setNotice('Ответ сохранён; хеш обновлён.')
      await loadAnswers()
      openAnswer({ ...saved, question: selectedAnswer?.question ?? '', isApproved: false, approvalId: null })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ответ не сохранён')
    }
  }

  const approveAnswer = async () => {
    if (!selectedAnswer) return
    setError(null)
    setNotice(null)
    try {
      // The gate compares against the hash the asset carries right now; fetch it at the
      // moment of the decision instead of trusting a possibly stale copy in the UI state.
      const fresh = await api<{ answers: GeoAnswer[] }>(
        'GET',
        `/api/geo/answers?queryId=${selectedAnswer.queryId}`,
      )
      const current = fresh.answers[0]
      if (!current) throw new Error('Ответ не найден')

      await api('POST', `/api/geo/answers/${selectedAnswer.id}/approve`, {
        contentHash: current.contentHash,
      })
      setNotice('Ответ одобрен; вопрос перешёл в answered.')
      await loadAnswers()
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Одобрение не записано')
    }
  }

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

      <Card title="Ответные ассеты">
        <div className="picker">
          <label>
            Planned-вопрос:{' '}
            <select
              value={newAnswerQueryId}
              onChange={(event) => setNewAnswerQueryId(event.target.value)}
              data-testid="answer-create-query"
            >
              <option value="">— выберите вопрос —</option>
              {plannedWithoutAnswer.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.question}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={createAnswer} data-testid="answer-create">
            Создать ответ
          </Button>
        </div>

        {answers.length === 0 ? (
          <EmptyState>Ответных ассетов пока нет.</EmptyState>
        ) : (
          <Table
            rows={answers}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Вопрос', render: (row) => row.question },
              {
                header: 'Статус',
                render: (row) => (
                  <code data-testid={`answer-status-${row.id}`}>
                    {row.isApproved ? 'approved' : 'draft'}
                  </code>
                ),
              },
              {
                header: 'Действия',
                render: (row) => (
                  <Button onClick={() => openAnswer(row)} data-testid={`answer-open-${row.id}`}>
                    Открыть
                  </Button>
                ),
              },
            ]}
          />
        )}

        {selectedAnswer ? (
          <div className="answer-editor">
            <Field label="Текст ответа (проверено человеком)">
              <textarea
                rows={8}
                value={answerBody}
                onChange={(event) => setAnswerBody(event.target.value)}
                data-testid="answer-body"
              />
            </Field>
            <div className="field">
              <span>Подтверждённые факты, на которых построен ответ</span>
              <div className="claim-checks">
                {verifiedClaims.map((claim) => (
                  <label key={claim.id} className="claim-check">
                    <input
                      type="checkbox"
                      checked={answerClaimIds.includes(claim.id)}
                      onChange={(event) =>
                        setAnswerClaimIds((current) =>
                          event.target.checked
                            ? [...current, claim.id]
                            : current.filter((id) => id !== claim.id),
                        )
                      }
                      data-testid={`answer-claim-${claim.id}`}
                    />
                    <span>{claim.statement}</span>
                  </label>
                ))}
                {verifiedClaims.length === 0 ? <EmptyState>Верифицированных фактов пока нет.</EmptyState> : null}
              </div>
            </div>
            <div className="row-actions">
              <Button onClick={saveAnswer} data-testid="answer-save">
                Сохранить
              </Button>
              <Button onClick={approveAnswer} disabled={selectedAnswer.isApproved} data-testid="answer-approve">
                {selectedAnswer.isApproved ? 'Одобрен' : 'Одобрить'}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
