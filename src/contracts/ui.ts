/** UI-facing contract. The API adapter belongs to the backend integration owner. */
export type ReviewState = 'pending' | 'approved' | 'rejected' | 'none'
export type EventKind = 'violation' | 'warning' | 'quality' | 'expected'
export type WorkspaceMode = 'view' | 'audit' | 'training'
export type PipelineStage = 'idle' | 'running' | 'ready' | 'failed'

export interface JobView {
  id: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  stage?: string
  progress?: number
  error?: string
}

export interface VideoView {
  id: string
  title: string
  camera: string
  recordedAt: string
  duration: number
  width: number
  height: number
  streamUrl?: string
  frameUrl?: string
  job?: JobView
}

export interface AuditEventView {
  id: string
  videoId: string
  typeId: string
  title: string
  description: string
  kind: EventKind
  start: number
  end: number
  review: ReviewState
  reviewComment?: string
  source: 'model' | 'human'
  score?: number
  rule?: string
  evidenceUrls?: string[]
  /** Классы боксов, относящиеся к событию: их подсвечивает режим «Нарушения» над видео. */
  classes?: string[]
}

/** Normalized [x1,y1,x2,y2] coordinates (0..1), converted to pixels in the API adapter. */
export interface BoxView {
  id: string
  videoId: string
  time: number
  cls: string
  bbox: [number, number, number, number]
  source: 'model' | 'human'
  confidence?: number
}

export interface EventSampleView {
  id: string
  videoId: string
  start: number
  end: number
  review: 'pending' | 'approved' | 'rejected'
}

// Процедура проверки из нормативного корпуса (data_prepare/reference/topics.yaml)
export interface ProcedureView {
  id: string
  title: string
  check: string[]
  limits?: string
  steps: { action: string; observability?: string }[]
}

export interface EventTypeView {
  id: string
  title: string
  description: string
  observable: string
  kind: EventKind
  custom: boolean
  status: 'published' | 'draft'
  samples: EventSampleView[]
  procedures?: ProcedureView[]
}

export interface TokenView {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export interface PipelineView {
  datasetVersion?: string
  datasetStage: PipelineStage
  modelVersion?: string
  trainingStage: PipelineStage
  batchStage: PipelineStage
  processedVideos: number
  totalVideos: number
  error?: string
}

export interface WorkspaceSnapshot {
  videos: VideoView[]
  events: AuditEventView[]
  boxes: BoxView[]
  eventTypes: EventTypeView[]
  tokens: TokenView[]
  pipeline: PipelineView
}

export interface ManualEventInput {
  id?: string
  videoId: string
  typeId: string
  start: number
  end: number
  description: string
}

export interface EventTypeInput {
  title: string
  description: string
  observable: string
  kind: EventKind
  firstSample: { videoId: string; start: number; end: number }
}

export interface VideoAuditGateway {
  load(): Promise<WorkspaceSnapshot>
  upload(file: File, recordedAt?: string): Promise<void>
  reviewEvent(eventId: string, decision: 'approved' | 'rejected', comment: string): Promise<void>
  saveBoxes(videoId: string, time: number, boxes: BoxView[]): Promise<void>
  saveManualEvent(input: ManualEventInput): Promise<void>
  deleteManualEvent(eventId: string): Promise<void>
  createEventType(input: EventTypeInput): Promise<void>
  addSample(typeId: string, sample: { videoId: string; start: number; end: number }): Promise<void>
  reviewSample(typeId: string, sampleId: string, decision: 'approved' | 'rejected'): Promise<void>
  publishEventType(typeId: string): Promise<void>
  createToken(name: string): Promise<string>
  revokeToken(tokenId: string): Promise<void>
  buildDataset(): Promise<void>
  trainModel(): Promise<void>
  rerunArchive(): Promise<void>
}

export const emptySnapshot: WorkspaceSnapshot = {
  videos: [], events: [], boxes: [], eventTypes: [], tokens: [],
  pipeline: { datasetStage: 'idle', trainingStage: 'idle', batchStage: 'idle', processedVideos: 0, totalVideos: 0 },
}
