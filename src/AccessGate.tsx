import { lazy, Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAccess, fixtureMode } from './state/access'
import './AccessGate.css'

const AccessForm = lazy(() => import('./AccessForm'))

export function AccessGate({ children }: { children: ReactNode }) {
  const { status, expiresAt, check, expire } = useAccess()
  useEffect(() => { void check() }, [check])
  useEffect(() => {
    if (fixtureMode) return
    const channel = new BroadcastChannel('forte-access')
    channel.onmessage = () => expire('')
    const visible = () => { if (!document.hidden) void check() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pageshow', visible)
    return () => { channel.close(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', visible) }
  }, [check, expire])
  useEffect(() => {
    if (!expiresAt || status !== 'ready') return
    const timeout = window.setTimeout(expire, Math.max(0, expiresAt * 1000 - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [expiresAt, status, expire])
  if (status === 'ready') return children
  return <main className="access-page">
    <header className="access-brand"><img src="/assets/forte-logo.svg" alt="Forte" width="110" /><span>Видеоаудит кассовых операций</span></header>
    <Suspense fallback={<section className="access-panel" role="status">Открываем вход…</section>}>
      {status === 'checking' ? <section className="access-panel" role="status">Проверяем доступ…</section> : <AccessForm />}
    </Suspense>
    <footer className="access-footer">Forte · Видеоаудит</footer>
  </main>
}
