import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Check, ChevronRight, Eye, EyeOff, Flag, Layers3, Maximize2, MousePointer2, Pause, PenLine, Play, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Badge } from './components/arc/badge/badge'
import { Input } from './components/arc/input/input'
import { Textarea } from './components/arc/textarea/textarea'
import { Progress } from './components/arc/progress/progress'
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs'
import { gateway } from './api/gateway'
import { ProcedureChecklist } from './Procedure'
import type { AuditEventView, BoxView, EventKind, VideoView, WorkspaceSnapshot } from './contracts/ui'
import { kindLabel, shortDate, shortTime, timecode } from './lib/format'
import { useUi } from './state/ui'
import type { Mutate } from './App'
import { Empty } from './Screens'

type Props = { data: WorkspaceSnapshot; mutate: Mutate }
type Tool = 'select' | 'box' | 'zone'
const boxClasses = ['person', 'reflection', 'hand', 'banknotes', 'id_card', 'cash_machine', 'safe', 'door', 'phone', 'bag', 'table', 'foreign_object', 'computer', 'ignore_zone']
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
/** Служебные классы (стекло, отражения, дверь, стол) в режиме «Нарушения» не показываются. */
const serviceClasses = new Set(['ignore_zone', 'reflection', 'door', 'table'])
const eventWindowSec = 1.5
const boxModes = [{ id: 'violations', label: 'Нарушения', icon: Flag }, { id: 'all', label: 'Все', icon: Eye },
  { id: 'hidden', label: 'Скрыть', icon: EyeOff }] as const

/* Боксы модели есть только на опорных кадрах (детектор — 4 кадра/с, интерфейс берёт 2). Чтобы рамки не мигали
   между ними, при просмотре бокс плавно ведётся от одного опорного кадра к следующему: пара — тот же класс
   с наибольшим перекрытием; бокс без пары держится до середины промежутка. Редактор работает с точными кадрами. */
const interpolateMaxGapSec = 1.5   // опорные кадры дальше — не интерполируем (детектор пропустил объект)
const holdSec = .6                 // без пары кадров показываем ближайший, если он не дальше
type Frames = { times: number[]; byTime: Map<number, BoxView[]> }

function overlap(a: BoxView['bbox'], b: BoxView['bbox']) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = w * h, union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
  return union > 0 ? inter / union : 0
}

const matches = (x: BoxView, frame: BoxView[]) => frame.some(y => y.cls === x.cls && overlap(x.bbox, y.bbox) > .2)

/** Кадры записи по времени; объект, который детектор пропустил на кадре-другом и нашёл снова на том же месте
 *  (не дальше interpolateMaxGapSec), достраивается в пропущенных кадрах — иначе рамка мигает. */
function indexFrames(boxes: BoxView[]): Frames {
  const byTime = new Map<number, BoxView[]>()
  for (const box of boxes) byTime.set(box.time, [...(byTime.get(box.time) ?? []), box])
  const times = [...byTime.keys()].sort((a, b) => a - b)
  for (let i = 0; i + 2 < times.length; i++) {
    for (const x of byTime.get(times[i]) ?? []) {
      if (x.source === 'human' || matches(x, byTime.get(times[i + 1]) ?? [])) continue
      for (let j = i + 2; j < times.length && times[j] - times[i] <= interpolateMaxGapSec; j++) {
        const y = (byTime.get(times[j]) ?? []).find(item => item.cls === x.cls && overlap(x.bbox, item.bbox) > .2)
        if (!y) continue
        for (let m = i + 1; m < j; m++) {
          const k = (times[m] - times[i]) / (times[j] - times[i])
          byTime.get(times[m])?.push({ ...x, id: `${x.id}~${times[m]}`, time: times[m],
            bbox: x.bbox.map((v, n) => v + (y.bbox[n] - v) * k) as BoxView['bbox'] })
        }
        break
      }
    }
  }
  return { times, byTime }
}

function boxesAt({ times, byTime }: Frames, t: number): BoxView[] {
  if (!times.length) return []
  let lo = 0, hi = times.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid }
  const before = lo > 0 ? times[lo - 1] : undefined, after = lo < times.length ? times[lo] : undefined
  if (before !== undefined && after !== undefined && after - before <= interpolateMaxGapSec) {
    const a = byTime.get(before) ?? [], b = byTime.get(after) ?? [], k = (t - before) / (after - before)
    const used = new Set<BoxView>()
    const out: BoxView[] = []
    for (const x of a) {
      let pair: BoxView | undefined, best = .2
      for (const y of b) if (y.cls === x.cls && !used.has(y)) { const score = overlap(x.bbox, y.bbox); if (score > best) { best = score; pair = y } }
      if (pair) {
        used.add(pair)
        out.push({ ...x, bbox: x.bbox.map((v, i) => v + (pair.bbox[i] - v) * k) as BoxView['bbox'] })
      } else if (k < .5) out.push(x)
    }
    if (k >= .5) out.push(...b.filter(y => !used.has(y)))
    return out
  }
  const near = [before, after].filter((x): x is number => x !== undefined && Math.abs(x - t) <= holdSec)
    .sort((x, y) => Math.abs(x - t) - Math.abs(y - t))[0]
  return near === undefined ? [] : byTime.get(near) ?? []
}

function BoxCanvas({ video, time, allBoxes, events, editing, tool, setTool, selected, setSelected, mutate }: {
  video: VideoView; time: number; allBoxes: BoxView[]; events: AuditEventView[]; editing: boolean; tool: Tool; setTool: (tool: Tool) => void;
  selected: string | null; setSelected: (id: string | null) => void; mutate: Mutate
}) {
  const ui = useUi()
  const key = video.id + '@' + time.toFixed(3)
  const videoBoxes = useMemo(() => allBoxes.filter(box => box.videoId === video.id), [allBoxes, video.id])
  const frames = useMemo(() => indexFrames(videoBoxes), [videoBoxes])
  const source = videoBoxes.filter(box => Math.abs(box.time - time) <= .35)
  const boxes = ui.boxDrafts[key] || source
  // Во время воспроизведения слой боксов идёт за кадром видео (requestAnimationFrame), а не за timeupdate (~4 раза/с);
  // время держим локально, чтобы не перерисовывать весь экран 60 раз в секунду
  const player = useRef<HTMLVideoElement>(null)
  const [liveTime, setLiveTime] = useState<number | null>(null)
  const raf = useRef(0)
  const follow = () => { const element = player.current; if (!element) return; setLiveTime(element.currentTime); raf.current = requestAnimationFrame(follow) }
  const stopFollow = () => { cancelAnimationFrame(raf.current); setLiveTime(null) }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const viewTime = liveTime ?? time
  // Что видно над видео. Редактор кадра показывает всё (точные кадры), иначе боксы не поправить.
  const boxMode = editing ? 'all' : ui.boxMode
  const viewBoxes = editing ? boxes : boxesAt(frames, viewTime)
  const active = events.filter(item => (item.kind === 'violation' || item.kind === 'warning')
    && viewTime >= item.start - eventWindowSec && viewTime <= item.end + eventWindowSec)
    .sort((a, b) => (a.kind === 'violation' ? 0 : 1) - (b.kind === 'violation' ? 0 : 1))
  const eventOf = (box: BoxView) => active.find(item => item.classes?.length ? item.classes.includes(box.cls) : !serviceClasses.has(box.cls))
  const shown = boxMode === 'hidden' ? [] : boxMode === 'all'
    ? viewBoxes.filter(box => editing || !ui.hiddenClasses.includes(box.cls))
    : viewBoxes.filter(box => !serviceClasses.has(box.cls) && eventOf(box))
  const present = Object.entries(viewBoxes.reduce<Record<string, number>>((acc, box) => ({ ...acc, [box.cls]: (acc[box.cls] || 0) + 1 }), {})).sort()
  const dirty = !!ui.boxDrafts[key]
  const pointer = useRef<{ mode: 'draw' | 'move' | 'resize'; start: [number, number]; id: string; original?: BoxView['bbox'] } | null>(null)
  const media = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<BoxView['bbox'] | null>(null)
  const [newClass, setNewClass] = useState('banknotes')
  const current = boxes.find(box => box.id === selected)
  const coordinates = (event: PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = media.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)]
  }
  const update = (next: BoxView[]) => ui.setBoxDraft(key, next)
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editing) return
    const point = coordinates(event)
    const target = event.target as HTMLElement
    const id = target.closest<HTMLElement>('[data-box-id]')?.dataset.boxId
    const box = boxes.find(item => item.id === id)
    if (box && tool === 'select') {
      setSelected(box.id)
      pointer.current = { mode: target.closest('[data-resize]') ? 'resize' : 'move', start: point, id: box.id, original: [...box.bbox] }
    } else if (tool !== 'select') {
      pointer.current = { mode: 'draw', start: point, id: '' }
      setPreview([point[0], point[1], point[0], point[1]])
    } else { setSelected(null); return }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = pointer.current
    if (!active) return
    const point = coordinates(event)
    if (active.mode === 'draw') {
      setPreview([Math.min(active.start[0], point[0]), Math.min(active.start[1], point[1]), Math.max(active.start[0], point[0]), Math.max(active.start[1], point[1])])
      return
    }
    const original = active.original
    if (!original) return
    const dx = point[0] - active.start[0], dy = point[1] - active.start[1]
    let next: BoxView['bbox']
    if (active.mode === 'move') {
      const width = original[2] - original[0], height = original[3] - original[1]
      const x = clamp(original[0] + dx, 0, 1 - width), y = clamp(original[1] + dy, 0, 1 - height)
      next = [x, y, x + width, y + height]
    } else next = [original[0], original[1], clamp(original[2] + dx, original[0] + .02), clamp(original[3] + dy, original[1] + .02)]
    const latest = useUi.getState().boxDrafts[key] || source
    update(latest.map(box => box.id === active.id ? { ...box, bbox: next, source: 'human' } : box))
  }
  const onUp = () => {
    if (pointer.current?.mode === 'draw' && preview && preview[2] - preview[0] >= .02 && preview[3] - preview[1] >= .02) {
      const id = 'new-' + crypto.randomUUID()
      const cls = tool === 'zone' ? 'ignore_zone' : newClass
      update([...boxes, { id, videoId: video.id, time, cls, bbox: preview, source: 'human' }])
      setSelected(id)
      setTool('select')
    }
    pointer.current = null
    setPreview(null)
  }
  const updateBox = (patch: Partial<BoxView>) => {
    if (!current) return
    update(boxes.map(box => box.id === current.id ? { ...box, ...patch, source: 'human' } : box))
  }
  const setCoord = (index: number, percent: number) => {
    if (!current || !Number.isFinite(percent)) return
    const next = [...current.bbox] as BoxView['bbox']
    next[index] = clamp(percent / 100)
    if (next[2] - next[0] < .02 || next[3] - next[1] < .02) return
    updateBox({ bbox: next })
  }
  return <div className="canvas-shell">
    <div className="canvas-toolbar"><strong>{video.camera} / {editing ? 'редактор кадра' : 'видеозапись'}</strong>{editing && <div className="tool-buttons"><button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}><MousePointer2 size={15} /> Выбор</button><button className={tool === 'box' ? 'active' : ''} onClick={() => setTool('box')}><Maximize2 size={15} /> Бокс</button><button className={tool === 'zone' ? 'active' : ''} onClick={() => setTool('zone')}><Layers3 size={15} /> Зона</button></div>}{!editing && <div className="box-mode" role="radiogroup" aria-label="Боксы над видео">{boxModes.map(mode => <button key={mode.id} role="radio" aria-checked={ui.boxMode === mode.id} className={ui.boxMode === mode.id ? 'active' : ''} onClick={() => ui.setBoxMode(mode.id)}><mode.icon size={14} /> {mode.label}</button>)}</div>}</div>
    {!editing && ui.boxMode === 'all' && present.length > 0 && <div className="class-chips" aria-label="Классы на кадре">{present.map(([cls, count]) => <button key={cls} aria-pressed={!ui.hiddenClasses.includes(cls)} className={ui.hiddenClasses.includes(cls) ? 'off' : ''} onClick={() => ui.toggleClass(cls)}>{cls} <b>{count}</b></button>)}</div>}
    <div className="stage"><div className="media-window" ref={media} style={{ aspectRatio: String(video.width) + ' / ' + String(video.height) }}>
      {video.streamUrl ? <video ref={player} src={video.streamUrl} playsInline preload="metadata" id="record-video" onPlay={() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(follow) }} onPause={stopFollow} onEnded={stopFollow} onLoadedMetadata={event => { event.currentTarget.currentTime = useUi.getState().playbackTime }} onTimeUpdate={event => ui.setPlaybackTime(event.currentTarget.currentTime)} /> : video.frameUrl ? <img src={video.frameUrl} alt="Кадр кассовой зоны" /> : <div className="missing-frame">Кадр записи недоступен</div>}
      <span className="camera-stamp">● {video.camera.toUpperCase()} · {shortDate(video.recordedAt)}</span>
      {(editing || boxMode !== 'hidden') && <div className={'box-layer' + (editing ? ' editable' : '')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {shown.map(box => { const hit = boxMode === 'violations' ? eventOf(box) : undefined; return <div key={box.id} data-box-id={box.id} className={'annotation ' + (box.cls === 'ignore_zone' ? 'zone' : '') + (hit ? ' ' + hit.kind : '') + (selected === box.id ? ' selected' : '')} style={{ left: box.bbox[0] * 100 + '%', top: box.bbox[1] * 100 + '%', width: (box.bbox[2] - box.bbox[0]) * 100 + '%', height: (box.bbox[3] - box.bbox[1]) * 100 + '%' }}><span>{hit ? box.cls + ' · ' + hit.title : box.cls}</span>{editing && selected === box.id && <i data-resize aria-hidden="true" />}</div> })}
        {preview && <div className="draw-preview" style={{ left: preview[0] * 100 + '%', top: preview[1] * 100 + '%', width: (preview[2] - preview[0]) * 100 + '%', height: (preview[3] - preview[1]) * 100 + '%' }} />}
      </div>}
    </div></div>
    {editing && <div className="box-editor-controls"><p>{tool === 'box' ? 'Проведите по кадру, чтобы добавить бокс.' : tool === 'zone' ? 'Отметьте область, которую следует исключить.' : 'Выберите бокс, чтобы изменить его.'}</p>{tool === 'box' && <label>Класс нового объекта<select value={newClass} onChange={event => setNewClass(event.target.value)}>{boxClasses.filter(cls => cls !== 'ignore_zone').map(cls => <option key={cls} value={cls}>{cls}</option>)}</select></label>}{current && <div className="selected-box"><div className="selected-box-head"><strong>Выбран: {current.cls}</strong><button onClick={() => { update(boxes.filter(box => box.id !== current.id)); setSelected(null) }}><Trash2 size={15} /> Удалить</button></div><label>Класс<select value={current.cls} onChange={event => updateBox({ cls: event.target.value })}>{boxClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}</select></label><div className="coordinate-grid">{['X1', 'Y1', 'X2', 'Y2'].map((label, index) => <label key={label}>{label}, %<input type="number" min={0} max={100} step={.1} value={Number((current.bbox[index] * 100).toFixed(1))} onChange={event => setCoord(index, Number(event.target.value))} /></label>)}</div></div>}<div className="editor-buttons"><Button size="sm" variant="secondary" disabled={!dirty} onClick={() => { ui.clearBoxDraft(key); setSelected(null) }}><RotateCcw size={15} /> Отменить</Button><Button size="sm" disabled={!dirty} onClick={async () => { const ok = await mutate(async () => { await gateway.saveBoxes(video.id, time, boxes); return true }, 'Разметка сохранена'); if (ok) ui.clearBoxDraft(key) }}><Save size={15} /> Сохранить разметку</Button></div></div>}
  </div>
}

function EventEditor({ data, video, time, mutate }: { data: WorkspaceSnapshot; video: VideoView; time: number; mutate: Mutate }) {
  const ui = useUi()
  const manual = data.events.filter(event => event.videoId === video.id && event.source === 'human')
  const available = data.eventTypes.filter(type => type.status === 'published')
  const custom = data.eventTypes.filter(type => type.custom)
  const [editing, setEditing] = useState<string | null>(null)
  const [typeId, setTypeId] = useState(available[0]?.id || '')
  const [start, setStart] = useState(time)
  const [end, setEnd] = useState(Math.min(video.duration, time + 3))
  const [description, setDescription] = useState('')
  const [title, setTitle] = useState('')
  const [observable, setObservable] = useState('')
  const [kind, setKind] = useState<EventKind>('warning')
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [sampleVideo, setSampleVideo] = useState(video.id)
  const [sampleStart, setSampleStart] = useState(time)
  const [sampleEnd, setSampleEnd] = useState(Math.min(video.duration, time + 3))
  const chosen = custom.find(type => type.id === selectedTypeId) || custom[custom.length - 1]
  const approved = new Set(chosen?.samples.filter(sample => sample.review === 'approved').map(sample => sample.videoId)).size
  const sampleVideos = data.videos.filter(record => !chosen?.samples.some(sample => sample.videoId === record.id && sample.review !== 'rejected'))
  const activeSampleVideo = sampleVideos.some(record => record.id === sampleVideo) ? sampleVideo : sampleVideos[0]?.id || ''
  const activeTypeId = available.some(type => type.id === typeId) ? typeId : available[0]?.id || ''
  const valid = (item: VideoView | undefined, a: number, b: number) => !!item && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && b <= item.duration
  return <div className="editor-content"><div className="editor-intro"><h3>События на записи</h3><p>Отметьте момент, который система пропустила. Готовый тип можно добавить сразу; для нового типа нужны подтверждённые примеры из 10 разных видео.</p></div><div className="segmented editor-choice"><button className={ui.eventEditorTab === 'catalog' ? 'active' : ''} onClick={() => ui.setEventEditorTab('catalog')}>Из каталога</button><button className={ui.eventEditorTab === 'custom' ? 'active' : ''} onClick={() => ui.setEventEditorTab('custom')}>Свой тип</button></div>
    {ui.eventEditorTab === 'catalog' ? <div className="editor-form"><label>Тип события<select value={activeTypeId} onChange={event => setTypeId(event.target.value)}>{available.map(type => <option key={type.id} value={type.id}>{type.title}</option>)}</select></label><div className="interval-fields"><label>Начало, сек.<input type="number" min={0} max={video.duration} step={.1} value={start} onChange={event => setStart(Number(event.target.value))} /></label><label>Конец, сек.<input type="number" min={0} max={video.duration} step={.1} value={end} onChange={event => setEnd(Number(event.target.value))} /></label></div><Textarea label="Что видно на фрагменте" value={description} onChange={event => setDescription(event.target.value)} placeholder="Коротко опишите наблюдаемое поведение" /><p className="field-hint">Кадр на текущем таймкоде будет приложен к событию. Новое событие отправится на проверку человеку.</p><div className="editor-buttons"><Button disabled={!activeTypeId || !description.trim() || !valid(video, start, end)} onClick={async () => { const ok = await mutate(async () => { await gateway.saveManualEvent({ id: editing || undefined, videoId: video.id, typeId: activeTypeId, start, end, description: description.trim() }); return true }, editing ? 'Событие обновлено' : 'Событие добавлено на проверку'); if (ok) { setEditing(null); setDescription('') } }}>{editing ? 'Сохранить изменения' : <><Plus size={15} /> Добавить событие</>}</Button>{editing && <Button variant="secondary" onClick={() => { setEditing(null); setDescription('') }}>Отменить</Button>}</div></div> : <div className="custom-editor">{!chosen && <div className="editor-form"><h3>Новый тип события</h3><Input label="Название события" value={title} onChange={event => setTitle(event.target.value)} placeholder="Например, повторный пересчёт" /><Textarea label="Как выглядит событие на видео" value={observable} onChange={event => setObservable(event.target.value)} placeholder="Опишите видимые действия и объекты" /><label>Категория<select value={kind} onChange={event => setKind(event.target.value as EventKind)}><option value="warning">SOP-предупреждение</option><option value="violation">Возможное нарушение</option><option value="quality">Качество записи</option><option value="expected">Контекст операции</option></select></label><p className="field-hint">Текущий фрагмент станет первым примером. Его нужно подтвердить отдельно.</p><Button disabled={!title.trim() || !observable.trim()} onClick={async () => { const ok = await mutate(async () => { await gateway.createEventType({ title: title.trim(), description: observable.trim(), observable: observable.trim(), kind, firstSample: { videoId: video.id, start: time, end: Math.min(video.duration, time + 3) } }); return true }, 'Черновик типа создан'); if (ok) { setTitle(''); setObservable(''); setSelectedTypeId('') } }}>Создать черновик</Button></div>}
      {chosen && <><div className="custom-picker"><label>Черновик или свой тип<select value={chosen.id} onChange={event => setSelectedTypeId(event.target.value)}>{custom.map(type => <option key={type.id} value={type.id}>{type.title} · {type.status === 'draft' ? 'черновик' : 'опубликован'}</option>)}</select></label><button className="text-action" onClick={() => setSelectedTypeId('new')}>+ Новый тип</button></div>{selectedTypeId === 'new' ? <div className="editor-form"><Input label="Название события" value={title} onChange={event => setTitle(event.target.value)} /><Textarea label="Как выглядит событие на видео" value={observable} onChange={event => setObservable(event.target.value)} /><Button disabled={!title.trim() || !observable.trim()} onClick={async () => { const ok = await mutate(async () => { await gateway.createEventType({ title: title.trim(), description: observable.trim(), observable: observable.trim(), kind, firstSample: { videoId: video.id, start: time, end: Math.min(video.duration, time + 3) } }); return true }, 'Черновик типа создан'); if (ok) { setTitle(''); setObservable(''); setSelectedTypeId('') } }}>Создать черновик</Button></div> : <div className="custom-panel"><div className="custom-top"><div><Badge tone={chosen.status === 'draft' ? 'info' : 'success'} size="sm">{chosen.status === 'draft' ? 'Черновик' : 'Опубликован'}</Badge><h3>{chosen.title}</h3><p>{chosen.observable}</p></div><strong>{approved}/10</strong></div><Progress value={approved} max={10} label="Подтверждённые видео" /><p className="field-hint">Нужны примеры из 10 разных записей. Каждый пример подтвердите отдельно.</p>{chosen.status === 'draft' && <div className="editor-form sample-form"><h4>Добавить видеофрагмент</h4><label>Запись<select value={activeSampleVideo} onChange={event => setSampleVideo(event.target.value)}>{sampleVideos.length === 0 && <option value="">Загрузите ещё записи</option>}{sampleVideos.map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label><div className="interval-fields"><label>Начало, сек.<input type="number" min={0} step={.1} value={sampleStart} onChange={event => setSampleStart(Number(event.target.value))} /></label><label>Конец, сек.<input type="number" min={0} step={.1} value={sampleEnd} onChange={event => setSampleEnd(Number(event.target.value))} /></label></div><Button variant="secondary" size="sm" disabled={!valid(data.videos.find(record => record.id === activeSampleVideo), sampleStart, sampleEnd)} onClick={() => void mutate(() => gateway.addSample(chosen.id, { videoId: activeSampleVideo, start: sampleStart, end: sampleEnd }), 'Фрагмент добавлен на проверку')}><Plus size={15} /> Добавить фрагмент</Button></div>}<div className="sample-list"><h4>Примеры поведения · {approved} из 10 видео</h4>{chosen.samples.map(sample => <div className="sample-row" key={sample.id}><span className="sample-thumb">{data.videos.find(record => record.id === sample.videoId)?.frameUrl ? <img src={data.videos.find(record => record.id === sample.videoId)?.frameUrl} alt="" /> : <Layers3 size={17} />}</span><span><strong>{data.videos.find(record => record.id === sample.videoId)?.title || 'Запись'}</strong><small>{timecode(sample.start)}–{timecode(sample.end)} · {sample.review === 'approved' ? 'Подтверждён' : sample.review === 'rejected' ? 'Отклонён' : 'Ждёт проверки'}</small></span>{chosen.status === 'draft' && <div className="sample-actions">{sample.review !== 'approved' && <button aria-label="Подтвердить фрагмент" onClick={() => void mutate(() => gateway.reviewSample(chosen.id, sample.id, 'approved'))}><Check size={16} /></button>}{sample.review !== 'rejected' && <button aria-label="Отклонить фрагмент" onClick={() => void mutate(() => gateway.reviewSample(chosen.id, sample.id, 'rejected'))}><X size={16} /></button>}</div>}</div>)}</div>{chosen.status === 'draft' && <Button className="publish-button" disabled={approved < 10} onClick={() => void mutate(() => gateway.publishEventType(chosen.id), 'Тип опубликован; исходное событие отправлено на аудит')}>Опубликовать тип и добавить событие</Button>}</div>}</>}
    </div>}
    {manual.length > 0 && <div className="manual-list"><h3>Добавлено человеком · {manual.length}</h3>{manual.map(event => <div className="manual-row" key={event.id}><span><strong>{event.title}</strong><small>{timecode(event.start)} · {event.review === 'pending' ? 'Ожидает проверки' : 'Решено'}</small></span><button onClick={() => { setEditing(event.id); setTypeId(event.typeId); setStart(event.start); setEnd(event.end); setDescription(event.description); ui.setEventEditorTab('catalog') }}>Изменить</button><button aria-label="Удалить событие" onClick={() => { if (window.confirm('Удалить ручное событие?')) void mutate(() => gateway.deleteManualEvent(event.id), 'Событие удалено') }}><Trash2 size={15} /></button></div>)}</div>}
  </div>
}

function Pipeline({ data, mutate }: { data: WorkspaceSnapshot; mutate: Mutate }) {
  const [confirm, setConfirm] = useState(false)
  const pipeline = data.pipeline
  const publishedCustom = data.eventTypes.some(type => type.custom && type.status === 'published')
  return <div className="editor-content"><div className="editor-intro"><h3>Дообучение и повторный анализ</h3><p>В новую версию набора входят опубликованные типы с подтверждёнными фрагментами.</p></div><div className="pipeline-steps"><div><b>1</b><span><strong>Набор данных</strong><small>{pipeline.datasetStage === 'ready' ? 'Версия ' + pipeline.datasetVersion + ' собрана' : pipeline.datasetStage === 'running' ? 'Сборка идёт' : 'Соберите подтверждённые примеры'}</small></span><Button size="sm" variant="secondary" disabled={!publishedCustom || pipeline.datasetStage === 'running'} onClick={() => void mutate(() => gateway.buildDataset(), 'Сборка набора запущена')}>{pipeline.datasetStage === 'ready' ? 'Собрать заново' : 'Собрать'}</Button></div><div><b>2</b><span><strong>Обучение модели</strong><small>{pipeline.trainingStage === 'ready' ? 'Модель ' + pipeline.modelVersion + ' готова' : pipeline.trainingStage === 'running' ? 'Обучение идёт' : 'После сборки данных'}</small></span><Button size="sm" variant="secondary" disabled={pipeline.datasetStage !== 'ready' || pipeline.trainingStage === 'running'} onClick={() => void mutate(() => gateway.trainModel(), 'Обучение запущено')}>Дообучить</Button></div><div><b>3</b><span><strong>Повторный анализ архива</strong><small>{pipeline.batchStage === 'running' ? 'Обработано ' + pipeline.processedVideos + ' из ' + pipeline.totalVideos : pipeline.batchStage === 'ready' ? 'Архив обработан' : 'После готовности модели'}</small></span><Button size="sm" disabled={pipeline.trainingStage !== 'ready' || pipeline.batchStage === 'running'} onClick={() => setConfirm(true)}>Перезапустить</Button></div></div>{pipeline.batchStage === 'running' && <Progress value={pipeline.processedVideos} max={Math.max(1, pipeline.totalVideos)} label="Обработка архива" showValue />}{pipeline.error && <p className="error-text" role="alert">{pipeline.error}</p>}{confirm && <div className="batch-confirm"><h3>Повторить анализ всех записей?</h3><p>Результаты новых задач появятся в архиве. Новые замечания будут ждать решения в очереди.</p><div><Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Отмена</Button><Button size="sm" onClick={async () => { setConfirm(false); await mutate(() => gateway.rerunArchive(), 'Повторный анализ запущен') }}>Подтвердить</Button></div></div>}</div>
}

function Inspector({ data, video, event, time, mutate }: { data: WorkspaceSnapshot; video: VideoView; event?: AuditEventView; time: number; mutate: Mutate }) {
  const ui = useUi()
  if (ui.mode === 'training') return <aside className="inspector surface"><div className="inspector-header"><p>Дообучение / редактор</p><h2>{ui.editorTab === 'boxes' ? 'Боксы кадра' : ui.editorTab === 'events' ? 'События и примеры' : 'Версия модели'}</h2></div><Tabs value={ui.editorTab} onValueChange={value => ui.setEditorTab(value as typeof ui.editorTab)}><TabsList><TabsTrigger value="boxes">Боксы</TabsTrigger><TabsTrigger value="events">События</TabsTrigger><TabsTrigger value="training">Дообучение</TabsTrigger></TabsList></Tabs><div className="inspector-scroll">{ui.editorTab === 'events' ? <EventEditor key={video.id} data={data} video={video} time={time} mutate={mutate} /> : ui.editorTab === 'training' ? <Pipeline data={data} mutate={mutate} /> : <div className="editor-content"><h3>Редактор объектов</h3><p>Выберите или нарисуйте бокс на кадре. Точные координаты и класс меняются под плеером.</p><div className="helper-note"><PenLine size={18} /><span>Сохранённая разметка заменит вывод модели для этого кадра и войдёт в набор данных.</span></div></div>}</div></aside>
  const events = data.events.filter(item => item.videoId === video.id)
  return <aside className="inspector surface"><div className="inspector-header"><p>{ui.mode === 'audit' ? 'Аудит нарушений' : 'Просмотр записи'}</p><h2>{event ? event.title : 'Событий нет'}</h2></div>{event ? <div className="inspector-scroll"><div className="inspector-body"><Badge tone={event.kind === 'violation' ? 'danger' : event.kind === 'quality' ? 'info' : 'warning'} size="sm">{kindLabel(event.kind)}</Badge><p className="event-time">{timecode(event.start)}–{timecode(event.end)} · {event.source === 'human' ? 'Добавлено человеком' : 'Обнаружено системой'}</p><p>{event.description}</p><h3>Кадры и контекст</h3><div className="evidence-strip">{(event.evidenceUrls?.length ? event.evidenceUrls : video.frameUrl ? [video.frameUrl] : []).map((url, index) => <img key={index} src={url} alt={'Кадр события ' + (index + 1)} />)}</div>{event.rule && <div className="rule-note"><strong>Основание для проверки</strong><p>{event.rule}</p></div>}<ProcedureChecklist procedures={data.eventTypes.find(type => type.id === event.typeId)?.procedures} />{ui.mode === 'audit' && event.review === 'pending' && <div className="audit-buttons"><Button variant="secondary" onClick={() => void mutate(() => gateway.reviewEvent(event.id, 'rejected', ''), 'Замечание отклонено')}>Отклонить</Button><Button onClick={() => void mutate(() => gateway.reviewEvent(event.id, 'approved', ''), 'Замечание подтверждено')}>Подтвердить</Button></div>}{event.review !== 'pending' && event.review !== 'none' && <Badge tone={event.review === 'approved' ? 'success' : 'neutral'}>{event.review === 'approved' ? 'Подтверждено' : 'Отклонено'}</Badge>}</div><div className="event-list"><h3>События записи · {events.length}</h3>{events.map(item => <button key={item.id} className={item.id === event.id ? 'active' : ''} onClick={() => { ui.selectEvent(item.id); ui.setPlaybackTime(item.start) }}><span>{timecode(item.start)}</span><strong>{item.title}</strong><ChevronRight size={15} /></button>)}</div></div> : <div className="inspector-scroll"><Empty icon={<Flag />} title="Событий нет">Просмотрите запись или добавьте событие вручную.</Empty><Button variant="secondary" onClick={() => { ui.navigate('workspace', { videoId: video.id, mode: 'training' }); ui.setEditorTab('events') }}><Plus size={15} /> Добавить событие</Button></div>}</aside>
}

export default function Workspace({ data, mutate }: Props) {
  const ui = useUi()
  const video = data.videos.find(item => item.id === ui.videoId) || data.videos[0]
  const [tool, setTool] = useState<Tool>('select')
  const [selectedBox, setSelectedBox] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const time = ui.playbackTime
  const events = data.events.filter(event => event.videoId === video?.id).sort((a, b) => a.start - b.start)
  const event = events.find(item => item.id === ui.eventId) || events[0]
  useEffect(() => { if (video && ui.videoId !== video.id) ui.navigate('workspace', { videoId: video.id, mode: ui.mode }) }, [video?.id])
  useEffect(() => { if (video) { const chosen = events.find(item => item.id === useUi.getState().eventId) || events[0]; ui.selectEvent(chosen?.id || null); ui.setPlaybackTime(chosen?.start || 0) } }, [video?.id])
  if (!video) return <div className="page-stack"><Empty icon={<Flag />} title="Запись не выбрана">Откройте запись из архива или загрузите новое видео.</Empty><Button onClick={() => ui.navigate('archive')}>К архиву</Button></div>
  const seek = (next: number) => { ui.setPlaybackTime(next); const element = document.querySelector<HTMLVideoElement>('#record-video'); if (element) element.currentTime = next; setSelectedBox(null) }
  const pending = events.filter(item => item.review === 'pending').length
  return <div className="page-stack workspace"><header className="page-header workspace-header"><div><p className="eyebrow">Запись / {video.camera}</p><h1>{video.title}</h1><p className="workspace-meta">{shortDate(video.recordedAt)}, {shortTime(video.recordedAt)} · {timecode(video.duration)} · {pending ? 'Есть замечания' : 'Нет вопросов'}</p></div><Button variant="secondary" onClick={() => ui.navigate('archive')}>К архиву</Button></header><Tabs value={ui.mode} onValueChange={value => ui.navigate('workspace', { videoId: video.id, mode: value as typeof ui.mode })}><TabsList><TabsTrigger value="view">Просмотр</TabsTrigger><TabsTrigger value="audit">Аудит нарушений</TabsTrigger><TabsTrigger value="training">Дообучение</TabsTrigger></TabsList></Tabs><div className="workspace-shortcuts"><Button variant="secondary" size="sm" onClick={() => { ui.navigate('workspace', { videoId: video.id, mode: 'training' }); ui.setEditorTab('boxes') }}><Maximize2 size={15} /> Исправить боксы</Button><Button variant="secondary" size="sm" onClick={() => { ui.navigate('workspace', { videoId: video.id, mode: 'training' }); ui.setEditorTab('events'); ui.setEventEditorTab('catalog') }}><Plus size={15} /> Добавить событие</Button></div><div className="workspace-grid"><div className="player-column"><div className="player surface"><BoxCanvas video={video} time={time} allBoxes={data.boxes} events={events} editing={ui.mode === 'training' && ui.editorTab === 'boxes'} tool={tool} setTool={setTool} selected={selectedBox} setSelected={setSelectedBox} mutate={mutate} /><div className="player-controls"><button className="play-button" disabled={!video.streamUrl} onClick={() => { const element = document.querySelector<HTMLVideoElement>('#record-video'); if (!element) return; if (playing) void element.pause(); else void element.play(); setPlaying(!playing) }} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><span className="time-readout">{timecode(time)} / {timecode(video.duration)}</span><input type="range" min={0} max={video.duration} step={.1} value={Math.min(time, video.duration)} onChange={e => seek(Number(e.target.value))} aria-label="Таймлайн записи" /><span className="end-time">{timecode(video.duration)}</span></div><div className="timeline-events">{events.map(item => <button key={item.id} className={item.id === event?.id ? 'active' : ''} onClick={() => { ui.selectEvent(item.id); seek(item.start) }}>{timecode(item.start)} · {item.title}</button>)}</div></div></div><Inspector data={data} video={video} event={event} time={time} mutate={mutate} /></div></div>
}
