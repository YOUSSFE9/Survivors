import { useState, useCallback } from 'react';
import LandingPage from './components/LandingPage';
import PhaserGame from './game/PhaserGame';
import './App.css';

/**
 * App — Root component with view routing: Landing → Game.
 */
export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'game'
  const [gameMode, setGameMode] = useState('offline');
  const [onlineOpts, setOnlineOpts] = useState(null);

  const handleStartGame = useCallback((mode, options = null) => {
    setGameMode(mode);
    setOnlineOpts(options);
    setView('game');
  }, []);

  const handleBackToMenu = useCallback(() => {
    setView('landing');
  }, []);

  const handleGameEvent = useCallback((event, data) => {
    if (event === 'backToMenu') {
      handleBackToMenu();
    }
  }, [handleBackToMenu]);

  return (
    <div className="app-root">
      {view === 'landing' && (
        <LandingPage onStartGame={handleStartGame} />
      )}

      {view === 'game' && (
        <div className="game-container">
          <PhaserGame mode={gameMode} onlineOptions={onlineOpts} onGameEvent={handleGameEvent} />

          {/* Back button overlay */}
          <button
            className="back-button"
            onClick={handleBackToMenu}
            id="btn-back-menu"
            title="Back to menu"
          >
            ← Menu
          </button>
        </div>
      )}
    </div>
  );
}
