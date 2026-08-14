import type { ButtonHTMLAttributes } from 'react'

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props
  return <button className={`btn ${className}`} {...rest} />
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'info' | 'ok'; children: React.ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Table<T>({
  columns,
  rows,
  keyFor,
}: {
  columns: Array<{ header: string; render: (row: T) => React.ReactNode }>
  rows: T[]
  keyFor: (row: T) => string
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={keyFor(row)}>
            {columns.map((column, index) => (
              <td key={index}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>
}
