import type {
  AuditEventView, BoxView, EventKind, EventTypeView, JobView, PipelineView, TokenView, VideoAuditGateway, VideoView,
} from '../contracts/ui'
import { fixtureGateway } from '../dev/fixtureGateway'

/** Адаптер интерфейса к API бэкенда /api/v1 (контракт — backend/docs/API.md). Экраны работают только через него. */

const API = '/api/v1'
const BOX_STEP_SEC = .5         // боксы модели — 2 кадра/с (детектор даёт 4); между ними интерфейс интерполирует
const BOX_VIDEOS_PER_LOAD = 4   // сколько записей догружать за один опрос, остальные — в следующих

/** Текст ошибки API: detail строкой или списком ошибок валидации. */
async function failure(response: Response): Promise<Error> {
  let text = `${response.status} ${response.statusText}`
  try {
    const body = await response.json()
    if (typeof body.detail === 'string') text = body.detail
    else if (Array.isArray(body.detail)) text = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
  } catch { /* не JSON */ }
  return new Error(text)
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, init)
  if (!response.ok) throw await failure(response)
  return (response.status === 204 ? undefined : await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// --- ответы API (snake_case) ---------------------------------------------------------------------------------------

interface ApiJob { id: string; status: JobView['status']; stage?: string; progress?: number | null; error?: string | null }
interface ApiVideo {
  id: string; filename: string; source: string; recorded_at: string; duration: number | null
  width: number | null; height: number | null; stream_url: string; last_job: ApiJob | null
}
interface ApiEvent {
  id: number; video_id: string; type_id: string; event: string; status: 'expected' | 'warning' | 'violation'
  actor: string | null; object: string | null; target: string | null
  title: string | null; message: string | null; norm: string | null; t_start: number; t_end: number
  review: AuditEventView['review']; review_comment: string | null; source: 'model' | 'human'
  evidence: { t: number; url: string }[]
}
interface ApiSample { id: number; video_id: string; start: number; end: number; review: 'pending' | 'approved' | 'rejected' }
interface ApiEventType {
  id: string; title: string; description: string; observable: string; kind: EventKind; custom: boolean
  status: 'published' | 'draft'; samples: ApiSample[]
  procedures?: { id: string; title: string; check: string[]; limits: string | null; steps: { action: string; observability: string | null }[] }[]
}
interface ApiBox { id: number; t: number; cls: string; bbox: [number, number, number, number]; conf: number | null; source: string }
interface ApiToken { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface ApiPipeline {
  dataset_version: string | null; dataset_stage: PipelineView['datasetStage']; model_version: string | null
  training_stage: PipelineView['trainingStage']; batch_stage: PipelineView['batchStage']
  processed_videos: number; total_videos: number; error: string | null
}
interface ApiNorm { short?: string }

const CAMERA: Record<string, string> = { upload: 'Загрузка вручную', api: 'API: жюри или бот', camera: 'Камера' }

const video = (v: ApiVideo): VideoView => ({
  id: v.id, title: v.filename, camera: CAMERA[v.source] ?? v.source, recordedAt: v.recorded_at,
  duration: v.duration ?? 0, width: v.width ?? 0, height: v.height ?? 0, streamUrl: v.stream_url,
  frameUrl: `${API}/videos/${v.id}/frame?t=0`,
  job: v.last_job ? {
    id: v.last_job.id, status: v.last_job.status, stage: v.last_job.stage ?? undefined,
    progress: v.last_job.progress ?? undefined, error: v.last_job.error ?? undefined,
  } : undefined,
})

// --- какие боксы относятся к событию (режим «Нарушения» над видео) ------------------------------------------------

const BY_OBJECT: Record<string, string[]> = {
  banknotes: ['banknotes', 'id_card'], id_card: ['banknotes', 'id_card'], bag: ['bag'],
  foreign_object: ['foreign_object', 'bag'], phone: ['phone'], document: ['id_card'],
}
const BY_TARGET: Record<string, string[]> = { cash_machine: ['cash_machine'], safe: ['safe'], safe_top: ['safe'] }
const BY_TITLE: [RegExp, string[]][] = [
  [/компьютер/i, ['computer']], [/сейф/i, ['safe']], [/деньги|наличн|ценност/i, ['banknotes', 'id_card', 'bag']],
  [/личные вещи/i, ['foreign_object', 'bag']], [/посторонн/i, ['person']], [/пересч[её]т/i, ['banknotes', 'cash_machine']],
  [/телефон/i, ['phone']], [/присвоен/i, ['banknotes']],
]

function classesFor(e: ApiEvent): string[] {
  const out = new Set<string>()
  for (const c of BY_OBJECT[e.object ?? ''] ?? []) out.add(c)
  for (const c of BY_TARGET[e.target ?? ''] ?? []) out.add(c)
  if (e.actor === 'cashier' || e.actor === 'client' || e.actor === 'visitor') out.add('person')
  for (const [re, classes] of BY_TITLE) if (e.title && re.test(e.title)) classes.forEach(c => out.add(c))
  return [...out]
}

// --- боксы: кэш по записи, обновляется при новом анализе и после правки ----------------------------------------------

const boxCache = new Map<string, { key: string; boxes: BoxView[] }>()
const staleBoxes = new Set<string>()

async function boxesOf(v: VideoView): Promise<BoxView[]> {
  const rows = await call<ApiBox[]>(`/videos/${v.id}/boxes?step=${BOX_STEP_SEC}`)
  const w = v.width || 1, h = v.height || 1
  return rows.map(b => ({
    id: String(b.id), videoId: v.id, time: b.t, cls: b.cls,
    bbox: [b.bbox[0] / w, b.bbox[1] / h, b.bbox[2] / w, b.bbox[3] / h],
    source: b.source === 'human' ? 'human' : 'model', confidence: b.conf ?? undefined,
  }))
}

async function loadBoxes(videos: VideoView[]): Promise<BoxView[]> {
  const ready = videos.filter(v => v.job?.status === 'done' || boxCache.has(v.id))
  const todo = ready.filter(v => staleBoxes.has(v.id) || boxCache.get(v.id)?.key !== v.job?.id).slice(0, BOX_VIDEOS_PER_LOAD)
  await Promise.all(todo.map(async v => {
    boxCache.set(v.id, { key: v.job?.id ?? '', boxes: await boxesOf(v) })
    staleBoxes.delete(v.id)
  }))
  return ready.flatMap(v => boxCache.get(v.id)?.boxes ?? [])
}

// --- справочники ---------------------------------------------------------------------------------------------------

let norms: Record<string, ApiNorm> | undefined
async function normShort(id: string | null): Promise<string | undefined> {
  if (!id) return undefined
  norms ??= (await call<{ norms: Record<string, ApiNorm> }>('/meta')).norms
  return norms[id]?.short ?? id
}

let videosById = new Map<string, VideoView>()

export const apiGateway: VideoAuditGateway = {
  async load() {
    const [apiVideos, apiEvents, apiTypes, apiTokens, apiPipeline] = await Promise.all([
      call<ApiVideo[]>('/videos?limit=500'), call<ApiEvent[]>('/events'), call<ApiEventType[]>('/event-types'),
      call<ApiToken[]>('/tokens'), call<ApiPipeline>('/pipeline'),
    ])
    const videos = apiVideos.map(video)
    videosById = new Map(videos.map(v => [v.id, v]))
    const typeTitle = new Map(apiTypes.map(t => [t.id, t.title]))
    const events: AuditEventView[] = await Promise.all(apiEvents.map(async e => ({
      id: String(e.id), videoId: e.video_id, typeId: e.type_id, title: e.title ?? typeTitle.get(e.type_id) ?? e.event,
      description: e.message ?? '', kind: e.status, start: e.t_start, end: Math.max(e.t_end, e.t_start),
      review: e.review, reviewComment: e.review_comment ?? undefined, source: e.source, rule: await normShort(e.norm),
      evidenceUrls: e.evidence.map(x => x.url), classes: classesFor(e),
    })))
    const eventTypes: EventTypeView[] = apiTypes.map(t => ({
      id: t.id, title: t.title, description: t.description, observable: t.observable, kind: t.kind, custom: t.custom,
      status: t.status,
      samples: t.samples.map(s => ({ id: String(s.id), videoId: s.video_id, start: s.start, end: s.end, review: s.review })),
      procedures: (t.procedures ?? []).map(p => ({ id: p.id, title: p.title, check: p.check, limits: p.limits ?? undefined,
        steps: p.steps.map(step => ({ action: step.action, observability: step.observability ?? undefined })) })),
    }))
    const tokens: TokenView[] = apiTokens.map(t => ({
      id: String(t.id), name: t.name, prefix: t.prefix, createdAt: t.created_at,
      lastUsedAt: t.last_used_at ?? undefined, revokedAt: t.revoked_at ?? undefined,
    }))
    const pipeline: PipelineView = {
      datasetVersion: apiPipeline.dataset_version ?? undefined, datasetStage: apiPipeline.dataset_stage,
      modelVersion: apiPipeline.model_version ?? undefined, trainingStage: apiPipeline.training_stage,
      batchStage: apiPipeline.batch_stage, processedVideos: apiPipeline.processed_videos,
      totalVideos: apiPipeline.total_videos, error: apiPipeline.error ?? undefined,
    }
    return { videos, events, boxes: await loadBoxes(videos), eventTypes, tokens, pipeline }
  },

  async upload(file, recordedAt) {
    const form = new FormData()
    form.append('file', file)
    if (recordedAt) form.append('recorded_at', new Date(recordedAt).toISOString())
    await call('/videos', { method: 'POST', body: form })
  },

  async reviewEvent(eventId, decision, comment) {
    await call(`/events/${eventId}/review`, json('POST', { decision, comment: comment || null }))
  },

  async saveBoxes(videoId, time, boxes) {
    const v = videosById.get(videoId)
    const w = v?.width || 1, h = v?.height || 1
    const body = boxes.map(b => ({ cls: b.cls, bbox: [b.bbox[0] * w, b.bbox[1] * h, b.bbox[2] * w, b.bbox[3] * h], attributes: {} }))
    await call(`/videos/${videoId}/boxes?t=${time}`, json('PUT', body))
    staleBoxes.add(videoId)
  },

  async saveManualEvent(input) {
    const body = { video_id: input.videoId, type_id: input.typeId, start: input.start, end: input.end, description: input.description }
    await call(input.id ? `/events/${input.id}` : '/events', json(input.id ? 'PUT' : 'POST', body))
  },

  async deleteManualEvent(eventId) {
    await call(`/events/${eventId}`, { method: 'DELETE' })
  },

  async createEventType(input) {
    await call('/event-types', json('POST', {
      title: input.title, description: input.description, observable: input.observable, kind: input.kind,
      first_sample: { video_id: input.firstSample.videoId, start: input.firstSample.start, end: input.firstSample.end },
    }))
  },

  async addSample(typeId, sample) {
    await call(`/event-types/${typeId}/samples`, json('POST', { video_id: sample.videoId, start: sample.start, end: sample.end }))
  },

  async reviewSample(typeId, sampleId, decision) {
    await call(`/event-types/${typeId}/samples/${sampleId}/review`, json('POST', { decision }))
  },

  async publishEventType(typeId) {
    await call(`/event-types/${typeId}/publish`, { method: 'POST' })
  },

  async createToken(name) {
    return (await call<{ token: string }>('/tokens', json('POST', { name }))).token
  },

  async revokeToken(tokenId) {
    await call(`/tokens/${tokenId}`, { method: 'DELETE' })
  },

  async buildDataset() { await call('/pipeline/dataset', { method: 'POST' }) },
  async trainModel() { await call('/pipeline/train', { method: 'POST' }) },
  async rerunArchive() { await call('/pipeline/rerun', { method: 'POST' }) },
}

/** В разработке — фикстуры (pnpm dev), с VITE_API=1 — живой бэкенд через прокси Vite; в сборке — всегда API. */
export const gateway: VideoAuditGateway = import.meta.env.DEV && import.meta.env.VITE_API !== '1' ? fixtureGateway : apiGateway
