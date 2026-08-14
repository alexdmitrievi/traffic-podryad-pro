/**
 * Research: CSV import and topic clusters (docs/CONTENT_PIPELINE.md steps 2–6).
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Field, Table } from '../../components/ui'

interface KeywordRow {
  id: string
  phrase: string
  normalizedPhrase: string
  intent: string
  productId: string | null
  regionId: string | null
}

interface ClusterRow {
  id: string
  title: string
  status: string
  pillarKeywordId: string | null
  productId: string | null
  regionId: string | null
  keywords: Array<{ keywordId: string; relevance: number }>
}

export function ResearchPage({ requestId }: { requestId: string | null }) {
  const [keywords, setKeywords] = useState<KeywordRow[]>([])
  const [clusters, setClusters] = useState<ClusterRow[]>([])
  const [csv, setCsv] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const query = requestId ? `?requestId=${requestId}` : ''
  const load = async () => {
    try {
      const [keywordBody, clusterBody] = await Promise.all([
        api<{ keywords: KeywordRow[] }>('GET', `/api/research/keywords${query}`),
        api<{ clusters: ClusterRow[] }>('GET', `/api/research/clusters${query}`),
      ])
      setKeywords(keywordBody.keywords)
      setClusters(clusterBody.clusters)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  const importCsv = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!requestId) {
      setError('Выберите заявку, чтобы импортировать ключи')
      return
    }
    setError(null)
    setNotice(null)
    try {
      const body = await api<{ received: number; created: number; duplicates: number }>(
        'POST',
        '/api/research/imports',
        { requestId, csv },
      )
      setNotice(`Получено: ${body.received}, создано: ${body.created}, дублей: ${body.duplicates}`)
      setCsv('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Импорт отклонён')
    }
  }

  const clusterize = async () => {
    if (!requestId) {
      setError('Выберите заявку, чтобы кластеризовать ключи')
      return
    }
    setError(null)
    try {
      await api('POST', '/api/research/clusters', { requestId })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Кластеризация не удалась')
    }
  }

  return (
    <div>
      <Card title="Импорт CSV">
        <form onSubmit={importCsv}>
          <Field label="CSV (phrase,volume)">
            <textarea
              rows={6}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={'phrase,volume\nдизельное топливо оптом омск,320'}
              data-testid="import-csv"
            />
          </Field>
          <Button type="submit" data-testid="import-submit">
            Импортировать
          </Button>
          <Button type="button" onClick={clusterize} data-testid="cluster-create">
            Собрать кластеры
          </Button>
        </form>
        {notice ? <Alert kind="ok">{notice}</Alert> : null}
      </Card>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Ключи">
        {keywords.length === 0 ? (
          <EmptyState>Ключей пока нет.</EmptyState>
        ) : (
          <Table
            rows={keywords}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Фраза', render: (row) => row.phrase },
              { header: 'Интент', render: (row) => <code>{row.intent}</code> },
              { header: 'Продукт', render: (row) => row.productId ?? '—' },
              { header: 'Регион', render: (row) => row.regionId ?? '—' },
            ]}
          />
        )}
      </Card>

      <Card title="Кластеры">
        {clusters.length === 0 ? (
          <EmptyState>Кластеров пока нет.</EmptyState>
        ) : (
          <Table
            rows={clusters}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Название', render: (row) => row.title },
              { header: 'Ключей', render: (row) => row.keywords.length },
              { header: 'Статус', render: (row) => <code>{row.status}</code> },
              { header: 'ID', render: (row) => <code data-testid={`cluster-id-${row.id}`}>{row.id}</code> },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
