/**
 * MonsterAI — Server-side monster movement (plain JavaScript).
 */
const TYPES = {
    zombie:  { health: 60,  speed: 2.9, damage: 8,  attackRate: 1000 },
    monster: { health: 40,  speed: 5.0, damage: 15, attackRate: 600  },
    ghost:   { health: 25,  speed: 4.4, damage: 5,  attackRate: 800  },
};

let mCounter = 0;

class MonsterAI {
    constructor(mazeData, gs) {
        this.mazeData = mazeData;
        this.gs = gs;
        this.worldW = mazeData.width  * mazeData.tileSize;
        this.worldH = mazeData.height * mazeData.tileSize;
        this._atkTimers = {};
    }

    spawnWave(count) {
        const typeList = ['zombie', 'monster', 'ghost'];
        for (let i = 0; i < count; i++) {
            const type = typeList[i % typeList.length];
            const cfg  = TYPES[type];
            const pos  = this.getSpawnPos();
            const id   = `m${mCounter++}`;
            this.gs.monsters[id] = {
                id, type,
                x: pos.x, y: pos.y,
                health: cfg.health, maxHealth: cfg.health,
                alive: true,
            };
        }
    }

    update(tickMs, players) {
        const alivePlayers = Object.values(players).filter(p => p.alive);
        if (!alivePlayers.length) return;

        for (const [id, m] of Object.entries(this.gs.monsters)) {
            if (!m.alive) continue;
            const cfg = TYPES[m.type] || TYPES['zombie'];

            // Nearest player
            let nearest = null, nearestD = Infinity;
            for (const p of alivePlayers) {
                const dx = p.x - m.x, dy = p.y - m.y;
                const d = dx*dx + dy*dy;
                if (d < nearestD) { nearestD = d; nearest = p; }
            }
            if (!nearest) continue;

            const dist = Math.sqrt(nearestD);
            const dx = nearest.x - m.x, dy = nearest.y - m.y;

            if (dist < 22) {
                // Attack
                const now = Date.now();
                if (now - (this._atkTimers[id] || 0) >= cfg.attackRate) {
                    this._atkTimers[id] = now;
                    nearest.health -= cfg.damage;
                    if (nearest.health <= 0) {
                        nearest.health = 0;
                        nearest.alive = false;
                    }
                }
            } else {
                // Move toward player
                m.x += (dx / dist) * cfg.speed;
                m.y += (dy / dist) * cfg.speed;
                m.x = Math.max(0, Math.min(m.x, this.worldW));
                m.y = Math.max(0, Math.min(m.y, this.worldH));
            }
        }
    }

    getSpawnPos() {
        const { grid, width, height, tileSize } = this.mazeData;
        for (let i = 0; i < 80; i++) {
            const rx = Math.floor(Math.random() * (width  - 2)) + 1;
            const ry = Math.floor(Math.random() * (height - 2)) + 1;
            if (grid[ry]?.[rx] === 0) {
                return { x: rx * tileSize + tileSize / 2, y: ry * tileSize + tileSize / 2 };
            }
        }
        return { x: tileSize * 2, y: tileSize * 2 };
    }
}

module.exports = { MonsterAI };
