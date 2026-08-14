import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { LoginPage, fetchMe, logoutSession, useAuthed } from './features/auth'
import { ServiceRequestsPage } from './features/service-requests'
import { ResearchPage } from './features/research'
import { ContentPage } from './features/content'
import { FunnelPage, LeadsPage, PublicationsPage } from './features/publications'
import { EvidencePage } from './features/evidence'
import { GeoPage } from './features/geo'
import { Button } from './components/ui'
import { api, bootstrapSession } from './platform/api'
import './styles.css'

function Shell({ onLogout }: { onLogout: () => void }) {
  const [requestId, setRequestId] = useState<string | null>(null)

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav>
          <NavLink to="/requests" data-testid="nav-requests">
            Заявки
          </NavLink>
          <NavLink to="/research" data-testid="nav-research">
            Research
          </NavLink>
          <NavLink to="/content" data-testid="nav-content">
            Контент
          </NavLink>
          <NavLink to="/publications" data-testid="nav-publications">
            Публикации
          </NavLink>
          <NavLink to="/leads" data-testid="nav-leads">
            Лиды
          </NavLink>
          <NavLink to="/funnel" data-testid="nav-funnel">
            Воронка
          </NavLink>
          <NavLink to="/evidence" data-testid="nav-evidence">
            Факты
          </NavLink>
          <NavLink to="/geo" data-testid="nav-geo">
            GEO
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <Button onClick={onLogout} data-testid="logout-button">
            Выйти
          </Button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/requests" element={<ServiceRequestsPage />} />
          <Route
            path="/research"
            element={
              <div>
                <RequestPicker onPick={setRequestId} />
                <ResearchPage requestId={requestId} />
              </div>
            }
          />
          <Route
            path="/content"
            element={
              <div>
                <RequestPicker onPick={setRequestId} />
                <ContentPage requestId={requestId} />
              </div>
            }
          />
          <Route path="/publications" element={<PublicationsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/funnel" element={<FunnelPage />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route path="/geo" element={<GeoPage />} />
          <Route path="*" element={<Navigate to="/requests" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function RequestPicker({ onPick }: { onPick: (id: string | null) => void }) {
  const [requests, setRequests] = useState<Array<{ id: string; requestNumber: string; title: string }>>([])

  useEffect(() => {
    void api<{ requests: Array<{ id: string; requestNumber: string; title: string }> }>('GET', '/api/service-requests')
      .then((body) => setRequests(body.requests))
      .catch(() => setRequests([]))
  }, [])

  return (
    <div className="picker">
      <label>
        Заявка:{' '}
        <select
          defaultValue=""
          onChange={(event) => onPick(event.target.value || null)}
          data-testid="request-picker"
        >
          <option value="">Все</option>
          {requests.map((request) => (
            <option key={request.id} value={request.id}>
              {request.requestNumber} — {request.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(useAuthed())
  const [ready, setReady] = useState(useAuthed())
  const [me, setMe] = useState<{ email: string } | null>(null)

  useEffect(() => {
    void bootstrapSession()
      .then((ok) => setAuthed(ok))
      .finally(() => setReady(true))
  }, [])

  const onLogin = () => {
    setAuthed(true)
    void fetchMe().then((body) => setMe(body.user)).catch(() => setMe(null))
  }

  const onLogout = async () => {
    await logoutSession()
    setAuthed(false)
    setMe(null)
  }

  if (!ready) return null

  if (!authed) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<LoginPage onLogin={onLogin} />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Shell onLogout={onLogout} />
    </BrowserRouter>
  )
}
