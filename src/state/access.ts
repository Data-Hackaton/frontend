import { create } from 'zustand'

export const fixtureMode = import.meta.env.DEV && import.meta.env.VITE_API !== '1'
const endpoint = '/api/v1/auth/session'
let revision = 0

interface AccessState {
  status: 'checking' | 'locked' | 'ready'
  busy: boolean
  error: string
  expiresAt: number | null
  check: () => Promise<void>
  login: (token: string) => Promise<boolean>
  logout: () => Promise<void>
  expire: (message?: string) => void
}

async function sessionRequest(init?: RequestInit) {
  return fetch(endpoint, { ...init, credentials: 'same-origin', cache: 'no-store' })
}

export const useAccess = create<AccessState>((set, get) => ({
  status: fixtureMode ? 'ready' : 'checking', busy: false, error: '', expiresAt: null,
  async check() {
    if (fixtureMode || get().busy) return
    const current = ++revision
    try {
      const response = await sessionRequest()
      if (!response.ok) throw new Error()
      const data = await response.json() as { authenticated: boolean; expires_at: number | null }
      if (current !== revision) return
      set({ status: data.authenticated ? 'ready' : 'locked', expiresAt: data.expires_at, error: '' })
    } catch {
      if (current !== revision) return
      set({ status: 'locked', expiresAt: null, error: 'Не удалось связаться с сервисом. Проверьте соединение и повторите вход.' })
    }
  },
  async login(token) {
    if (get().busy) return false
    const current = ++revision
    set({ busy: true, error: '' })
    try {
      const response = await sessionRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      if (current !== revision) return false
      if (!response.ok) {
        set({ error: response.status === 401 ? 'Неверный токен. Проверьте его и попробуйте снова.' : 'Не удалось войти. Попробуйте ещё раз.' })
        return false
      }
      // Confirm that the browser accepted the cookie (e.g. Secure requires HTTPS).
      const confirmed = await sessionRequest()
      if (!confirmed.ok) throw new Error()
      const data = await confirmed.json() as { authenticated: boolean; expires_at: number | null }
      if (current !== revision) return false
      if (!data.authenticated) {
        set({ error: 'Не удалось сохранить доступ. Откройте сайт по HTTPS и разрешите cookie.' })
        return false
      }
      set({ status: 'ready', expiresAt: data.expires_at })
      return true
    } catch {
      set({ error: 'Нет соединения с сервисом. Попробуйте ещё раз.' })
      return false
    } finally { if (current === revision) set({ busy: false }) }
  },
  async logout() {
    if (get().busy) return
    ++revision
    set({ busy: true, error: '' })
    try {
      const response = await sessionRequest({ method: 'DELETE' })
      if (!response.ok) throw new Error()
      set({ status: 'locked', expiresAt: null })
      const channel = new BroadcastChannel('forte-access')
      channel.postMessage('logout')
      channel.close()
    } catch { set({ error: 'Не удалось выйти. Проверьте соединение и повторите.' }) }
    finally { set({ busy: false }) }
  },
  expire(message = 'Доступ завершён. Введите токен ещё раз.') { ++revision; set({ busy: false, status: 'locked', expiresAt: null, error: message }) },
}))
