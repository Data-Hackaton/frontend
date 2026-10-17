import type { ProcedureView } from './contracts/ui'

const SEEN: Record<string, string> = { partly_observable: 'видно частично', context_required: 'нужен контекст', not_visually_verifiable: 'по видео не проверить' }

/** Процедура проверки темы из нормативного корпуса: что установить человеку и какие шаги видны на записи. */
export function ProcedureChecklist({ procedures }: { procedures?: ProcedureView[] }) {
  if (!procedures?.length) return null
  return <div className="procedure-note">{procedures.map(procedure => <div key={procedure.id}><strong>Что проверить: {procedure.title.toLowerCase()}</strong><ul>{procedure.check.map(item => <li key={item}>{item}</li>)}</ul><ol>{procedure.steps.map((step, index) => <li key={index}><span>{step.action}</span>{step.observability && <small>{SEEN[step.observability] ?? step.observability}</small>}</li>)}</ol>{procedure.limits && <p>{procedure.limits}</p>}</div>)}</div>
}
