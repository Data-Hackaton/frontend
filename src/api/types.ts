// Ответ API по разделу 10 ТЗ; держать в синхроне с backend/src/backend/schema.py.

export type JobStatus = 'processing' | 'done' | 'failed'
export type Verdict = 'violation' | 'no_violation'

export interface EvidenceFrame {
  timestamp_sec: number
  image_base64: string // JPEG без префикса data:
}

// Сверх схемы ТЗ: нормативный источник для карточки нарушения.
export interface Rule {
  document: string
  clause?: string
  url?: string
}

export interface Violation {
  type: string
  timecode_sec: number
  description: string
  evidence_frames: EvidenceFrame[] // 1–3
  rule?: Rule
}

export interface AnalyzeResponse {
  job_id: string
}

export interface JobResponse {
  job_id: string
  status: JobStatus
  verdict?: Verdict
  violations?: Violation[]
  error?: string
}
