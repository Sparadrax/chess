/**
 * Chess game. The bundled rules library validates moves, a worker searches for computer moves, and Three.js renders the position.
 */
import * as THREE from 'three';
import { OrbitControls } from '../../Lib/Three/OrbitControls.js';
import { Chess } from './vendor/chess.mjs';
import { chooseMove } from './ai.mjs';

const game = new Chess();
let playerColor = document.getElementById('player-color').value;
let aiWorker = null;
let aiThinking = false;
let aiRequest = 0;
const view = document.getElementById('chess-view');
const status = document.getElementById('game-status');
const selectionStatus = document.getElementById('selection-status');
const history = document.getElementById('move-history');
const promotionDialog = document.getElementById('promotion-dialog');
const palette = getComputedStyle(document.documentElement);
/**
 * Read a shared CSS palette value and convert it to a Three.js color.
 *
 * @param name - CSS custom-property name or display label used by this operation.
 * @returns Three.js color parsed from the shared CSS palette.
 */
const themeColor = (name) => new THREE.Color(palette.getPropertyValue(name).trim());
const scene = new THREE.Scene();
scene.background = themeColor('--site-bg');
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
catch (error) {
    const message = document.getElementById('scene-error');
    message.hidden = false;
    message.textContent = 'Unable to start the chessboard. Please enable WebGL in your browser.';
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.setAttribute('aria-label', 'Chessboard: click a piece and then a highlighted destination');
view.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 7;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.44;
controls.enablePan = false;
scene.add(new THREE.HemisphereLight(0xffffff, 0x283746, 2.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(-3, 10, 6);
scene.add(keyLight);
const fill = new THREE.DirectionalLight(0x72ddd0, 1);
fill.position.set(5, 4, -5);
scene.add(fill);

const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf0eadb, metalness: 0.12, roughness: 0.32 });
const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x33465e, metalness: 0.35, roughness: 0.28 });
const darkSquare = new THREE.MeshStandardMaterial({ color: themeColor('--site-surface'), roughness: 0.85 });
const lightSquare = new THREE.MeshStandardMaterial({ color: 0x72868d, roughness: 0.85 });
const selectedSquare = new THREE.MeshStandardMaterial({ color: themeColor('--site-accent'), roughness: 0.7 });
const lastSquare = new THREE.MeshStandardMaterial({ color: 0x426b68, roughness: 0.7 });
const checkSquare = new THREE.MeshStandardMaterial({ color: 0xa44550, roughness: 0.7 });
const markerMaterial = new THREE.MeshBasicMaterial({ color: themeColor('--site-accent'), transparent: true, opacity: 0.9, side: THREE.DoubleSide });
const pieces = new THREE.Group();
const hints = new THREE.Group();
scene.add(pieces, hints);
const tiles = new Map();
let selected = null;
let legal = [];
let pendingPromotion = null;
let flipped = false;
const names = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
/**
 * Convert a chess square label to its Three.js board position.
 *
 * @param square - Algebraic chess square such as e4.
 * @returns Three.js vector for the center of the requested square.
 */
const squarePosition = (square) => new THREE.Vector3(square.charCodeAt(0) - 97 - 3.5, 0, 3.5 - (Number(square[1]) - 1));
const tileGeometry = new THREE.BoxGeometry(1, 0.16, 1);
for (let rank = 1; rank <= 8; rank++) for (let file = 0; file < 8; file++) {
    const square = String.fromCharCode(97 + file) + rank;
    const material = (file + rank) % 2 === 0 ? lightSquare : darkSquare;
    const tile = new THREE.Mesh(tileGeometry, material);
    tile.position.copy(squarePosition(square));
    tile.position.y = -0.08;
    tile.userData = { square, baseMaterial: material };
    tiles.set(square, tile);
    scene.add(tile);
}
const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.25, 8.6), new THREE.MeshStandardMaterial({ color: themeColor('--site-border'), roughness: 0.5 }));
frame.position.y = -0.24;
scene.add(frame);
/**
 * Create a text sprite for a board label or piece marker.
 *
 * @param text - Text to parse or display.
 * @param color - CSS color used for the text label.
 * @param size - Displayed width and height of the label sprite in world units. Default: 0.3.
 * @returns Textured sprite displaying the supplied label.
 */
function label(text, color, size = 0.3) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = 'bold 80px system-ui';
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(size, size, 1);
    return sprite;
}
for (let i = 0; i < 8; i++) {
    for (const z of [-4.18, 4.18]) {
        const sprite = label(String.fromCharCode(97 + i), '#a8b8ca');
        sprite.position.set(i - 3.5, 0.02, z); scene.add(sprite);
    }
    for (const x of [-4.18, 4.18]) {
        const sprite = label(String(8 - i), '#a8b8ca');
        sprite.position.set(x, 0.02, i - 3.5); scene.add(sprite);
    }
}
// Reusable geometry keeps board rebuilds inexpensive and avoids model downloads.
const baseGeometry = new THREE.CylinderGeometry(0.3, 0.34, 0.12, 24);
const collarGeometry = new THREE.CylinderGeometry(0.21, 0.26, 0.09, 24);
const stemGeometry = new THREE.CylinderGeometry(0.12, 0.22, 0.42, 24);
const sphereGeometry = new THREE.SphereGeometry(0.19, 20, 16);
const crownGeometry = new THREE.ConeGeometry(0.25, 0.3, 12);
const blockGeometry = new THREE.BoxGeometry(0.14, 0.16, 0.14);
const crossVertical = new THREE.BoxGeometry(0.09, 0.3, 0.09);
const crossHorizontal = new THREE.BoxGeometry(0.25, 0.08, 0.09);
const knightHead = new THREE.BoxGeometry(0.22, 0.3, 0.35);
/**
 * Build the mesh group representing one chess piece.
 *
 * @param piece - Piece descriptor or signed board value for the game operation.
 * @returns Three.js group containing the mesh parts for one chess piece.
 */
function createPiece(piece) {
    const group = new THREE.Group();
    const material = piece.color === 'w' ? whiteMaterial : blackMaterial;
    /**
     * Add a positioned geometry part to the current chess piece.
     *
     * @param geometry - Three.js geometry used for the new mesh.
     * @param x - X coordinate in the operation's local coordinate system.
     * @param y - Y coordinate in the operation's local coordinate system.
     * @param z - Z coordinate in the operation's local coordinate system.
     * @returns New mesh attached to the current piece group.
     */
    const add = (geometry, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); group.add(mesh); return mesh;
    };
    add(baseGeometry, 0, 0.08, 0);
    add(stemGeometry, 0, 0.32, 0);
    add(collarGeometry, 0, 0.55, 0);
    if (piece.type === 'p') add(sphereGeometry, 0, 0.71, 0);
    if (piece.type === 'r') {
        add(collarGeometry, 0, 0.66, 0);
        for (let i = 0; i < 4; i++) add(blockGeometry, Math.cos(i * Math.PI / 2) * 0.17, 0.78, Math.sin(i * Math.PI / 2) * 0.17);
    }
    if (piece.type === 'b') { add(crownGeometry, 0, 0.74, 0); const top = add(sphereGeometry, 0, 0.91, 0); top.scale.setScalar(0.4); }
    if (piece.type === 'n') {
        const head = add(knightHead, 0, 0.73, piece.color === 'w' ? -0.06 : 0.06);
        head.rotation.x = piece.color === 'w' ? -0.35 : 0.35;
        const ear = add(blockGeometry, 0, 0.94, piece.color === 'w' ? 0.05 : -0.05); ear.scale.set(0.6, 1, 0.6);
    }
    if (piece.type === 'q') {
        const crown = add(crownGeometry, 0, 0.75, 0); crown.rotation.z = Math.PI;
        for (let i = 0; i < 5; i++) { const jewel = add(sphereGeometry, Math.cos(i * Math.PI * 2 / 5) * 0.2, 0.92, Math.sin(i * Math.PI * 2 / 5) * 0.2); jewel.scale.setScalar(0.3); }
    }
    if (piece.type === 'k') { add(sphereGeometry, 0, 0.73, 0); add(crossVertical, 0, 1, 0); add(crossHorizontal, 0, 1.04, 0); }
    const badge = label(piece.type.toUpperCase(), piece.color === 'w' ? '#182735' : '#e6edf5', 0.19);
    badge.material.depthTest = true;
    badge.position.set(0, 0.45, 0.24); group.add(badge);
    group.position.copy(squarePosition(piece.square));
    group.userData.square = piece.square;
    return group;
}
/**
 * Remove group children and release their disposable rendering resources.
 *
 * @param group - Three.js group whose child objects are being removed.
 * @param disposeSprites - Whether sprite-specific textures and materials should also be disposed. Default: false.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function clearGroup(group, disposeSprites = false) {
    for (const child of [...group.children]) {
        if (disposeSprites) child.traverse((object) => { if (object.isSprite) { object.material.map.dispose(); object.material.dispose(); } });
        else child.geometry?.dispose();
        group.remove(child);
    }
}
/**
 * Rebuild the position view and update legal destinations, game status, and history.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function refresh() {
    clearGroup(pieces, true);
    clearGroup(hints);
    const moves = game.history({ verbose: true });
    const last = moves[moves.length - 1];
    for (const [square, tile] of tiles) {
        tile.material = tile.userData.baseMaterial;
        if (last && (square === last.from || square === last.to)) tile.material = lastSquare;
        const piece = game.get(square);
        if (piece) {
            pieces.add(createPiece({ ...piece, square }));
            if (piece.type === 'k' && piece.color === game.turn() && game.isCheck()) tile.material = checkSquare;
        }
    }
    if (selected) tiles.get(selected).material = selectedSquare;
    for (const square of new Set(legal.map(move => move.to))) {
        const capture = !!game.get(square) || legal.some(move => move.to === square && move.flags.includes('e'));
        const marker = new THREE.Mesh(capture ? new THREE.RingGeometry(0.36, 0.44, 32) : new THREE.CircleGeometry(0.12, 24), markerMaterial);
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(squarePosition(square)); marker.position.y = 0.02;
        hints.add(marker);
    }
    const side = game.turn() === 'w' ? 'White' : 'Black';
    if (game.isCheckmate()) status.textContent = `Checkmate — ${side === 'White' ? 'Black' : 'White'} wins!`;
    else if (game.isStalemate()) status.textContent = 'Draw — stalemate';
    else if (game.isThreefoldRepetition()) status.textContent = 'Draw — threefold repetition';
    else if (game.isInsufficientMaterial()) status.textContent = 'Draw — insufficient material';
    else if (game.isDraw()) status.textContent = 'Draw — fifty-move rule';
    else status.textContent = `${game.turn() === playerColor ? 'Your turn' : 'AI thinking'} — ${side}${game.isCheck() ? ' — check!' : ''}`;
    selectionStatus.textContent = selected ? `${names[game.get(selected).type]} on ${selected} · ${new Set(legal.map(m => m.to)).size} legal destinations` : 'Select a piece, then a highlighted square.';
    history.replaceChildren();
    if (!moves.length) { const p = document.createElement('p'); p.textContent = 'No moves yet.'; history.appendChild(p); }
    for (let i = 0; i < moves.length; i += 2) {
        const row = document.createElement('div'); row.className = 'move-row';
        for (const text of [`${i / 2 + 1}.`, moves[i].san, moves[i + 1]?.san ?? '']) { const span = document.createElement('span'); span.textContent = text; row.appendChild(span); }
        history.appendChild(row);
    }
    history.scrollTop = history.scrollHeight;
    document.getElementById('undo').disabled = !moves.some(move => move.color === playerColor);
}
/**
 * Cancel or invalidate the previous search so old moves cannot affect a new position.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function cancelAI() {
    aiRequest++;
    aiWorker?.terminate();
    aiWorker = null;
    aiThinking = false;
}
/**
 * Send the current position to a background worker when the computer should move.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function requestAI() {
    if (game.turn() === playerColor || game.isGameOver()) return;
    cancelAI();
    aiThinking = true;
    const request = aiRequest;
    const fen = game.fen();
    refresh();
    /**
     * Apply the computer result only if its search request still matches the current game.
     *
     * @param move - Legal move descriptor containing origin, destination/path, and capture or promotion data.
     * @returns No value is returned; updates the current state, scene, or interface.
     */
    function finish(move) {
        if (request !== aiRequest || game.fen() !== fen || game.turn() === playerColor) return;
        cancelAI();
        if (move) game.move(move);
        refresh();
    }
    /**
     * Run the fallback computer search when the worker cannot provide a result.
     *
     * Inputs: None; uses enclosing state where needed.
     * @returns No value is returned; updates the current state, scene, or interface.
     */
    function fallback() {
        aiWorker?.terminate();
        aiWorker = null;
        // A short local search keeps play available if module workers are blocked.
        setTimeout(() => {
            if (request === aiRequest && game.fen() === fen) finish(chooseMove(fen, { maxDepth: 1, timeLimit: 100 }));
        }, 30);
    }
    try {
        aiWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
        aiWorker.onmessage = ({ data }) => {
            if (request !== aiRequest || data.fen !== fen) return;
            if (data.error) fallback();
            else finish(data.move);
        };
        aiWorker.onerror = (event) => { event.preventDefault(); if (request === aiRequest) fallback(); };
        aiWorker.postMessage({ fen });
    } catch { fallback(); }
}
/**
 * Apply a legal move, refresh the board, and request the opponent's response.
 *
 * @param from - Origin chess square for the proposed move.
 * @param to - Destination chess square for the proposed move.
 * @param promotion - Piece type to select when a pawn is promoted.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function commitMove(from, to, promotion) {
    if (aiThinking || game.turn() !== playerColor || game.isGameOver()) return;
    try { game.move({ from, to, ...(promotion ? { promotion } : {}) }); }
    catch { return; }
    selected = null; legal = []; pendingPromotion = null;
    refresh();
    requestAI();
}
/**
 * Handle piece selection and legal destination clicks, including promotion.
 *
 * @param square - Algebraic chess square such as e4.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function chooseSquare(square) {
    if (game.isGameOver() || pendingPromotion || aiThinking || game.turn() !== playerColor) return;
    const candidates = legal.filter(move => move.to === square);
    if (selected && candidates.length) {
        if (candidates.some(move => move.promotion)) { pendingPromotion = { from: selected, to: square }; promotionDialog.showModal(); }
        else commitMove(selected, square);
        return;
    }
    const piece = game.get(square);
    selected = piece?.color === game.turn() && selected !== square ? square : null;
    legal = selected ? game.moves({ square: selected, verbose: true }) : [];
    refresh();
}
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let pointerStart;
renderer.domElement.addEventListener('pointerdown', (event) => { pointerStart = event.button === 0 && event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null; });
renderer.domElement.addEventListener('pointercancel', () => { pointerStart = null; });
renderer.domElement.addEventListener('pointerup', (event) => {
    const start = pointerStart; pointerStart = null;
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    // Pick the visible piece before the ground so tall pieces select correctly.
    const pieceHit = raycaster.intersectObjects(pieces.children, true)[0];
    if (pieceHit) {
        let object = pieceHit.object;
        while (object && !object.userData.square) object = object.parent;
        if (object) { chooseSquare(object.userData.square); return; }
    }
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const file = Math.floor(hit.x + 4), rank = 8 - Math.floor(hit.z + 4);
    if (file >= 0 && file < 8 && rank >= 1 && rank <= 8) chooseSquare(String.fromCharCode(97 + file) + rank);
});
promotionDialog.querySelectorAll('[data-piece]').forEach(button => button.addEventListener('click', () => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    promotionDialog.close(); commitMove(from, to, button.dataset.piece);
}));
/**
 * Close the promotion prompt and clear the pending promotion choice.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function cancelPromotion() { pendingPromotion = null; if (promotionDialog.open) promotionDialog.close(); }
promotionDialog.addEventListener('cancel', () => { pendingPromotion = null; });
promotionDialog.addEventListener('close', () => { pendingPromotion = null; });
document.getElementById('cancel-promotion').addEventListener('click', cancelPromotion);
/**
 * Reset rules state, history, selections, and computer search for a fresh match.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function startNewGame() {
    cancelPromotion();
    cancelAI();
    playerColor = document.getElementById('player-color').value;
    game.reset();
    selected = null;
    legal = [];
    flipped = playerColor === 'b';
    setCamera();
    refresh();
    requestAI();
}
document.getElementById('new-game').addEventListener('click', startNewGame);
document.getElementById('player-color').addEventListener('change', startNewGame);
/**
 * Return to an earlier human turn while canceling any outdated AI response.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function undoTurn() {
    if (!game.history({ verbose: true }).some(move => move.color === playerColor)) return;
    cancelPromotion();
    cancelAI();
    game.undo();
    // After an AI reply, also undo the human move; during AI search, undo only
    // the pending human move. Preserve the AI's opening when playing Black.
    if (game.turn() !== playerColor) game.undo();
    selected = null;
    legal = [];
    refresh();
}
document.getElementById('undo').addEventListener('click', undoTurn);
/**
 * Fit and orient the board according to the selected viewing side.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function setCamera() {
    const distance = Math.max(12.5, 10 / Math.max(camera.aspect, 0.4));
    camera.position.set(0, distance * 0.85, distance * (flipped ? -0.78 : 0.78));
    controls.target.set(0, 0, 0); controls.update();
}
document.getElementById('flip').addEventListener('click', () => { flipped = !flipped; setCamera(); });
/**
 * Synchronize renderer dimensions and camera projection with the available container size.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function resize() {
    const width = Math.max(view.clientWidth, 1), height = Math.max(view.clientHeight, 1);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); setCamera();
}
// Recalculate view dimensions when the surrounding layout changes.
new ResizeObserver(resize).observe(view);
resize(); startNewGame();
// Keep visual frames separate from the simulation's own update timing.
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
