import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OutdoorPage } from './outdoor/OutdoorPage';
import './styles.css';

// The page and a header whose right side it fills (period, day arrows, settings, info).
function App() {
  return (
    <div className="app">
      <header>
        <div className="header-left">
          <h1>Outside</h1>
        </div>
        <div className="header-actions" id="header-actions" />
      </header>
      <OutdoorPage />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
