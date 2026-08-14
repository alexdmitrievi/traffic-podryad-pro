/**
 * Факты: реестр подтверждённых источников и утверждений (docs/GEO.md, юнит 1).
 *
 * Здесь человек вводит источники, извлекает из них утверждения и верифицирует их.
 * Только верифицированное и не суперседнутое утверждение может попасть в контент.
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Field, Table } from '../../components/ui'

interface EvidenceSource {
  id: string
  title: string
  kind: string
  url: string | null
  verifiedAt: string | null
  notes: string | null
  claimCount: number
}

interface ClaimCitation {
  id: string
  location: string
  quote: string | null
}

interface Claim {
  id: string
  sourceId: string
  statement: string
  category: string | null
  status: 'verified' | 'unverified' | 'superseded'
  supersededById: string | null
  citations: ClaimCitation[]
}

const kindLabels: Record<string, string> = {
  official_standard: 'ГОСТ/ТУ',
  producer_document: 'Документ производителя',
  regulatory_document: 'Регламент',
  price_list: 'Прайс',
  industry_publication: 'Отраслевая публикация',
  expert_statement: 'Экспертное заключение',
  other: 'Другое',
}

export function EvidencePage() {
  const [sources, setSources] = useState<EvidenceSource[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('producer_document')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')

  const [claimSourceId, setClaimSourceId] = useState('')
  const [statement, setStatement] = useState('')
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const [quote, setQuote] = useState('')

  const [correctedById, setCorrectedById] = useState<string | null>(null)
  const [correctedStatement, setCorrectedStatement] = useState('')

  const load = async () => {
    try {
      const [sourceBody, claimBody] = await Promise.all([
        api<{ sources: EvidenceSource[] }>('GET', '/api/evidence/sources'),
        api<{ claims: Claim[] }>('GET', '/api/evidence/claims'),
      ])
      setSources(sourceBody.sources)
      setClaims(claimBody.claims)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const createSource = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await api('POST', '/api/evidence/sources', {
        title,
        kind,
        ...(url ? { url } : {}),
        ...(notes ? { notes } : {}),
      })
      setNotice('Источник добавлен; проверьте его, чтобы использовать.')
      setTitle('')
      setUrl('')
      setNotes('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Источник не сохранён')
    }
  }

  const verifySource = async (sourceId: string) => {
    setError(null)
    try {
      await api('POST', `/api/evidence/sources/${sourceId}/verify`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Проверка не записана')
    }
  }

  const createClaim = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!claimSourceId) {
      setError('Выберите источник для утверждения')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await api('POST', '/api/evidence/claims', {
        sourceId: claimSourceId,
        statement,
        ...(category ? { category } : {}),
        citations:
          location || quote ? [{ location: location || 'Без раздела', ...(quote ? { quote } : {}) }] : [],
      })
      setNotice('Утверждение добавлено; проверьте его перед использованием.')
      setStatement('')
      setCategory('')
      setLocation('')
      setQuote('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Утверждение не сохранено')
    }
  }

  const verifyClaim = async (claimId: string) => {
    setError(null)
    try {
      await api('POST', `/api/evidence/claims/${claimId}/verify`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Проверка не записана')
    }
  }

  const supersedeClaim = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!correctedById || !correctedStatement.trim()) return
    setError(null)
    setNotice(null)
    try {
      await api('POST', `/api/evidence/claims/${correctedById}/supersede`, {
        statement: correctedStatement,
      })
      setNotice('Исправление записано; проверьте новое утверждение.')
      setCorrectedById(null)
      setCorrectedStatement('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Исправление не записано')
    }
  }

  const sourceTitle = (sourceId: string) => sources.find((source) => source.id === sourceId)?.title ?? '—'

  return (
    <div>
      <Card title="Новый источник">
        <form onSubmit={createSource}>
          <Field label="Название">
            <input value={title} onChange={(event) => setTitle(event.target.value)} required data-testid="source-title" />
          </Field>
          <Field label="Тип">
            <select value={kind} onChange={(event) => setKind(event.target.value)} data-testid="source-kind">
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ссылка (необязательно)">
            <input value={url} onChange={(event) => setUrl(event.target.value)} data-testid="source-url" />
          </Field>
          <Field label="Заметки (необязательно)">
            <input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Button type="submit" data-testid="source-create">
            Добавить источник
          </Button>
        </form>
      </Card>

      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Источники">
        {sources.length === 0 ? (
          <EmptyState>Источников пока нет.</EmptyState>
        ) : (
          <Table
            rows={sources}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Источник', render: (row) => row.title },
              { header: 'Тип', render: (row) => kindLabels[row.kind] ?? row.kind },
              { header: 'Утверждений', render: (row) => row.claimCount },
              {
                header: 'Статус',
                render: (row) =>
                  row.verifiedAt ? (
                    <code>verified</code>
                  ) : (
                    <Button onClick={() => verifySource(row.id)} data-testid={`source-verify-${row.id}`}>
                      Проверить
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Новое утверждение">
        <form onSubmit={createClaim}>
          <Field label="Источник">
            <select
              value={claimSourceId}
              onChange={(event) => setClaimSourceId(event.target.value)}
              data-testid="claim-source"
            >
              <option value="">— выберите источник —</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Утверждение">
            <textarea
              rows={3}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              required
              placeholder="Формулировка факта, который человек проверил в источнике"
              data-testid="claim-statement"
            />
          </Field>
          <Field label="Категория (необязательно)">
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label="Место в источнике (раздел/страница/таблица, необязательно)">
            <input value={location} onChange={(event) => setLocation(event.target.value)} data-testid="claim-location" />
          </Field>
          <Field label="Цитата (необязательно)">
            <input value={quote} onChange={(event) => setQuote(event.target.value)} />
          </Field>
          <Button type="submit" data-testid="claim-create">
            Добавить утверждение
          </Button>
        </form>
      </Card>

      <Card title="Утверждения">
        {claims.length === 0 ? (
          <EmptyState>Утверждений пока нет.</EmptyState>
        ) : (
          <Table
            rows={claims}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Утверждение', render: (row) => row.statement },
              { header: 'Источник', render: (row) => sourceTitle(row.sourceId) },
              {
                header: 'Статус',
                render: (row) => (
                  <code data-testid={`claim-status-${row.id}`}>{row.status}</code>
                ),
              },
              {
                header: 'Действия',
                render: (row) =>
                  row.status === 'superseded' ? (
                    <span>исправлено</span>
                  ) : (
                    <span className="row-actions">
                      {row.status === 'unverified' ? (
                        <Button onClick={() => verifyClaim(row.id)} data-testid={`claim-verify-${row.id}`}>
                          Проверить
                        </Button>
                      ) : null}
                      <Button onClick={() => {
                        setCorrectedById(correctedById === row.id ? null : row.id)
                        setCorrectedStatement(row.statement)
                      }} data-testid={`claim-correct-${row.id}`}>
                        Исправить
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {correctedById ? (
        <Card title="Исправление утверждения">
          <form onSubmit={supersedeClaim}>
            <Field label="Новая формулировка (старая останется в истории)">
              <textarea
                rows={3}
                value={correctedStatement}
                onChange={(event) => setCorrectedStatement(event.target.value)}
                required
                data-testid="claim-corrected-statement"
              />
            </Field>
            <Button type="submit" data-testid="claim-supersede-submit">
              Записать исправление
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  )
}
