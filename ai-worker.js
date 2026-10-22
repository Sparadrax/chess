/**
 * Worker boundary for chess search. The page sends a position and search options; replies include a request identifier so stale results can be ignored.
 */
import { chooseMove } from './ai.mjs';
self.onmessage = (event) => {
    const { fen } = event.data;
    try { self.postMessage({ fen, move: chooseMove(fen) }); }
    catch (error) { self.postMessage({ fen, error: error.message }); }
};
