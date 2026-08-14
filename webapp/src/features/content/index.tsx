/**
 * Content: briefs, items, the editor and the approval queue
 * (docs/CONTENT_PIPELINE.md steps 7–15).
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Field, Table } from '../../components/ui'

interface BriefRow {
  id: string
  clusterId: string
  title: string
  outline: Array<{ heading: string; intent: string | null; factsToVerify: string[] }>
  status: string
  contentHash: string
  llmRunId: string | null
}

interface RevisionRow {
  id: string
  revisionNumber: number
  bodyMarkdown: string
  metaTitle: string | null
  metaDescription: string | null
  contentHash: string
  authorKind: string
}

interface ItemRow {
  id: string
  briefId: string
  slug: string
  title: string
  status: string
  currentRevisionId: string | null
  revisions: RevisionRow[]
}

export function ContentPage({ requestId }: { requestId: string | null }) {
  const [briefs, setBriefs] = useState<BriefRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [clusters, setClusters] = useState<Array<{ id: string; title: string }>>([])
  const [editing, setEditing] = useState<{ item: ItemRow; body: string; metaTitle: string; metaDescription: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    try {
      const query = requestId ? `?requestId=${requestId}` : ''
      const [briefBody, itemBody, clusterBody] = await Promise.all([
        api<{ briefs: BriefRow[] }>('GET', `/api/content/briefs${query}`),
        api<{ items: ItemRow[] }>('GET', '/api/content/items'),
        api<{ clusters: Array<{ id: string; title: string }> }>('GET', `/api/research/clusters${query}`),
      ])
      setBriefs(briefBody.briefs)
      setItems(itemBody.items)
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

  const createBrief = async (clusterId: string) => {
    try {
      await api('POST', '/api/content/briefs', { clusterId })
      setNotice('Бриф создан; генерация поставлена в очередь.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать бриф')
    }
  }

  const reviewBrief = async (briefId: string, decision: 'approve' | 'reject') => {
    try {
      await api('POST', `/api/content/briefs/${briefId}/review`, { decision })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ревью не удалось')
    }
  }

  const createItem = async (briefId: string) => {
    try {
      await api('POST', '/api/content/items', { briefId })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать статью')
    }
  }

  const saveRevision = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      await api('POST', `/api/content/items/${editing.item.id}/revisions`, {
        contentItemId: editing.item.id,
        bodyMarkdown: editing.body,
        metaTitle: editing.metaTitle || undefined,
        metaDescription: editing.metaDescription || undefined,
      })
      setEditing(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Сохранение не удалось')
    }
  }

  const approveRevision = async (itemId: string, revision: RevisionRow) => {
    try {
      await api('POST', '/api/approvals', {
        subjectType: 'content_revision',
        subjectId: revision.id,
        contentHash: revision.contentHash,
        decision: 'approved',
      })
      setNotice('Ревизия одобрена.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Одобрение не удалось')
    }
  }

  return (
    <div>
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Брифы">
        {clusters.length > 0 ? (
          <div className="inline-form">
            <Field label="Кластер">
              <select data-testid="brief-cluster" defaultValue="">
                <option value="" disabled>
                  Выберите кластер
                </option>
                {clusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              onClick={() => {
                const select = document.querySelector('[data-testid="brief-cluster"]') as HTMLSelectElement
                if (select.value) void createBrief(select.value)
              }}
              data-testid="brief-create"
            >
              Создать бриф
            </Button>
          </div>
        ) : (
          <EmptyState>Сначала соберите кластеры.</EmptyState>
        )}
        <Table
          rows={briefs}
          keyFor={(row) => row.id}
          columns={[
            { header: 'Название', render: (row) => row.title },
            {
              header: 'Разделы',
              render: (row) => (Array.isArray(row.outline) ? row.outline.length : 0),
            },
            { header: 'Статус', render: (row) => <code data-testid={`brief-status-${row.id}`}>{row.status}</code> },
            {
              header: 'Действия',
              render: (row) =>
                row.status === 'in_review' ? (
                  <span className="actions">
                    <Button onClick={() => reviewBrief(row.id, 'approve')} data-testid={`brief-approve-${row.id}`}>
                      Одобрить
                    </Button>
                    <Button onClick={() => reviewBrief(row.id, 'reject')}>Отклонить</Button>
                  </span>
                ) : row.status === 'approved' ? (
                  <Button onClick={() => createItem(row.id)} data-testid={`item-create-${row.id}`}>
                    Создать статью
                  </Button>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>

      <Card title="Статьи">
        {items.length === 0 ? (
          <EmptyState>Статей пока нет.</EmptyState>
        ) : (
          <Table
            rows={items}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Название', render: (row) => row.title },
              { header: 'Статус', render: (row) => <code data-testid={`item-status-${row.id}`}>{row.status}</code> },
              { header: 'Ревизий', render: (row) => row.revisions.length },
              {
                header: 'Действия',
                render: (row) => {
                  const current = row.revisions[row.revisions.length - 1]
                  return (
                    <span className="actions">
                      <Button
                        onClick={() =>
                          setEditing({
                            item: row,
                            body: current?.bodyMarkdown ?? '',
                            metaTitle: current?.metaTitle ?? '',
                            metaDescription: current?.metaDescription ?? '',
                          })
                        }
                        data-testid={`item-edit-${row.id}`}
                      >
                        Редактировать
                      </Button>
                      {current ? (
                        <Button onClick={() => approveRevision(row.id, current)} data-testid={`revision-approve-${row.id}`}>
                          Одобрить ревизию
                        </Button>
                      ) : null}
                    </span>
                  )
                },
              },
            ]}
          />
        )}
      </Card>

      {editing ? (
        <Card title={`Редактор: ${editing.item.title}`}>
          <form onSubmit={saveRevision}>
            <Field label="Meta title">
              <input
                value={editing.metaTitle}
                onChange={(event) => setEditing({ ...editing, metaTitle: event.target.value })}
                data-testid="editor-meta-title"
              />
            </Field>
            <Field label="Meta description">
              <input
                value={editing.metaDescription}
                onChange={(event) => setEditing({ ...editing, metaDescription: event.target.value })}
                data-testid="editor-meta-description"
              />
            </Field>
            <Field label="Текст (markdown)">
              <textarea
                rows={12}
                value={editing.body}
                onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                data-testid="editor-body"
              />
            </Field>
            <Button type="submit" data-testid="editor-save">
              Сохранить ревизию
            </Button>
            <Button type="button" onClick={() => setEditing(null)}>
              Закрыть
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  )
}
