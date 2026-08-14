/**
 * Publications and the lead funnel (docs/ATTRIBUTION.md section 7).
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Table } from '../../components/ui'

interface PublicationRow {
  id: string
  contentItemId: string
  revisionId: string
  approvalId: string
  target: string
  status: string
  publicUrl: string | null
  publishedAt: string | null
}

interface ItemRow {
  id: string
  title: string
  status: string
  currentRevisionId: string | null
}

export function PublicationsPage() {
  const [publications, setPublications] = useState<PublicationRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    try {
      const [publicationBody, itemBody] = await Promise.all([
        api<{ publications: PublicationRow[] }>('GET', '/api/publications'),
        api<{ items: ItemRow[] }>('GET', '/api/content/items'),
      ])
      setPublications(publicationBody.publications)
      setItems(itemBody.items)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const publish = async (item: ItemRow) => {
    if (!item.currentRevisionId) return
    setError(null)
    setNotice(null)
    try {
      const created = await api<{ id: string }>('POST', '/api/publications', {
        contentItemId: item.id,
        revisionId: item.currentRevisionId,
      })
      setNotice(`Публикация создана: ${created.id}`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Публикация отклонена')
    }
  }

  return (
    <div>
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Опубликовать">
        {items.length === 0 ? (
          <EmptyState>Статей нет.</EmptyState>
        ) : (
          <Table
            rows={items}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Статья', render: (row) => row.title },
              { header: 'Статус', render: (row) => <code>{row.status}</code> },
              {
                header: 'Действие',
                render: (row) => (
                  <Button onClick={() => publish(row)} data-testid={`publish-${row.id}`}>
                    Опубликовать
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Публикации">
        {publications.length === 0 ? (
          <EmptyState>Публикаций нет.</EmptyState>
        ) : (
          <Table
            rows={publications}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Статус', render: (row) => <code data-testid={`publication-status-${row.id}`}>{row.status}</code> },
              { header: 'URL', render: (row) => row.publicUrl ?? '—' },
              { header: 'Опубликовано', render: (row) => row.publishedAt ?? '—' },
            ]}
          />
        )}
      </Card>
    </div>
  )
}

export function LeadsPage() {
  const [leads, setLeads] = useState<Array<{ id: string; contactName: string; phone: string | null; status: string; consentAt: string }>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{ leads: Array<{ id: string; contactName: string; phone: string | null; status: string; consentAt: string }> }>('GET', '/api/leads')
      .then((body) => setLeads(body.leads))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'))
  }, [])

  return (
    <div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <Card title="Лиды">
        {leads.length === 0 ? (
          <EmptyState>Лидов пока нет.</EmptyState>
        ) : (
          <Table
            rows={leads}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Контакт', render: (row) => row.contactName },
              { header: 'Телефон', render: (row) => row.phone ?? '—' },
              { header: 'Статус', render: (row) => <code>{row.status}</code> },
              { header: 'Согласие', render: (row) => new Date(row.consentAt).toISOString() },
            ]}
          />
        )}
      </Card>
    </div>
  )
}

export function FunnelPage() {
  const [summary, setSummary] = useState<{
    publishedContentCount: number
    leadCount: number
    attributedLeadCount: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<{
      publishedContentCount: number
      leadCount: number
      attributedLeadCount: number
    }>('GET', '/api/analytics/funnel')
      .then(setSummary)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'))
  }, [])

  return (
    <div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <Card title="Воронка">
        {!summary ? (
          <EmptyState>Данных нет.</EmptyState>
        ) : (
          <dl className="funnel">
            <div>
              <dt>Опубликовано материалов</dt>
              <dd data-testid="funnel-published">{summary.publishedContentCount}</dd>
            </div>
            <div>
              <dt>Лидов всего</dt>
              <dd data-testid="funnel-leads">{summary.leadCount}</dd>
            </div>
            <div>
              <dt>С атрибуцией</dt>
              <dd data-testid="funnel-attributed">{summary.attributedLeadCount}</dd>
            </div>
          </dl>
        )}
      </Card>
    </div>
  )
}
