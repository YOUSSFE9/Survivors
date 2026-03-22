/**
 * MazeGenerator — shared between server and client.
 * Same seed → same maze on all clients (deterministic).
 */
export class MazeGenerator {
    static generate(w: number, h: number, scale: number, seed: number) {
        const width  = w * scale;
        const height = h * scale;
        const tileSize = 32;
        const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(1));

        // Seeded RNG (simple LCG)
        let s = seed;
        const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

        // Recursive backtracker maze
        const carved = new Set<string>();
        const key = (x: number, y: number) => `${x}_${y}`;

        const carve = (cx: number, cy: number) => {
            grid[cy][cx] = 0;
            carved.add(key(cx, cy));
            const dirs = [
                [0, -2], [2, 0], [0, 2], [-2, 0]
            ].sort(() => rng() - 0.5);
            for (const [dx, dy] of dirs) {
                const nx = cx + dx, ny = cy + dy;
                if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && !carved.has(key(nx, ny))) {
                    grid[cy + dy / 2][cx + dx / 2] = 0;
                    carve(nx, ny);
                }
            }
        };
        carve(1, 1);

        return { grid, width, height, tileSize, playerSpawn: { x: 1, y: 1 } };
    }
}
