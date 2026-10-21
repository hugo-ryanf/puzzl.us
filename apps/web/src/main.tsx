import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fontes do modelo embutidas no app (sem depender do Google Fonts nem expor quem visita).
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado no index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
