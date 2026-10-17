import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { BoxView, WorkspaceMode } from '../contracts/ui'

type Route = 'overview' | 'upload' | 'archive' | 'attention' | 'catalog' | 'workspace' | 'tokens' | 'cameras'

interface UiState {
  route: Route
  mode: WorkspaceMode
  videoId: string | null
  eventId: string | null
  selectedDate: string | null
  reviewFilter: 'pending' | 'resolved'
  catalogQuery: string
  catalogGroup: 'all' | 'violation' | 'warning' | 'quality' | 'expected'
  editorTab: 'boxes' | 'events' | 'training'
  eventEditorTab: 'catalog' | 'custom'
  overlayVisible: boolean
  playbackTime: number
  boxDrafts: Record<string, BoxView[]>
  notificationsOpen: boolean
  readNoticeIds: string[]
  navigate: (route: Route, options?: { videoId?: string; mode?: WorkspaceMode; eventId?: string }) => void
  syncHash: () => void
  selectDate: (date: string | null) => void
  setReviewFilter: (filter: 'pending' | 'resolved') => void
  setCatalogQuery: (query: string) => void
  setCatalogGroup: (group: UiState['catalogGroup']) => void
  setEditorTab: (tab: UiState['editorTab']) => void
  setEventEditorTab: (tab: UiState['eventEditorTab']) => void
  selectEvent: (id: string | null) => void
  toggleOverlay: () => void
  setPlaybackTime: (time: number) => void
  setBoxDraft: (key: string, boxes: BoxView[]) => void
  clearBoxDraft: (key: string) => void
  toggleNotifications: () => void
  markNoticeRead: (id: string) => void
}

const routes: Route[] = ['overview', 'upload', 'archive', 'attention', 'catalog', 'workspace', 'tokens', 'cameras']
const modes: WorkspaceMode[] = ['view', 'audit', 'training']

export const useUi = create<UiState>()(persist((set, get) => ({
  route: 'overview', mode: 'view', videoId: null, eventId: null, selectedDate: null,
  reviewFilter: 'pending', catalogQuery: '', catalogGroup: 'all', editorTab: 'boxes',
  eventEditorTab: 'catalog', overlayVisible: true, playbackTime: 0, boxDrafts: {}, notificationsOpen: false, readNoticeIds: [],
  navigate: (route, options = {}) => {
    const mode = options.mode ?? get().mode
    const videoId = options.videoId ?? get().videoId
    const hash = route === 'workspace' && videoId ? `#workspace/${mode}/${videoId}` : `#${route}`
    if (location.hash !== hash) history.pushState(null, '', hash)
    set({ route, mode, videoId, eventId: options.eventId ?? get().eventId, notificationsOpen: false })
    window.scrollTo({ top: 0, behavior: 'instant' })
  },
  syncHash: () => {
    const [candidate, candidateMode, videoId] = location.hash.slice(1).split('/')
    const route = routes.includes(candidate as Route) ? candidate as Route : 'overview'
    set({ route, mode: modes.includes(candidateMode as WorkspaceMode) ? candidateMode as WorkspaceMode : get().mode,
      videoId: route === 'workspace' ? videoId || get().videoId : get().videoId, notificationsOpen: false })
  },
  selectDate: selectedDate => set({ selectedDate }),
  setReviewFilter: reviewFilter => set({ reviewFilter }),
  setCatalogQuery: catalogQuery => set({ catalogQuery }),
  setCatalogGroup: catalogGroup => set({ catalogGroup }),
  setEditorTab: editorTab => set({ editorTab }),
  setEventEditorTab: eventEditorTab => set({ eventEditorTab }),
  selectEvent: eventId => set({ eventId }),
  toggleOverlay: () => set({ overlayVisible: !get().overlayVisible }),
  setPlaybackTime: playbackTime => set({ playbackTime }),
  setBoxDraft: (key, boxes) => set({ boxDrafts: { ...get().boxDrafts, [key]: boxes } }),
  clearBoxDraft: key => { const next = { ...get().boxDrafts }; delete next[key]; set({ boxDrafts: next }) },
  toggleNotifications: () => set({ notificationsOpen: !get().notificationsOpen }),
  markNoticeRead: id => set({ readNoticeIds: [...new Set([...get().readNoticeIds, id])] }),
}), {
  name: 'forte-video-audit-ui-v1',
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ selectedDate: state.selectedDate, reviewFilter: state.reviewFilter,
    overlayVisible: state.overlayVisible, readNoticeIds: state.readNoticeIds }),
}))
