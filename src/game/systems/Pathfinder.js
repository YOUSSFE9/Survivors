/**
 * Pathfinder — BFS pathfinding on the tile grid.
 * Used by enemies to find real shortest-path to player, navigating around walls.
 */
export class Pathfinder {
    /**
     * @param {number[][]} grid  - 2D tile grid (0=walkable, 1=wall)
     * @param {number} tileSize  - pixel size of each tile
     */
    constructor(grid, tileSize) {
        this.grid = grid;
        this.tileSize = tileSize;
        this.width = grid[0].length;
        this.height = grid.length;
    }

    /**
     * Update the grid reference (needed after wall breach).
     */
    setGrid(grid) {
        this.grid = grid;
    }

    /**
     * BFS from worldStart to worldTarget.
     * Returns an array of world-pixel waypoints [{x, y}] to follow,
     * or [] if no path (enemy should try direct movement).
     */
    findPath(worldStartX, worldStartY, worldTargetX, worldTargetY) {
        const ts = this.tileSize;
        const startGX = Math.floor(worldStartX / ts);
        const startGY = Math.floor(worldStartY / ts);
        const endGX   = Math.floor(worldTargetX / ts);
        const endGY   = Math.floor(worldTargetY / ts);

        // Already at goal
        if (startGX === endGX && startGY === endGY) return [];

        // Out-of-bounds guard
        if (!this._walkable(startGX, startGY) || !this._walkable(endGX, endGY)) return [];

        const queue = [{ x: startGX, y: startGY }];
        let head = 0; // pointer instead of shift() for O(1)
        const cameFrom = new Map();
        const key = (x, y) => `${x}_${y}`;
        cameFrom.set(key(startGX, startGY), null);

        const dirs = [{ x:0,y:-1 },{ x:1,y:0 },{ x:0,y:1 },{ x:-1,y:0 }];
        const MAX_STEPS = 400; // cap BFS to prevent lag on large mazes

        let found = false;
        while (head < queue.length && head < MAX_STEPS) {
            const curr = queue[head++];
            if (curr.x === endGX && curr.y === endGY) { found = true; break; }

            for (const d of dirs) {
                const nx = curr.x + d.x, ny = curr.y + d.y;
                const nk = key(nx, ny);
                if (!cameFrom.has(nk) && this._walkable(nx, ny)) {
                    cameFrom.set(nk, curr);
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        if (!found) return [];

        // Reconstruct path
        const path = [];
        let node = { x: endGX, y: endGY };
        while (node) {
            path.unshift({ x: node.x * ts + ts/2, y: node.y * ts + ts/2 });
            node = cameFrom.get(key(node.x, node.y));
        }
        // Drop the start step so enemy moves to NEXT tile
        if (path.length > 1) path.shift();
        return path;
    }

    _walkable(gx, gy) {
        if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return false;
        return this.grid[gy][gx] !== 1; // TILE.WALL === 1
    }
}
