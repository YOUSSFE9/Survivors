/**
 * MazeGenerator — Procedural space station maze using recursive backtracker.
 * Generates a grid-based maze with rooms, corridors, and spawn points.
 */

const TILE = {
    FLOOR: 0,
    WALL: 1,
    SPAWN: 2,
    KEY_SPAWN: 3,
    PICKUP_SPAWN: 4,
    ENEMY_SPAWN: 5,
    TRAP_SPAWN: 6,
};

export { TILE };

export class MazeGenerator {
    constructor(cols = 30, rows = 30, cellSize = 3) {
        this.cols = cols;
        this.rows = rows;
        this.cellSize = cellSize;
        this.mapWidth = cols * cellSize + 1;
        this.mapHeight = rows * cellSize + 1;
        this.grid = [];
        this.keyPositions = [];
        this.pickupPositions = [];
        this.enemyPositions = [];
        this.trapPositions = [];
        this.playerSpawn = { x: 0, y: 0 };
        this.rooms = [];
    }

    generate() {
        // Initialize all as walls
        this.grid = Array.from({ length: this.mapHeight }, () =>
            Array.from({ length: this.mapWidth }, () => TILE.WALL)
        );

        // Maze cells for recursive backtracker
        const visited = Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => false)
        );

        const stack = [];
        const startCellX = 0;
        const startCellY = 0;
        visited[startCellY][startCellX] = true;
        stack.push({ x: startCellX, y: startCellY });

        // Carve starting cell
        this._carveCell(startCellX, startCellY);

        // Recursive backtracker
        while (stack.length > 0) {
            const current = stack[stack.length - 1];
            const neighbors = this._getUnvisitedNeighbors(current.x, current.y, visited);

            if (neighbors.length === 0) {
                stack.pop();
            } else {
                const next = neighbors[Math.floor(Math.random() * neighbors.length)];
                visited[next.y][next.x] = true;
                this._carvePassage(current.x, current.y, next.x, next.y);
                this._carveCell(next.x, next.y);
                stack.push(next);
            }
        }

        // Create open rooms at random positions for better gameplay
        this._createRooms(8);

        // Set spawn points
        this._setSpawnPoints();

        return {
            grid: this.grid,
            width: this.mapWidth,
            height: this.mapHeight,
            playerSpawn: this.playerSpawn,
            keyPositions: this.keyPositions,
            pickupPositions: this.pickupPositions,
            enemyPositions: this.enemyPositions,
            trapPositions: this.trapPositions,
            rooms: this.rooms,
        };
    }

    _carveCell(cx, cy) {
        const sx = cx * this.cellSize + 1;
        const sy = cy * this.cellSize + 1;
        for (let dy = 0; dy < this.cellSize - 1; dy++) {
            for (let dx = 0; dx < this.cellSize - 1; dx++) {
                if (sy + dy < this.mapHeight && sx + dx < this.mapWidth) {
                    this.grid[sy + dy][sx + dx] = TILE.FLOOR;
                }
            }
        }
    }

    _carvePassage(cx1, cy1, cx2, cy2) {
        const sx1 = cx1 * this.cellSize + 1;
        const sy1 = cy1 * this.cellSize + 1;
        const sx2 = cx2 * this.cellSize + 1;
        const sy2 = cy2 * this.cellSize + 1;

        const midX = (sx1 + sx2) >> 1;
        const midY = (sy1 + sy2) >> 1;

        if (cx1 === cx2) {
            // Vertical passage
            const startY = Math.min(sy1, sy2);
            const endY = Math.max(sy1, sy2) + this.cellSize - 2;
            for (let y = startY; y <= endY && y < this.mapHeight; y++) {
                for (let dx = 0; dx < this.cellSize - 1; dx++) {
                    if (sx1 + dx < this.mapWidth) {
                        this.grid[y][sx1 + dx] = TILE.FLOOR;
                    }
                }
            }
        } else {
            // Horizontal passage
            const startX = Math.min(sx1, sx2);
            const endX = Math.max(sx1, sx2) + this.cellSize - 2;
            for (let x = startX; x <= endX && x < this.mapWidth; x++) {
                for (let dy = 0; dy < this.cellSize - 1; dy++) {
                    if (sy1 + dy < this.mapHeight) {
                        this.grid[sy1 + dy][x] = TILE.FLOOR;
                    }
                }
            }
        }
    }

    _getUnvisitedNeighbors(cx, cy, visited) {
        const neighbors = [];
        const dirs = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
        ];
        for (const d of dirs) {
            const nx = cx + d.x;
            const ny = cy + d.y;
            if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny });
            }
        }
        return neighbors;
    }

    _createRooms(count) {
        for (let i = 0; i < count; i++) {
            const roomW = 4 + Math.floor(Math.random() * 4);
            const roomH = 4 + Math.floor(Math.random() * 4);
            const rx = 2 + Math.floor(Math.random() * (this.mapWidth - roomW - 4));
            const ry = 2 + Math.floor(Math.random() * (this.mapHeight - roomH - 4));

            for (let y = ry; y < ry + roomH && y < this.mapHeight; y++) {
                for (let x = rx; x < rx + roomW && x < this.mapWidth; x++) {
                    this.grid[y][x] = TILE.FLOOR;
                }
            }
            this.rooms.push({ x: rx, y: ry, w: roomW, h: roomH });
        }
    }

    _setSpawnPoints() {
        const floors = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                if (this.grid[y][x] === TILE.FLOOR) {
                    floors.push({ x, y });
                }
            }
        }

        // Shuffle floors
        for (let i = floors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [floors[i], floors[j]] = [floors[j], floors[i]];
        }

        let idx = 0;

        // Player spawn
        if (floors.length > 0) {
            this.playerSpawn = floors[idx++];
            this.grid[this.playerSpawn.y][this.playerSpawn.x] = TILE.SPAWN;
        }

        // 10 key positions
        for (let i = 0; i < 10 && idx < floors.length; i++) {
            this.keyPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.KEY_SPAWN;
            idx++;
        }

        // 15 pickup positions (health kits, ammo, weapons)
        for (let i = 0; i < 15 && idx < floors.length; i++) {
            this.pickupPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.PICKUP_SPAWN;
            idx++;
        }

        // 20 enemy spawn positions
        for (let i = 0; i < 20 && idx < floors.length; i++) {
            this.enemyPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.ENEMY_SPAWN;
            idx++;
        }

        // 20 trap positions
        for (let i = 0; i < 20 && idx < floors.length; i++) {
            this.trapPositions.push(floors[idx]);
            this.grid[floors[idx].y][floors[idx].x] = TILE.TRAP_SPAWN;
            idx++;
        }
    }

    getFloorTiles() {
        const floors = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                if (this.grid[y][x] !== TILE.WALL) {
                    floors.push({ x, y });
                }
            }
        }
        return floors;
    }

    getRandomFloor() {
        const floors = this.getFloorTiles();
        return floors[Math.floor(Math.random() * floors.length)];
    }
}
