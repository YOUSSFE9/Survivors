/**
 * MonsterAI — Server-side monster logic.
 * Runs at 20 Hz on the authoritative server.
 * Monsters chase the nearest player, attack on contact.
 */
import { GameState, MonsterState } from '../schemas/GameState';
import { MapSchema } from '@colyseus/core';

const MONSTER_TYPES = {
    zombie:  { health: 60,  speed: 58,  damage: 8,  attackRate: 1000, size: 11 },
    monster: { health: 40,  speed: 100, damage: 15, attackRate: 600,  size: 11 },
    ghost:   { health: 25,  speed: 88,  damage: 5,  attackRate: 800,  size: 11 },
};

interface MazeData {
    grid: number[][];
    width: number;
    height: number;
    tileSize: number;
}

export class MonsterAI {
    private mazeData: MazeData;
    private state: GameState;
    private monsterCounter = 0;
    private attackTimers = new Map<string, number>();

    public worldW: number;
    public worldH: number;

    constructor(mazeData: MazeData, state: GameState) {
        this.mazeData = mazeData;
        this.state = state;
        this.worldW = mazeData.width  * mazeData.tileSize;
        this.worldH = mazeData.height * mazeData.tileSize;
    }

    spawnInitialMonsters(count: number) {
        const types = ['zombie', 'monster', 'ghost'] as const;
        for (let i = 0; i < count; i++) {
            this._spawnMonster(types[i % types.length]);
        }
    }

    spawnWave(count: number) {
        const types = ['zombie', 'monster', 'ghost'] as const;
        for (let i = 0; i < count; i++) {
            this._spawnMonster(types[i % types.length]);
        }
    }

    private _spawnMonster(type: 'zombie' | 'monster' | 'ghost') {
        const pos = this.getSpawnPos();
        const cfg = MONSTER_TYPES[type];
        const m = new MonsterState();
        m.id = `m_${this.monsterCounter++}`;
        m.type = type;
        m.x = pos.x; m.y = pos.y;
        m.health = cfg.health;
        m.maxHealth = cfg.health;
        m.alive = true;
        this.state.monsters.set(m.id, m);
    }

    update(tickMs: number, players: MapSchema<any>) {
        const alivePlayers = [...players.values()].filter((p: any) => p.alive);
        if (alivePlayers.length === 0) return;

        for (const [id, m] of this.state.monsters) {
            if (!m.alive) continue;

            // Find nearest player
            let nearestP: any = null;
            let nearestDist = Infinity;
            for (const p of alivePlayers) {
                const dx = p.x - m.x, dy = p.y - m.y;
                const d = Math.sqrt(dx*dx + dy*dy);
                if (d < nearestDist) { nearestDist = d; nearestP = p; }
            }
            if (!nearestP) continue;

            const cfg = MONSTER_TYPES[m.type as keyof typeof MONSTER_TYPES];
            const dx = nearestP.x - m.x;
            const dy = nearestP.y - m.y;
            const dist = nearestDist;

            // Attack if close
            if (dist < 22) {
                const now = Date.now();
                const lastAtk = this.attackTimers.get(id) || 0;
                if (now - lastAtk >= cfg.attackRate) {
                    this.attackTimers.set(id, now);
                    nearestP.health -= cfg.damage;
                    if (nearestP.health <= 0) {
                        nearestP.health = 0;
                        nearestP.alive = false;
                    }
                }
            } else {
                // Move toward nearest player (simple direct movement — no BFS on server for perf)
                const len = Math.max(1, dist);
                const moveSpeed = (cfg.speed / 1000) * tickMs;
                m.x += (dx / len) * moveSpeed;
                m.y += (dy / len) * moveSpeed;

                // Clamp to world
                m.x = Math.max(0, Math.min(m.x, this.worldW));
                m.y = Math.max(0, Math.min(m.y, this.worldH));
            }
        }
    }

    getSpawnPos(): { x: number; y: number } {
        const { grid, width, height, tileSize } = this.mazeData;
        for (let attempts = 0; attempts < 60; attempts++) {
            const rx = Math.floor(Math.random() * (width  - 2)) + 1;
            const ry = Math.floor(Math.random() * (height - 2)) + 1;
            if (grid[ry]?.[rx] === 0) {
                return { x: rx * tileSize + tileSize / 2, y: ry * tileSize + tileSize / 2 };
            }
        }
        return { x: tileSize * 2, y: tileSize * 2 };
    }

    getRandomFloor(): { x: number; y: number } {
        return this.getSpawnPos();
    }
}
