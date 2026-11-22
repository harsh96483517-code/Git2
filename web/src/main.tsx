import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, getTheme } from './theme';
import './index.css';

applyTheme(getTheme());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'system') applyTheme('system'); });
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
