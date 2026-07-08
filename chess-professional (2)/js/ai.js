/* ============================================================
   Chess AI - three difficulty levels
   beginner: mostly random with slight capture bias, no lookahead
   intermediate: minimax depth 2, alpha-beta, material+position eval
   expert: minimax depth 3, alpha-beta, material+position eval, move ordering
   ============================================================ */

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Piece-square tables (from white's perspective, rank0=rank1 ... rank7=rank8)
const PST = {
  p: [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10,-20,-20, 10, 10,  5,
    5, -5,-10,  0,  0,-10, -5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5,  5, 10, 25, 25, 10,  5,  5,
   10, 10, 20, 30, 30, 20, 10, 10,
   50, 50, 50, 50, 50, 50, 50, 50,
    0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
  ],
  r: [
    0,  0,  0,  5,  5,  0,  0,  0,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    5, 10, 10, 10, 10, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
  ],
  k: [
    20, 30, 10,  0,  0, 10, 30, 20,
    20, 20,  0,  0,  0,  0, 20, 20,
   -10,-20,-20,-20,-20,-20,-20,-10,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30
  ]
};

function evaluateBoard(game) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = game.board[i];
    if (!p) continue;
    const value = PIECE_VALUES[p.type];
    const pstIndex = p.color === 'w' ? i : (63 - i);
    const pstBonus = PST[p.type][pstIndex];
    const total = value + pstBonus;
    score += p.color === 'w' ? total : -total;
  }
  return score; // positive favors white
}

function orderMoves(moves) {
  // MVV-LVA style: captures first, higher value victim / lower value attacker first
  return moves.slice().sort((a, b) => {
    const aScore = a.captured ? (PIECE_VALUES[a.captured] - PIECE_VALUES[a.piece] / 10) : -1;
    const bScore = b.captured ? (PIECE_VALUES[b.captured] - PIECE_VALUES[b.piece] / 10) : -1;
    return bScore - aScore;
  });
}

function minimax(game, depth, alpha, beta, maximizing) {
  if (depth === 0 || game.isGameOver()) {
    if (game.status === 'checkmate') {
      // The side to move is checkmated -> very bad for that side
      return maximizing ? -100000 - depth : 100000 + depth;
    }
    if (game.isGameOver()) return 0;
    return evaluateBoard(game);
  }

  const moves = orderMoves(game.legalMoves());
  if (moves.length === 0) return evaluateBoard(game);

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const snap = game._snapshot();
      const histTurn = game.turn;
      game._applyMoveRaw(m);
      game.turn = game.opponent(histTurn);
      game._updateStatus();
      const val = minimax(game, depth - 1, alpha, beta, false);
      game._restore(snap);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const snap = game._snapshot();
      const histTurn = game.turn;
      game._applyMoveRaw(m);
      game.turn = game.opponent(histTurn);
      game._updateStatus();
      const val = minimax(game, depth - 1, alpha, beta, true);
      game._restore(snap);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

function pickBestMove(game, depth) {
  const color = game.turn;
  const maximizing = color === 'w';
  const moves = orderMoves(game.legalMoves());
  if (moves.length === 0) return null;

  let bestMove = moves[0];
  let bestVal = maximizing ? -Infinity : Infinity;
  let alpha = -Infinity, beta = Infinity;

  for (const m of moves) {
    const snap = game._snapshot();
    const histTurn = game.turn;
    game._applyMoveRaw(m);
    game.turn = game.opponent(histTurn);
    game._updateStatus();
    const val = minimax(game, depth - 1, alpha, beta, !maximizing);
    game._restore(snap);

    if (maximizing ? val > bestVal : val < bestVal) {
      bestVal = val;
      bestMove = m;
    }
    if (maximizing) alpha = Math.max(alpha, bestVal);
    else beta = Math.min(beta, bestVal);
  }
  return bestMove;
}

function pickRandomMove(game, captureBias = 0.35) {
  const moves = game.legalMoves();
  if (moves.length === 0) return null;
  const captures = moves.filter(m => m.captured);
  if (captures.length > 0 && Math.random() < captureBias) {
    return captures[Math.floor(Math.random() * captures.length)];
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

/**
 * Get the AI's chosen move for the given difficulty.
 * @param {ChessGame} game
 * @param {'beginner'|'intermediate'|'expert'} difficulty
 */
function getAIMove(game, difficulty) {
  switch (difficulty) {
    case 'beginner':
      // Weak: random with slight capture bias, occasional 1-ply "blunder check" skipped on purpose
      return pickRandomMove(game, 0.35);
    case 'intermediate':
      return pickBestMove(game, 2);
    case 'expert':
      return pickBestMove(game, 3);
    default:
      return pickRandomMove(game);
  }
}

if (typeof module !== 'undefined') module.exports = { getAIMove, evaluateBoard };
