import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'
import { useAccess } from './state/access'
import './components/arc/foundation.css'

export default function AccessForm() {
  const { busy, error, login } = useAccess()
  const [token, setToken] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    const submitted = token.trim()
    setToken('')
    await login(submitted)
  }
  return <section className="access-panel" aria-labelledby="access-title">
    <LockKeyhole className="access-icon" size={28} aria-hidden="true" />
    <h1 id="access-title">Доступ к видеоаудиту</h1>
    <p className="access-description">Введите токен, который вам передала команда проекта.</p>
    <form onSubmit={event => void submit(event)}>
      <Input label="Токен доступа" type="password" name="access-token" autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} error={error || undefined} required disabled={busy} />
      <Button type="submit" loading={busy} disabled={!token.trim()}><span>{busy ? 'Проверяем…' : 'Открыть рабочую область'}</span><ArrowRight size={18} /></Button>
    </form>
  </section>
}
