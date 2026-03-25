import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createGameConfig } from './config';

/**
 * PhaserGame — React ↔ Phaser bridge component.
 * Handles React StrictMode (double mount/unmount) safely.
 */
export default function PhaserGame({ mode = 'offline', onlineOptions = null, onGameEvent, t }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const destroyedRef = useRef(false);

  // Sync translation object to Phaser registry when it changes
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.registry.set('t', t);
    }
  }, [t]);

  useEffect(() => {
    // Guard against StrictMode re-mount when game was already destroyed
    destroyedRef.current = false;

    // Small delay to ensure DOM container is ready
    const timer = setTimeout(() => {
      if (destroyedRef.current || !containerRef.current) return;

      // Clean any leftover canvas from previous instance
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }

      const config = createGameConfig(containerRef.current);
      const game = new Phaser.Game(config);

      game.registry.set('gameMode', mode);
      game.registry.set('t', t);
      if (onlineOptions) {
        Object.entries(onlineOptions).forEach(([k, v]) => game.registry.set(k, v));
      }
      game.registry.set('onGameEvent', onGameEvent);

      gameRef.current = game;
    }, 50);

    return () => {
      destroyedRef.current = true;
      clearTimeout(timer);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
    // This effect is intentionally mount-only to keep a single Phaser instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update mode if changed
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.registry.set('gameMode', mode);
    }
  }, [mode]);

  return (
    <div
      ref={containerRef}
      id="phaser-game"
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    />
  );
}
