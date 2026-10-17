import type { ReactNode } from 'react'
import { Clapperboard } from 'lucide-react'
import type { VideoView } from './contracts/ui'
import { shortDate, shortTime, timecode } from './lib/format'
import { useUi } from './state/ui'

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p></div>
}

export function VideoRow({ video, count, mode = 'view' }: { video: VideoView; count: number; mode?: 'view' | 'audit' }) {
  const navigate = useUi(state => state.navigate)
  return <div className="video-row"><button className="video-row-main" onClick={() => navigate('workspace', { videoId: video.id, mode })}><span className="video-thumb">{video.frameUrl ? <img src={video.frameUrl} alt="" loading="lazy" decoding="async" width="47" height="47" /> : <Clapperboard size={20} />}</span><span><strong>{video.title}</strong><small>{shortDate(video.recordedAt)} · {shortTime(video.recordedAt)} · {timecode(video.duration)}</small></span></button><span className="video-row-status">{video.job?.status === 'processing' || video.job?.status === 'queued' ? <span className="fast-badge info">Обработка</span> : count ? <button className="attention-link" onClick={() => navigate('workspace', { videoId: video.id, mode: 'audit' })}>{count} вопросов</button> : <span className="fast-badge success">Без вопросов</span>}</span></div>
}
