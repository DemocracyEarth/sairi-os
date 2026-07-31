import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@sairios/ui-components/styles.css';
import './shell.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('SairiOS shell: #root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
