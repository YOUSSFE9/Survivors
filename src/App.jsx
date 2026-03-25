import { useState, useCallback, lazy, Suspense } from 'react';
import LandingPage from './components/LandingPage';
import T, { getSavedLang } from './i18n/translations';
import './App.css';

const PhaserGame = lazy(() => import('./game/PhaserGame'));
/**
 * App — Root component with view routing: Landing → Game.
 */
export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'game'
  const [gameMode, setGameMode] = useState('offline');
  const [onlineOpts, setOnlineOpts] = useState(null);
  const [lang, setLang] = useState(getSavedLang());

  const t = T[lang] || T['ar'];

  const handleStartGame = useCallback((mode, options = null) => {
    setGameMode(mode);
    setOnlineOpts(options);
    setView('game');
  }, []);

  const handleBackToMenu = useCallback(() => {
    setView('landing');
  }, []);

  const handleGameEvent = useCallback((event) => {
    if (event === 'backToMenu') {
      handleBackToMenu();
    }
  }, [handleBackToMenu]);

  return (
    <div className="app-root" dir={t.dir || 'ltr'}>
      {view === 'landing' && (
        <LandingPage onStartGame={handleStartGame} lang={lang} setLang={setLang} />
      )}

      {view === 'game' && (
        <div className="game-container">
          <Suspense fallback={<div className="game-loading">Loading game...</div>}>
            <PhaserGame mode={gameMode} onlineOptions={onlineOpts} onGameEvent={handleGameEvent} t={t} />
          </Suspense>

          {/* Back button overlay */}
          <button
            className="back-button"
            onClick={handleBackToMenu}
            id="btn-back-menu"
            title={t.back}
          >
            {t.back}
          </button>
        </div>
      )}
    </div>
  );
}
