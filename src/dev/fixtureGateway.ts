import type { AuditEventView, BoxView, EventTypeView, ManualEventInput, VideoAuditGateway, VideoView, WorkspaceSnapshot } from '../contracts/ui'

const now = new Date('2026-10-17T10:24:00+05:00')
const scene = '/assets/scene-fixture.svg'
const videos: VideoView[] = [
  { id: 'r1', title: 'Касса 04 · Утренняя смена', camera: 'Камера 04', recordedAt: now.toISOString(), duration: 145, width: 640, height: 960, frameUrl: scene, job: { id: 'j1', status: 'done' } },
  { id: 'r2', title: 'Касса 02 · Дневная смена', camera: 'Камера 02', recordedAt: '2026-10-16T09:07:00Z', duration: 91, width: 640, height: 960, frameUrl: scene, job: { id: 'j2', status: 'done' } },
  { id: 'r3', title: 'Касса 01 · Вечерняя смена', camera: 'Камера 01', recordedAt: '2026-10-16T13:42:00Z', duration: 114, width: 640, height: 960, frameUrl: scene, job: { id: 'j3', status: 'done' } },
  { id: 'r4', title: 'Касса 04 · Приём наличных', camera: 'Камера 04', recordedAt: '2026-10-14T06:15:00Z', duration: 127, width: 640, height: 960, frameUrl: scene, job: { id: 'j4', status: 'done' } },
]
const eventTypes: EventTypeView[] = [
  { id: 'personal-item', title: 'Личные вещи на кассовом столе', description: 'Предмет сотрудника находится рядом с денежными средствами.', observable: 'Предмет и банкноты одновременно видны на столе.', kind: 'violation', custom: false, status: 'published', samples: [] },
  { id: 'cash-on-table', title: 'Наличные остались на столе', description: 'Деньги предыдущей операции остаются на столе.', observable: 'Клиент покинул зону, банкноты ещё видны.', kind: 'violation', custom: false, status: 'published', samples: [] },
  { id: 'unattended', title: 'Кассир покинул рабочее место', description: 'Сотрудник отсутствует в кассовой зоне.', observable: 'Кассовое место видно без сотрудника.', kind: 'warning', custom: false, status: 'published', samples: [] },
  { id: 'client-arrival', title: 'Клиент подошёл к кассе', description: 'Начало взаимодействия с новым клиентом.', observable: 'Человек появился в клиентской зоне.', kind: 'expected', custom: false, status: 'published', samples: [] },
  { id: 'cash-machine', title: 'Деньги помещены в машинку', description: 'Шаг обработки наличных.', observable: 'Банкноты перемещены к счётной машинке.', kind: 'expected', custom: false, status: 'published', samples: [] },
  { id: 'camera-occluded', title: 'Обзор камеры перекрыт', description: 'Часть рабочего места временно не видна.', observable: 'Значимая область кадра закрыта.', kind: 'quality', custom: false, status: 'published', samples: [] },
  { id: 'recording-gap', title: 'Разрыв записи', description: 'В записи отсутствует часть времени.', observable: 'Временная шкала имеет пропуск.', kind: 'quality', custom: false, status: 'published', samples: [] },
]
const events: AuditEventView[] = [
  { id: 'e1', videoId: 'r1', typeId: 'personal-item', title: 'Личные вещи на кассовом столе', description: 'Предмет находится рядом с банкнотами.', kind: 'violation', start: 17.2, end: 19.2, review: 'pending', source: 'model', score: .87, rule: 'Проверить требования к рабочему месту.' },
  { id: 'e2', videoId: 'r1', typeId: 'cash-on-table', title: 'Наличные остались на столе', description: 'После завершения операции банкноты остаются на столе.', kind: 'violation', start: 43.4, end: 46, review: 'pending', source: 'model', score: .79 },
  { id: 'e3', videoId: 'r2', typeId: 'unattended', title: 'Кассир покинул рабочее место', description: 'Сотрудник отсутствует на фрагменте записи.', kind: 'warning', start: 31.1, end: 38, review: 'pending', source: 'model', score: .72 },
  { id: 'e4', videoId: 'r4', typeId: 'cash-on-table', title: 'Наличные остались на столе', description: 'Банкноты видны после ухода клиента.', kind: 'violation', start: 56.5, end: 60, review: 'pending', source: 'model', score: .81 },
  { id: 'e5', videoId: 'r2', typeId: 'client-arrival', title: 'Клиент подошёл к кассе', description: 'Новый клиент появился в зоне обслуживания.', kind: 'expected', start: 8.2, end: 10, review: 'none', source: 'model' },
  { id: 'e6', videoId: 'r4', typeId: 'camera-occluded', title: 'Обзор камеры перекрыт', description: 'Часть стола не видна.', kind: 'quality', start: 72, end: 75, review: 'pending', source: 'model' },
]
const boxes: BoxView[] = [
  { id: 'b1', videoId: 'r1', time: 17.2, cls: 'person', bbox: [.35,.11,.62,.34], source: 'model', confidence: .93 },
  { id: 'b2', videoId: 'r1', time: 17.2, cls: 'banknotes', bbox: [.37,.46,.58,.54], source: 'model', confidence: .85 },
  { id: 'b3', videoId: 'r1', time: 17.2, cls: 'cash_machine', bbox: [.63,.33,.81,.47], source: 'model', confidence: .88 },
  { id: 'b4', videoId: 'r1', time: 43.4, cls: 'banknotes', bbox: [.38,.47,.58,.55], source: 'model' },
]

let data: WorkspaceSnapshot = { videos, events, boxes, eventTypes, pipeline: { datasetStage: 'idle', trainingStage: 'idle', batchStage: 'idle', processedVideos: 0, totalVideos: videos.length } }
const copy = () => structuredClone(data)
const uid = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 9)}`
const typeById = (id: string) => data.eventTypes.find(item => item.id === id)

export const fixtureGateway: VideoAuditGateway = {
  async load() { return copy() },
  async upload(file, recordedAt) {
    const id = uid('r')
    data.videos.unshift({ id, title: file.name, camera: 'Загруженная запись', recordedAt: recordedAt || new Date().toISOString(), duration: 120, width: 640, height: 960, frameUrl: scene, job: { id: uid('j'), status: 'processing', stage: 'Анализ', progress: .3 } })
  },
  async reviewEvent(eventId, decision, comment) {
    const event = data.events.find(item => item.id === eventId)
    if (!event) throw new Error('Событие не найдено')
    event.review = decision; event.reviewComment = comment
  },
  async saveBoxes(videoId, time, next) {
    data.boxes = data.boxes.filter(box => box.videoId !== videoId || Math.abs(box.time - time) > .001)
    data.boxes.push(...next.map(box => ({ ...box, source: 'human' as const })))
  },
  async saveManualEvent(input: ManualEventInput) {
    const type = typeById(input.typeId)
    if (!type || type.status !== 'published') throw new Error('Выберите опубликованный тип события')
    const previous = input.id ? data.events.find(event => event.id === input.id) : undefined
    const value: AuditEventView = { id: previous?.id || uid('manual-'), videoId: input.videoId, typeId: input.typeId, title: type.title, description: input.description, kind: type.kind, start: input.start, end: input.end, review: previous?.review || 'pending', source: 'human' }
    if (previous) Object.assign(previous, value)
    else data.events.push(value)
  },
  async deleteManualEvent(eventId) { data.events = data.events.filter(event => event.id !== eventId || event.source !== 'human') },
  async createEventType(input) {
    data.eventTypes.push({ id: uid('custom-'), title: input.title, description: input.description, observable: input.observable, kind: input.kind, custom: true, status: 'draft', samples: [{ id: uid('sample-'), ...input.firstSample, review: 'pending' }] })
  },
  async addSample(typeId, sample) {
    const type = typeById(typeId)
    if (!type || type.status !== 'draft') throw new Error('Черновик не найден')
    if (type.samples.some(s => s.videoId === sample.videoId && s.review !== 'rejected')) throw new Error('Для каждого примера нужна отдельная запись')
    type.samples.push({ id: uid('sample-'), ...sample, review: 'pending' })
  },
  async reviewSample(typeId, sampleId, decision) {
    const sample = typeById(typeId)?.samples.find(item => item.id === sampleId)
    if (!sample) throw new Error('Фрагмент не найден')
    sample.review = decision
  },
  async publishEventType(typeId) {
    const type = typeById(typeId)
    if (!type || new Set(type.samples.filter(sample => sample.review === 'approved').map(sample => sample.videoId)).size < 10) throw new Error('Нужно подтвердить примеры из 10 разных видео')
    type.status = 'published'
    const first = type.samples[0]
    data.events.push({ id: uid('manual-'), videoId: first.videoId, typeId, title: type.title, description: type.description, kind: type.kind, start: first.start, end: first.end, review: 'pending', source: 'human' })
  },
  async buildDataset() { data.pipeline.datasetStage = 'ready'; data.pipeline.datasetVersion = `v${Number(data.pipeline.datasetVersion?.slice(1) || 0) + 1}`; data.pipeline.trainingStage = 'idle'; data.pipeline.batchStage = 'idle' },
  async trainModel() { if (data.pipeline.datasetStage !== 'ready') throw new Error('Сначала соберите набор данных'); data.pipeline.trainingStage = 'running'; await new Promise(resolve => setTimeout(resolve, 650)); data.pipeline.trainingStage = 'ready'; data.pipeline.modelVersion = `v${Number(data.pipeline.modelVersion?.slice(1) || 0) + 1}` },
  async rerunArchive() { if (data.pipeline.trainingStage !== 'ready') throw new Error('Сначала обучите модель'); data.pipeline.batchStage = 'running'; data.pipeline.processedVideos = 0; await new Promise(resolve => setTimeout(resolve, 650)); data.pipeline.processedVideos = data.videos.length; data.pipeline.batchStage = 'ready' },
}
