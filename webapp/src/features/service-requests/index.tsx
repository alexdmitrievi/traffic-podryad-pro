/**
 * Service requests: the front door of the platform (docs/SERVICE_REQUESTS.md).
 */

import { useEffect, useState } from 'react'
import { api } from '../../platform/api'
import { Alert, Button, Card, EmptyState, Field, Table } from '../../components/ui'

interface RequestRow {
  id: string
  requestNumber: string
  serviceLine: string
  title: string
  objective: string
  status: string
  statusReason: string | null
}

interface PlanRow {
  id: string
  version: number
  planKind: string
  content: { kind: string }
  contentHash: string
  status: string
}

interface RequestDetail extends RequestRow {
  events: Array<{ id: string; toStatus: string; reason: string | null; occurredAt: string }>
  plans: PlanRow[]
}

const serviceLineNames: Record<string, string> = {
  seo_content: 'SEO-контент',
  b2b_outreach: 'B2B outreach',
  telegram_marketing: 'Telegram',
  complex_package: 'Комплексный пакет',
}

export function ServiceRequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ serviceLine: 'seo_content', title: '', objective: '' })
  const [detail, setDetail] = useState<RequestDetail | null>(null)

  const load = async () => {
    try {
      const body = await api<{ requests: RequestRow[] }>('GET', '/api/service-requests')
      setRequests(body.requests)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await api('POST', '/api/service-requests', form)
      setForm({ serviceLine: 'seo_content', title: '', objective: '' })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка создания')
    }
  }

  const act = async (id: string, action: string, payload?: Record<string, unknown>) => {
    try {
      await api('POST', `/api/service-requests/${id}/${action}`, payload)
      await load()
      if (detail?.id === id) await openDetail(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция не удалась')
    }
  }

  const openDetail = async (id: string) => {
    try {
      const body = await api<RequestDetail>('GET', `/api/service-requests/${id}`)
      setDetail(body)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ошибка загрузки')
    }
  }

  return (
    <div>
      <Card title="Новая заявка">
        <form onSubmit={create} className="inline-form">
          <Field label="Линия">
            <select
              value={form.serviceLine}
              onChange={(event) => setForm({ ...form, serviceLine: event.target.value })}
              data-testid="request-service-line"
            >
              {Object.entries(serviceLineNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Заголовок">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              data-testid="request-title"
            />
          </Field>
          <Field label="Цель">
            <input
              value={form.objective}
              onChange={(event) => setForm({ ...form, objective: event.target.value })}
              required
              data-testid="request-objective"
            />
          </Field>
          <Button type="submit" data-testid="request-create">
            Создать
          </Button>
        </form>
      </Card>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card title="Заявки">
        {requests.length === 0 ? (
          <EmptyState>Заявок пока нет.</EmptyState>
        ) : (
          <Table
            rows={requests}
            keyFor={(row) => row.id}
            columns={[
              { header: 'Номер', render: (row) => <code>{row.requestNumber}</code> },
              { header: 'Линия', render: (row) => serviceLineNames[row.serviceLine] ?? row.serviceLine },
              { header: 'Заголовок', render: (row) => row.title },
              { header: 'Статус', render: (row) => <code data-testid={`request-status-${row.requestNumber}`}>{row.status}</code> },
              {
                header: 'Действия',
                render: (row) => (
                  <RequestActions
                    row={row}
                    onAction={async (action, payload) => act(row.id, action, payload)}
                    onOpen={() => openDetail(row.id)}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {detail ? (
        <Card title={`${detail.requestNumber} — ${detail.title}`}>
          <h3>История</h3>
          <ul>
            {detail.events.map((event) => (
              <li key={event.id}>
                → {event.toStatus}
                {event.reason ? ` (${event.reason})` : ''}
              </li>
            ))}
          </ul>
          {detail.status === 'planning' ? (
            <PlanForm
              requestId={detail.id}
              serviceLine={detail.serviceLine}
              onCreate={() => openDetail(detail.id)}
            />
          ) : null}
          <h3>Планы</h3>
          {detail.plans.length === 0 ? (
            <EmptyState>Планов нет.</EmptyState>
          ) : (
            <Table
              rows={detail.plans}
              keyFor={(plan) => plan.id}
              columns={[
                { header: 'Версия', render: (plan) => `v${plan.version}` },
                { header: 'Вид', render: (plan) => plan.planKind },
                { header: 'Статус', render: (plan) => plan.status },
                {
                  header: 'Действия',
                  render: (plan) =>
                    plan.status === 'draft' ? (
                      <PlanApprove
                        planId={plan.id}
                        contentHash={plan.contentHash}
                        onApprove={(decision, note) =>
                          act(detail.id, 'approve-plan', { planId: plan.id, contentHash: plan.contentHash, decision, note })
                        }
                      />
                    ) : null,
                },
              ]}
            />
          )}
          {detail.plans.some((plan) => plan.planKind === 'complex_package' && plan.status === 'approved') ? (
            <Button onClick={() => act(detail.id, 'decompose', {})} data-testid="package-decompose">
              Декомпозировать пакет
            </Button>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}

function RequestActions({
  row,
  onAction,
  onOpen,
}: {
  row: RequestRow
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>
  onOpen: () => void
}) {
  const nextByStatus: Record<string, Array<{ status: string; label: string }>> = {
    draft: [{ status: 'submitted', label: 'Подать' }],
    submitted: [{ status: 'triage', label: 'В разбор' }],
    triage: [
      { status: 'accepted', label: 'Принять' },
      { status: 'rejected', label: 'Отклонить' },
    ],
    accepted: [{ status: 'planning', label: 'В планирование' }],
    planning: [],
    plan_approved: [{ status: 'in_delivery', label: 'В исполнение' }],
    in_delivery: [{ status: 'delivered', label: 'Доставлено' }],
    on_hold: [{ status: 'planning', label: 'Возобновить' }],
  }

  const actions = nextByStatus[row.status] ?? []

  return (
    <span className="actions">
      {actions.map((action) => (
        <Button
          key={action.status}
          onClick={() => onAction('status', { status: action.status })}
          data-testid={`request-action-${row.requestNumber}-${action.status}`}
        >
          {action.label}
        </Button>
      ))}
      <Button onClick={onOpen} data-testid={`request-open-${row.requestNumber}`}>
        Открыть
      </Button>
    </span>
  )
}

function PlanForm({
  requestId,
  serviceLine,
  onCreate,
}: {
  requestId: string
  serviceLine: string
  onCreate: () => void
}) {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const content = planContentFor(serviceLine, goal)
      await api('POST', `/api/service-requests/${requestId}/plans`, { requestId, content })
      onCreate()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать план')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="inline-form">
      <Field label="Цель / концепция плана">
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          required
          data-testid="plan-goal"
        />
      </Field>
      <Button type="submit" disabled={busy} data-testid="plan-create">
        Создать план
      </Button>
      {error ? <Alert kind="error">{error}</Alert> : null}
    </form>
  )
}

function planContentFor(serviceLine: string, goal: string): Record<string, unknown> {
  if (serviceLine === 'b2b_outreach') {
    return {
      kind: 'b2b_outreach',
      idealCustomerProfile: goal,
      segments: [{ name: 'Сегмент 1', traits: ['профиль'], estimatedSize: null }],
      valueHypotheses: ['Ценность.'],
      assumedLegalBasis: 'Требуется заключение юриста.',
    }
  }
  if (serviceLine === 'telegram_marketing') {
    return { kind: 'telegram_marketing', channelConcept: goal, optInMechanics: 'Пользователь сам пишет первым.' }
  }
  if (serviceLine === 'complex_package') {
    return {
      kind: 'complex_package',
      overallGoal: goal,
      childRequests: [
        { serviceLine: 'seo_content', title: 'SEO-часть', objective: 'Органика.' },
      ],
    }
  }
  return { kind: 'seo_content', goals: [goal], plannedArticleCount: 1 }
}

function PlanApprove({
  planId,
  contentHash,
  onApprove,
}: {
  planId: string
  contentHash: string
  onApprove: (decision: 'approved' | 'rejected', note?: string) => Promise<void>
}) {
  return (
    <span className="actions">
      <Button onClick={() => onApprove('approved')} data-testid={`plan-approve-${planId}`}>
        Одобрить
      </Button>
      <Button onClick={() => onApprove('rejected', 'Отклонено')}>Отклонить</Button>
    </span>
  )
}
