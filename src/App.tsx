import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Bell, CalendarDays, Flag, Grid2X2, Layers3, LogOut, Settings2, X } from 'lucide-react'
import { gateway } from './api/gateway'
import { emptySnapshot } from './contracts/ui'
import type { DataScope, WorkspaceSnapshot } from './contracts/ui'
import { shortDate } from './lib/format'
import { useUi } from './state/ui'
import { useAccess } from './state/access'
import { Overview } from './Overview'
import './App.css'

export type Mutate = <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>

const Upload = lazy(() => import('./Screens').then(module => ({ default: module.Upload })))
const Archive = lazy(() => import('./Screens').then(module => ({ default: module.Archive })))
const Attention = lazy(() => import('./Screens').then(module => ({ default: module.Attention })))
const Catalog = lazy(() => import('./Screens').then(module => ({ default: module.Catalog })))
const Tokens = lazy(() => import('./Screens').then(module => ({ default: module.Tokens })))
const Cameras = lazy(() => import('./Screens').then(module => ({ default: module.Cameras })))
const Workspace = lazy(() => import('./Workspace'))

const navigation = [
  { route: 'overview', label: 'Обзор', icon: Grid2X2 },
  { route: 'archive', label: 'Архив', icon: CalendarDays },
  { route: 'attention', label: 'Требует внимания', icon: Flag },
  { route: 'catalog', label: 'Каталог', icon: Layers3 },
  { route: 'tokens', label: 'Настройки', icon: Settings2 },
] as const

export default function App() {
  const { logout, busy: accessBusy, error: accessError } = useAccess()
  const ui = useUi(useShallow(state => ({ route: state.route, videoId: state.videoId, readNoticeIds: state.readNoticeIds,
    notificationsOpen: state.notificationsOpen, navigate: state.navigate, toggleNotifications: state.toggleNotifications,
    markNoticeRead: state.markNoticeRead })))
  const [data, setData] = useState<WorkspaceSnapshot>(emptySnapshot)
  const [loadedScope, setLoadedScope] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [today] = useState(() => shortDate(new Date().toISOString()))
  const scopeKey = ui.route === 'workspace' ? `workspace/${ui.videoId ?? ''}` : ui.route
  const request = useRef(0)
  const invalidateRequests = useCallback(() => { request.current++ }, [])
  const refresh = useCallback(async () => {
    const key = scopeKey
    const sequence = ++request.current
    try {
      const result = await gateway.load(ui.route as DataScope, ui.videoId)
      if (request.current === sequence) { setData(previous => ({ ...previous, ...result })); setLoadedScope(key); setError('') }
    } catch (cause) {
      if (request.current === sequence) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить данные'); setLoadedScope(key) }
    }
  }, [scopeKey, ui.route, ui.videoId])
  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => { if (navigator.onLine && !document.hidden) void refresh() }, 15000)
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); invalidateRequests() }
  }, [refresh, invalidateRequests])
  useEffect(() => {
    if (['overview', 'archive', 'attention', 'workspace'].includes(ui.route)) return
    const updateNotices = () => { if (navigator.onLine && !document.hidden) void gateway.load('overview').then(result => setData(previous => ({ ...previous, ...result }))).catch(() => {}) }
    const kickoff = window.setTimeout(updateNotices, 800)
    const timer = window.setInterval(updateNotices, 30000)
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer) }
  }, [ui.route])
  useEffect(() => {
    const onHash = () => useUi.getState().syncHash()
    const onOnline = () => setOnline(navigator.onLine)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOnline)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOnline)
    }
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 4500)
    return () => window.clearTimeout(timer)
  }, [message])
  const mutate: Mutate = async (operation, success) => {
    if (!navigator.onLine) { setMessage('Нет соединения. Подключитесь к сети и повторите действие.'); return undefined }
    try {
      const result = await operation()
      await refresh()
      if (success) setMessage(success)
      return result
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Не удалось выполнить действие'); return undefined }
  }
  const pending = data.events.filter(event => event.review === 'pending')
  const groups = data.videos.map(video => ({ video, events: pending.filter(event => event.videoId === video.id) })).filter(group => group.events.length)
  const unread = groups.filter(group => !ui.readNoticeIds.includes(group.video.id)).length
  const current = data.videos.find(video => video.id === ui.videoId)
  const title = ({ overview: 'Обзор', upload: 'Загрузка', archive: 'Архив', attention: 'Требует внимания', catalog: 'Каталог событий', tokens: 'Настройки', cameras: 'Камеры', workspace: current?.title || 'Запись' })[ui.route]
  const loading = loadedScope !== scopeKey
  const content = ui.route === 'overview' ? <Overview data={data} loading={loading} /> :
    ui.route === 'upload' ? <Upload mutate={mutate} /> :
    ui.route === 'archive' ? <Archive data={data} /> :
    ui.route === 'attention' ? <Attention data={data} mutate={mutate} /> :
    ui.route === 'catalog' ? <Catalog data={data} /> :
    ui.route === 'tokens' ? <Tokens /> :
    ui.route === 'cameras' ? <Cameras /> :
    <Workspace data={data} mutate={mutate} />
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img src="/assets/forte-logo-white.svg" alt="Forte" /><span>Видеоаудит<br />кассовых операций</span></div>
      <p className="side-label">Рабочая область</p>
      <nav aria-label="Основная навигация">{navigation.map(item => {
        const Icon = item.icon
        const active = ui.route === item.route || (ui.route === 'workspace' && item.route === 'archive') || (ui.route === 'upload' && item.route === 'overview')
        return <button className={'side-nav-item' + (active ? ' active' : '')} key={item.route} onClick={() => ui.navigate(item.route)} aria-current={active ? 'page' : undefined}><Icon size={18} /><span>{item.label}</span>{item.route === 'attention' && pending.length > 0 && <b className="question-count">{pending.length}</b>}</button>
      })}</nav>
      <div className="side-footer"><span className="online-dot" />Локальный контур<strong>Forte · Видеоаудит</strong><small>Кассовые операции</small></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <div className="breadcrumb">{ui.route === 'workspace' && <><button onClick={() => ui.navigate('archive')}>Архив</button><span>/</span></>}<strong>{title}</strong></div>
        <div className="top-actions">
          <span className="today">{today}</span>
          <div className="notice-anchor">
            <button className="notice-button" onClick={ui.toggleNotifications} aria-label={'Уведомления, непрочитано: ' + unread} aria-expanded={ui.notificationsOpen}><Bell size={18} />{unread > 0 && <b>{unread}</b>}</button>
            {ui.notificationsOpen && <div className="notice-panel"><div className="notice-head"><strong>Уведомления</strong><button onClick={ui.toggleNotifications} aria-label="Закрыть"><X size={17} /></button></div><p>{unread} непрочитано · {pending.length} вопросов ждут решения</p>{groups.length ? groups.map(group => <button className="notice-item" key={group.video.id} onClick={() => { ui.markNoticeRead(group.video.id); ui.navigate('workspace', { videoId: group.video.id, mode: 'audit' }) }}><span className={ui.readNoticeIds.includes(group.video.id) ? 'read-dot' : 'unread-dot'} /><span><strong>{group.video.title}</strong><small>{group.events.length} вопросов · {shortDate(group.video.recordedAt)}</small></span></button>) : <div className="notice-empty">Новых уведомлений нет</div>}</div>}
          </div>
          <button className="access-logout" onClick={() => void logout()} disabled={accessBusy}><LogOut size={16} />Выйти</button>
        </div>
      </header>
      {accessError && <div className="error-banner" role="alert">{accessError}</div>}
      {!online && <div className="offline-banner" role="status">Нет соединения. Просмотр интерфейса доступен; действия с записями временно недоступны.</div>}
      {error && <div className="error-banner" role="alert">{error} <button onClick={() => void refresh()}>Повторить</button></div>}
      <main className="content"><Suspense fallback={<div className="loading-state" role="status">Открываем раздел…</div>}>{loading && ui.route !== 'overview' ? <div className="loading-state" role="status">Загружаем рабочую область…</div> : content}</Suspense></main>
    </div>
    <nav className="mobile-nav" aria-label="Мобильная навигация">{navigation.map(item => { const Icon = item.icon; const active = ui.route === item.route || (ui.route === 'workspace' && item.route === 'archive') || (ui.route === 'upload' && item.route === 'overview'); return <button key={item.route} className={active ? 'active' : ''} onClick={() => ui.navigate(item.route)} aria-current={active ? 'page' : undefined}><Icon size={19} /><span>{item.route === 'attention' ? 'Вопросы' : item.route === 'tokens' ? 'Токены' : item.label}</span>{item.route === 'attention' && pending.length > 0 && <b className="question-count">{pending.length}</b>}</button> })}</nav>
    {message && <div className="app-toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="Закрыть сообщение"><X size={16} /></button></div>}
  </div>
}
