export const timecode = (seconds: number) => {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const remainder = Math.max(0, seconds) % 60
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`
}

export const shortDate = (iso: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty',
}).format(new Date(iso))

export const shortTime = (iso: string) => new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty',
}).format(new Date(iso))

export const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Almaty',
}).format(new Date(iso))

export const kindLabel = (kind: string) => ({
  violation: 'Возможное нарушение', warning: 'SOP-предупреждение',
  quality: 'Качество записи', expected: 'Контекст операции',
})[kind as 'violation'] || 'Событие'
