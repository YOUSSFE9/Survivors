/**
 * WaveSpawner — Capped continuous spawn system.
 * HARD CAP: max 20 living enemies at any time for performance.
 * - 5 enemies every 10 seconds baseline
 * - 10 enemies/10s when player has 5+ keys (pressure mode)
 * - 10 enemies every 60s if player delays key collection (turtle prevention)
 */
export class WaveSpawner {
    constructor(scene) {
        this.scene = scene;
        this.currentWave = 0;
        this.isSpawning = false;
        this.waveTimer = null;
    }

    start() {
        this.currentWave = 0;
        this._scheduleNextBatch(10000);

        // Turtle prevention: after 60s with < 5 keys, fire up to 10 enemies
        this.scene.time.addEvent({
            delay: 60000,
            loop: true,
            callback: () => {
                const keys = this.scene.player?.keysCollected || 0;
                if (keys < 5) {
                    this._spawnBatch(10);
                }
            }
        });
    }

    _scheduleNextBatch(delay = 10000) {
        this.waveTimer = this.scene.time.delayedCall(delay, () => {
            const keys = this.scene.player?.keysCollected || 0;
            const count = keys >= 5 ? 10 : 5;
            this._spawnBatch(count);
            this._scheduleNextBatch(10000);
        });
    }

    _spawnBatch(count) {
        // Count living enemies
        const aliveCount = (this.scene.enemies || []).filter(e => e.alive).length;
        const MAX_ENEMIES = 20;

        // How many we can still spawn
        const canSpawn = Math.max(0, MAX_ENEMIES - aliveCount);
        const actualCount = Math.min(count, canSpawn);

        if (actualCount <= 0) return; // already at cap

        this.currentWave++;
        const types = this._getTypes();

        this.scene.events.emit('waveStart', { wave: this.currentWave, count: actualCount });

        let spawned = 0;
        this.scene.time.addEvent({
            delay: 400,
            repeat: actualCount - 1,
            callback: () => {
                // Re-check cap before each individual spawn
                const alive = (this.scene.enemies || []).filter(e => e.alive).length;
                if (alive >= MAX_ENEMIES) return;
                this.scene.events.emit('spawnEnemy', types[spawned % types.length]);
                spawned++;
            }
        });
    }

    _getTypes() {
        const types = ['zombie'];
        if (this.currentWave >= 2) types.push('monster');
        if (this.currentWave >= 4) types.push('ghost');
        return types;
    }

    onEnemyKilled() {
        // Not tracking count internally anymore — we check scene.enemies directly
    }

    getCurrentWave() { return this.currentWave; }

    destroy() {
        if (this.waveTimer) this.waveTimer.remove();
    }
}
