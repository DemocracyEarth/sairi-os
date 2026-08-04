import { StrictMode, useEffect, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@sairios/ui-components';
import '@sairios/ui-components/styles.css';
import './shell.css';
import { App } from './App.js';
import { SairiOS } from './sairi/SairiOS.js';
import { Boundary } from './sairi/Boundary.js';

const root = document.getElementById('root');
if (!root) throw new Error('SairiOS shell: #root is missing from index.html');

/**
 * Two surfaces, one shell.
 *
 * `#/os` is the Sairi OS experience — dark, cinematic, context-native. Anything
 * else is the shipped v0 desktop, which is verified, in use, and deliberately
 * untouched by that work: they have different design systems and different
 * jobs, and replacing one with the other silently would throw away something
 * that already boots on a real machine.
 *
 * Hash routing rather than a router dependency. One line of code, no package,
 * and it survives being served as static files from `serve.mjs` with no
 * server-side rewrite rule.
 */
function Root(): JSX.Element {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash.startsWith('#/os'))
    return (
      <Boundary>
        <SairiOS />
      </Boundary>
    );

  return (
    <LocaleProvider>
      <App />
    </LocaleProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
