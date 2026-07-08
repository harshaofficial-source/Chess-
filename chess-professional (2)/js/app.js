/* ============================================================
   Fortress — app controller
   ============================================================ */

// The traditional Unicode chess set, exactly as specified:
// White pieces are the "outline" glyphs, Black pieces are the "solid" glyphs.
const PIECE_GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const AI_THINK_DELAY = 320; // ms, purely for UX pacing

/* ---------------- App state ---------------- */
const state = {
  mode: null,             // 'computer' | 'two-player'
  difficulty: null,       // 'beginner' | 'intermediate' | 'expert'
  game: null,             // ChessGame instance
  selected: null,         // square index selected by current user
  legalTargets: [],       // legal moves from selected square
  humanColor: 'w',        // for computer mode, human is always white
  lastMove: null,
  aiThinking: false,
  pendingPromotion: null, // {from, to} awaiting promotion choice
  turnToken: 0,           // bumped whenever a pending AI move should be invalidated (e.g. undo)
};

/* ---------------- DOM refs ---------------- */
const el = (id) => document.getElementById(id);
const screens = document.querySelectorAll('[data-screen]');
const boardEl = el('board');
const statusPlateEl = el('statusPlate');
const capturedByWhiteEl = el('capturedByWhite');
const capturedByBlackEl = el('capturedByBlack');
const topNameEl = el('topName');
const bottomNameEl = el('bottomName');
const promoPicker = el('promoPicker');
const promoOptions = el('promoOptions');
const resultOverlay = el('resultOverlay');
const resultEyebrow = el('resultEyebrow');
const resultTitle = el('resultTitle');

/* ---------------- Screen navigation ---------------- */
function showScreen(id) {
  screens.forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

/* ---------------- Game lifecycle ---------------- */
function startGame(mode, difficulty) {
  state.turnToken++; // invalidate any in-flight AI move from a previous game
  state.mode = mode;
  state.difficulty = difficulty || null;
  state.game = new ChessGame();
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.pendingPromotion = null;
  state.aiThinking = false;
  promoPicker.hidden = true;
  resultOverlay.hidden = true;

  topNameEl.textContent = mode === 'computer' ? capitalize(difficulty) + ' (computer)' : 'Black';
  bottomNameEl.textContent = mode === 'computer' ? 'You' : 'White';

  renderBoard();
  renderCaptured();
  updateStatusPlate();
  showScreen('screen-game');
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function isHumanTurn() {
  if (state.mode === 'two-player') return true;
  return state.game.turn === state.humanColor && !state.aiThinking;
}

/* ---------------- Board rendering ---------------- */
function renderBoard() {
  boardEl.innerHTML = '';
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const index = rank * 8 + file;
      const squareEl = document.createElement('div');
      const isLight = (rank + file) % 2 === 1;
      squareEl.className = 'square ' + (isLight ? 'light' : 'dark');
      squareEl.dataset.square = index;

      if (file === 0) {
        const rankCoord = document.createElement('span');
        rankCoord.className = 'coord coord-rank';
        rankCoord.textContent = rank + 1;
        squareEl.appendChild(rankCoord);
      }
      if (rank === 0) {
        const fileCoord = document.createElement('span');
        fileCoord.className = 'coord coord-file';
        fileCoord.textContent = 'abcdefgh'[file];
        squareEl.appendChild(fileCoord);
      }

      const piece = state.game.board[index];
      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black');
        pieceEl.textContent = PIECE_GLYPH[piece.color][piece.type];
        squareEl.appendChild(pieceEl);
      }

      squareEl.addEventListener('click', () => onSquareClick(index));
      boardEl.appendChild(squareEl);
    }
  }
  applyBoardHighlights();
}

function applyBoardHighlights() {
  const squares = boardEl.querySelectorAll('.square');
  squares.forEach(sqEl => {
    const index = parseInt(sqEl.dataset.square, 10);
    sqEl.classList.remove('selected', 'last-move', 'in-check');
    const dot = sqEl.querySelector('.move-dot'); if (dot) dot.remove();
    const ring = sqEl.querySelector('.capture-ring'); if (ring) ring.remove();

    if (state.selected === index) sqEl.classList.add('selected');
    if (state.lastMove && (state.lastMove.from === index || state.lastMove.to === index)) sqEl.classList.add('last-move');

    const target = state.legalTargets.find(m => m.to === index);
    if (target) {
      const marker = document.createElement('span');
      marker.className = target.captured || target.enPassant ? 'capture-ring' : 'move-dot';
      sqEl.appendChild(marker);
    }
  });

  if (state.game.status === 'check' || state.game.status === 'checkmate') {
    const kingSq = state.game.findKing(state.game.turn);
    const kingEl = boardEl.querySelector(`[data-square="${kingSq}"]`);
    if (kingEl) kingEl.classList.add('in-check');
  }
}

/* ---------------- Interaction ---------------- */
function onSquareClick(index) {
  if (state.pendingPromotion) return;
  if (!isHumanTurn() || state.game.isGameOver()) return;

  const piece = state.game.board[index];

  if (state.selected !== null) {
    const move = state.legalTargets.find(m => m.to === index);
    if (move) {
      if (move.promotion) {
        openPromotionPicker(state.selected, index, piece ? piece.color : state.game.turn);
        return;
      }
      commitMove(state.selected, index, 'q');
      return;
    }
  }

  if (piece && piece.color === state.game.turn) {
    state.selected = index;
    state.legalTargets = state.game.legalMovesFrom(index);
  } else {
    state.selected = null;
    state.legalTargets = [];
  }
  applyBoardHighlights();
}

function openPromotionPicker(from, to, color) {
  state.pendingPromotion = { from, to };
  promoOptions.innerHTML = '';
  ['q', 'r', 'b', 'n'].forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promo-option';
    const glyph = document.createElement('span');
    glyph.className = 'piece ' + (color === 'w' ? 'white' : 'black');
    glyph.textContent = PIECE_GLYPH[color][type];
    btn.appendChild(glyph);
    btn.addEventListener('click', () => {
      const { from, to } = state.pendingPromotion;
      state.pendingPromotion = null;
      promoPicker.hidden = true;
      commitMove(from, to, type);
    });
    promoOptions.appendChild(btn);
  });
  promoPicker.hidden = false;
}

function commitMove(from, to, promotion) {
  const move = state.game.makeMove(from, to, promotion);
  if (!move) return;

  state.lastMove = { from, to };
  state.selected = null;
  state.legalTargets = [];

  renderBoard();
  renderCaptured();
  updateStatusPlate();

  if (checkForGameEnd()) return;

  if (state.mode === 'computer' && state.game.turn !== state.humanColor) {
    triggerAIMove();
  }
}

function triggerAIMove() {
  state.aiThinking = true;
  updateStatusPlate();
  const token = state.turnToken;
  setTimeout(() => {
    if (token !== state.turnToken) return; // stale — position changed (e.g. undo) while "thinking"
    const move = getAIMove(state.game, state.difficulty);
    if (!move) { state.aiThinking = false; return; }
    state.game.makeMove(move.from, move.to, move.promotion || 'q');
    state.lastMove = { from: move.from, to: move.to };
    state.aiThinking = false;

    renderBoard();
    renderCaptured();
    updateStatusPlate();
    checkForGameEnd();
  }, AI_THINK_DELAY);
}

function glyphSpansHTML(types, color) {
  const cls = color === 'w' ? 'white' : 'black';
  return types.map(t => `<span class="piece ${cls} piece-mini">${PIECE_GLYPH[color][t]}</span>`).join('');
}

function renderCaptured() {
  const captured = { w: [], b: [] }; // pieces captured, keyed by the color that WAS captured
  for (const h of state.game.history) {
    const m = h.move;
    if (m.captured) captured[m.color === 'w' ? 'b' : 'w'].push(m.captured);
    if (m.enPassant) captured[m.color === 'w' ? 'b' : 'w'].push('p');
  }
  // Each player's row shows the trophies they've won (their opponent's captured pieces).
  capturedByWhiteEl.innerHTML = glyphSpansHTML(captured.w, 'w'); // top row (Black) shows white pieces it captured
  capturedByBlackEl.innerHTML = glyphSpansHTML(captured.b, 'b'); // bottom row (White/you) shows black pieces it captured
}

function updateStatusPlate() {
  statusPlateEl.classList.remove('check');
  const turnName = state.game.turn === 'w' ? 'White' : 'Black';

  if (state.aiThinking) {
    statusPlateEl.textContent = 'Computer is thinking…';
    return;
  }
  switch (state.game.status) {
    case 'checkmate':
      statusPlateEl.textContent = 'Checkmate — ' + (state.game.turn === 'w' ? 'Black' : 'White') + ' wins';
      break;
    case 'stalemate':
      statusPlateEl.textContent = 'Stalemate — draw';
      break;
    case 'draw-50move':
      statusPlateEl.textContent = 'Draw — 50-move rule';
      break;
    case 'draw-material':
      statusPlateEl.textContent = 'Draw — insufficient material';
      break;
    case 'check':
      statusPlateEl.textContent = turnName + ' is in check';
      statusPlateEl.classList.add('check');
      break;
    default:
      if (state.mode === 'computer') {
        statusPlateEl.textContent = state.game.turn === state.humanColor ? 'Your move' : 'Computer is thinking…';
      } else {
        statusPlateEl.textContent = turnName + ' to move';
      }
  }
}

function checkForGameEnd() {
  if (!state.game.isGameOver()) return false;
  applyBoardHighlights();

  let eyebrow = 'Game over';
  let title = '';

  if (state.game.status === 'checkmate') {
    const winnerColor = state.game.winner();
    eyebrow = 'Checkmate';
    title = (winnerColor === 'w' ? 'White' : 'Black') + ' wins';
  } else {
    eyebrow = 'Draw';
    title = state.game.status === 'stalemate' ? 'Stalemate' :
      state.game.status === 'draw-50move' ? '50-move rule' : 'Insufficient material';
  }

  resultEyebrow.textContent = eyebrow;
  resultTitle.textContent = title;
  resultOverlay.hidden = false;
  return true;
}

/* ---------------- Undo ---------------- */
function handleUndo() {
  if (state.pendingPromotion) return;
  if (state.game.history.length === 0) return;
  state.turnToken++; // invalidate any in-flight AI move

  if (state.mode === 'computer') {
    // Undo both the AI reply and the player's move so it's the player's turn again.
    state.game.undo();
    if (state.game.history.length > 0 && state.game.turn !== state.humanColor) {
      state.game.undo();
    }
  } else {
    state.game.undo();
  }

  state.selected = null;
  state.legalTargets = [];
  const lastHist = state.game.history[state.game.history.length - 1];
  state.lastMove = lastHist ? { from: lastHist.move.from, to: lastHist.move.to } : null;
  state.aiThinking = false;

  renderBoard();
  renderCaptured();
  updateStatusPlate();
  resultOverlay.hidden = true;
}

/* ---------------- Wiring ---------------- */
el('btnVsComputer').addEventListener('click', () => showScreen('screen-difficulty'));
el('btnTwoPlayer').addEventListener('click', () => startGame('two-player', null));
el('homeBtn').addEventListener('click', () => showScreen('screen-home'));

document.querySelectorAll('.diff-card').forEach(card => {
  card.addEventListener('click', () => startGame('computer', card.dataset.difficulty));
});

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

el('undoBtn').addEventListener('click', handleUndo);
el('newGameBtn').addEventListener('click', () => startGame(state.mode, state.difficulty));
el('resignBtn').addEventListener('click', () => { resultOverlay.hidden = true; showScreen('screen-home'); });
el('resultRematch').addEventListener('click', () => { resultOverlay.hidden = true; startGame(state.mode, state.difficulty); });
el('resultHome').addEventListener('click', () => { resultOverlay.hidden = true; showScreen('screen-home'); });

/* ---------------- Init ---------------- */
showScreen('screen-home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
