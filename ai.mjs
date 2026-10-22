/**
 * Computer-move search using the chess rules library. Evaluation is relative to the side to move; iterative deepening retains the last completed search result.
 */
import { Chess } from './vendor/chess.mjs';

const values = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
// Combine material and positional bonuses, returning a score for the side to move.
/**
 * Score material and positional bonuses from the perspective of the side to move.
 *
 * @param game - Chess rules instance representing the position being evaluated.
 * @returns Signed numerical position score for the current side.
 */
function evaluate(game) {
    let score = 0;
    for (const row of game.board()) for (const piece of row) {
        if (!piece) continue;
        const file = piece.square.charCodeAt(0) - 97;
        const rank = Number(piece.square[1]) - 1;
        const center = 7 - Math.abs(file - 3.5) - Math.abs(rank - 3.5);
        const advancement = piece.color === 'w' ? rank : 7 - rank;
        let bonus = piece.type === 'p' ? advancement * 7 + center * 2 : 0;
        if ('nb'.includes(piece.type)) bonus += center * 10;
        if (piece.type === 'q') bonus += center * 2;
        score += (piece.color === 'w' ? 1 : -1) * (values[piece.type] + bonus);
    }
    return score * (game.turn() === 'w' ? 1 : -1);
}
/**
 * Rank chess moves to search captures, promotions, checks, and mates early.
 *
 * @param move - Legal move descriptor containing origin, destination/path, and capture or promotion data.
 * @returns Move-ordering score; larger values are searched first.
 */
const priority = (move) => (move.captured ? values[move.captured] * 10 - values[move.piece] : 0) + (move.promotion ? values[move.promotion] : 0) + (move.san.includes('#') ? 100000 : move.san.includes('+') ? 40 : 0);
/**
 * Reduce a library move object to the coordinates and optional promotion needed by the page.
 *
 * @param move - Legal move descriptor containing origin, destination/path, and capture or promotion data.
 * @returns Origin, destination, and optional promotion type for a library move.
 */
const plainMove = (move) => ({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });

// Iterative-deepening negamax with alpha-beta pruning, bounded by a time budget.
/**
 * Search successively deeper legal variations and return the best fully searched result before timeout.
 *
 * @param fen - FEN string encoding the chess position and side to move.
 * @param options - Configuration object (defaults to an empty object).
 * @param options.maxDepth - Maximum game-tree depth to search. Default: 3.
 * @param options.timeLimit - Search time budget in milliseconds. Default: 800.
 * @returns Chosen legal move descriptor, or null if the game has ended.
 */
export function chooseMove(fen, { maxDepth = 3, timeLimit = 800 } = {}) {
    const game = new Chess(fen);
    if (game.isGameOver()) return null;
    const deadline = performance.now() + timeLimit;
    const timeout = Symbol('search timeout');
    /**
     * Search legal continuations using negamax and alpha-beta pruning within the time budget.
     *
     * @param depth - Remaining number of search plies to explore before static evaluation.
     * @param alpha - Lower score bound used by alpha-beta pruning.
     * @param beta - Upper score bound used by alpha-beta pruning.
     * @param ply - Number of half-moves searched from the root; used to prefer earlier wins.
     * @returns Best score found for the current search node, relative to its side to move.
     */
    function search(depth, alpha, beta, ply) {
        if (performance.now() > deadline) throw timeout;
        if (game.isCheckmate()) return -100000 + ply;
        if (game.isDraw()) return 0;
        if (!depth) return evaluate(game);
        const moves = game.moves({ verbose: true }).sort((a,b) => priority(b) - priority(a));
        let best = -Infinity;
        for (const move of moves) {
            game.move(move);
            let score;
            try { score = -search(depth - 1, -beta, -alpha, ply + 1); }
            finally { game.undo(); }
            best = Math.max(best, score);
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
        }
        return best;
    }
    const root = game.moves({ verbose: true }).sort((a,b) => priority(b) - priority(a));
    let bestMove = root[0];
    for (let depth = 1; depth <= maxDepth; depth++) {
        let candidate = bestMove, bestScore = -Infinity;
        root.sort((a,b) => Number(b.from === bestMove.from && b.to === bestMove.to) - Number(a.from === bestMove.from && a.to === bestMove.to) || priority(b) - priority(a));
        try {
            for (const move of root) {
                game.move(move);
                let score;
                try { score = -search(depth - 1, -Infinity, -bestScore, 1); }
                finally { game.undo(); }
                if (score > bestScore) { bestScore = score; candidate = move; }
            }
            bestMove = candidate;
            if (bestScore > 99000) break;
        } catch (error) {
            if (error !== timeout) throw error;
            break;
        }
    }
    return plainMove(bestMove);
}
