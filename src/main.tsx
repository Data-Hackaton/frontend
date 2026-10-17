import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AccessGate } from './AccessGate'
import { useUi } from './state/ui'

useUi.getState().syncHash()
const root = document.getElementById('root')!
createRoot(root).render(<StrictMode><AccessGate><App /></AccessGate></StrictMode>)
