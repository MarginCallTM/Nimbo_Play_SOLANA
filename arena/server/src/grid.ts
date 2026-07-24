// Spatial hash grid, ported from the proto (A0.3/A0.4). Broad-phase
// neighbor lookup: O(cells overlapped) instead of O(n) per query.
// Reminder from the proto: if an item MOVES, remove it before mutating
// x/y and re-insert after — its cell key is derived from its position.

export interface GridItem {
    x: number;
    y: number;
}

export const GRID_CELL_SIZE = 100;

export class SpatialGrid<T extends GridItem> {
    private cells = new Map<string, Set<T>>();
    private cellSize: number;

    constructor(cellSize: number = GRID_CELL_SIZE) {
        this.cellSize = cellSize;
    }

    private key(x: number, y: number): string {
        return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    }

    insert(item: T) {
        const k = this.key(item.x, item.y);
        let cell = this.cells.get(k);
        if (!cell) {
            cell = new Set();
            this.cells.set(k, cell);
        }
        cell.add(item);
    }

    remove(item: T) {
        const cell = this.cells.get(this.key(item.x, item.y));
        if (cell) {
            cell.delete(item);
            if (cell.size === 0) this.cells.delete(this.key(item.x, item.y));
        }
    }

    clear() {
        this.cells.clear();
    }

    // Every item in the cells overlapped by the square [x±range, y±range].
    // Callers still narrow-phase check exact distances.
    queryNear(x: number, y: number, range: number): T[] {
        const found: T[] = [];
        const minCX = Math.floor((x - range) / this.cellSize);
        const maxCX = Math.floor((x + range) / this.cellSize);
        const minCY = Math.floor((y - range) / this.cellSize);
        const maxCY = Math.floor((y + range) / this.cellSize);
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const cell = this.cells.get(`${cx},${cy}`);
                if (cell) {
                    for (const item of cell) found.push(item);
                }
            }
        }
        return found;
    }
}
