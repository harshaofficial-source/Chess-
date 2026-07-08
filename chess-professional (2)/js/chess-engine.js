/* ============================================================
   Chess Engine - full rules implementation
   Board: 64-square array, index = rank*8 + file
   rank 0 = rank "1" (white side), file 0 = file "a"
   ============================================================ */

const WHITE = 'w', BLACK = 'b';

function sq(file, rank) { return rank * 8 + file; }
function fileOf(i) { return i % 8; }
function rankOf(i) { return Math.floor(i / 8); }
function algebraic(i) {
  return 'abcdefgh'[fileOf(i)] + (rankOf(i) + 1);
}
function fromAlgebraic(s) {
  const file = s.charCodeAt(0) - 97;
  const rank = parseInt(s[1], 10) - 1;
  return sq(file, rank);
}

class ChessGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = new Array(64).fill(null);
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let f = 0; f < 8; f++) {
      this.board[sq(f, 0)] = { type: backRank[f], color: WHITE };
      this.board[sq(f, 1)] = { type: 'p', color: WHITE };
      this.board[sq(f, 6)] = { type: 'p', color: BLACK };
      this.board[sq(f, 7)] = { type: backRank[f], color: BLACK };
    }
    this.turn = WHITE;
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.epSquare = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = []; // stack of {move, prevState} for undo
    this.status = 'active'; // active | checkmate | stalemate | draw
  }

  clone() {
    const g = Object.create(ChessGame.prototype);
    g.board = this.board.map(p => p ? { ...p } : null);
    g.turn = this.turn;
    g.castling = { ...this.castling };
    g.epSquare = this.epSquare;
    g.halfmoveClock = this.halfmoveClock;
    g.fullmoveNumber = this.fullmoveNumber;
    g.history = [];
    g.status = this.status;
    return g;
  }

  pieceAt(i) { return this.board[i]; }

  opponent(color) { return color === WHITE ? BLACK : WHITE; }

  isSquareAttacked(i, byColor) {
    const targetFile = fileOf(i), targetRank = rankOf(i);

    // Pawn attacks
    const pawnDir = byColor === WHITE ? -1 : 1; // squares from which a pawn of byColor attacks i
    for (const df of [-1, 1]) {
      const f = targetFile + df, r = targetRank + pawnDir;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = this.board[sq(f, r)];
        if (p && p.type === 'p' && p.color === byColor) return true;
      }
    }

    // Knight attacks
    const knightOffsets = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
    for (const [df, dr] of knightOffsets) {
      const f = targetFile + df, r = targetRank + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = this.board[sq(f, r)];
        if (p && p.type === 'n' && p.color === byColor) return true;
      }
    }

    // King attacks (adjacent)
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const f = targetFile + df, r = targetRank + dr;
        if (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const p = this.board[sq(f, r)];
          if (p && p.type === 'k' && p.color === byColor) return true;
        }
      }
    }

    // Sliding pieces: rook/queen (orthogonal)
    const rookDirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [df, dr] of rookDirs) {
      let f = targetFile + df, r = targetRank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = this.board[sq(f, r)];
        if (p) {
          if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    // Sliding pieces: bishop/queen (diagonal)
    const bishopDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [df, dr] of bishopDirs) {
      let f = targetFile + df, r = targetRank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = this.board[sq(f, r)];
        if (p) {
          if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    return false;
  }

  findKing(color) {
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (p && p.type === 'k' && p.color === color) return i;
    }
    return -1;
  }

  inCheck(color) {
    const kingSq = this.findKing(color);
    if (kingSq === -1) return false;
    return this.isSquareAttacked(kingSq, this.opponent(color));
  }

  // Generate pseudo-legal moves for the piece at square i (does not check for own-king safety)
  pseudoMovesFrom(i) {
    const piece = this.board[i];
    if (!piece) return [];
    const moves = [];
    const f0 = fileOf(i), r0 = rankOf(i);
    const color = piece.color;

    const addMove = (to, flags = {}) => {
      moves.push({ from: i, to, piece: piece.type, color, captured: this.board[to] ? this.board[to].type : null, ...flags });
    };

    if (piece.type === 'p') {
      const dir = color === WHITE ? 1 : -1;
      const startRank = color === WHITE ? 1 : 6;
      const promoRank = color === WHITE ? 7 : 0;
      const oneStep = sq(f0, r0 + dir);
      if (r0 + dir >= 0 && r0 + dir < 8 && !this.board[oneStep]) {
        if (r0 + dir === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n']) addMove(oneStep, { promotion: promo });
        } else {
          addMove(oneStep);
        }
        const twoStep = sq(f0, r0 + dir * 2);
        if (r0 === startRank && !this.board[twoStep]) {
          addMove(twoStep, { doublePawn: true });
        }
      }
      for (const df of [-1, 1]) {
        const f = f0 + df, r = r0 + dir;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const target = sq(f, r);
        const targetPiece = this.board[target];
        if (targetPiece && targetPiece.color !== color) {
          if (r === promoRank) {
            for (const promo of ['q', 'r', 'b', 'n']) addMove(target, { promotion: promo });
          } else {
            addMove(target);
          }
        } else if (!targetPiece && target === this.epSquare) {
          addMove(target, { enPassant: true });
        }
      }
    } else if (piece.type === 'n') {
      const offsets = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
      for (const [df, dr] of offsets) {
        const f = f0 + df, r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const target = sq(f, r);
        const targetPiece = this.board[target];
        if (!targetPiece || targetPiece.color !== color) addMove(target);
      }
    } else if (piece.type === 'k') {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          const f = f0 + df, r = r0 + dr;
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const target = sq(f, r);
          const targetPiece = this.board[target];
          if (!targetPiece || targetPiece.color !== color) addMove(target);
        }
      }
      // Castling
      const rank = color === WHITE ? 0 : 7;
      if (i === sq(4, rank)) {
        const kSideOk = color === WHITE ? this.castling.wK : this.castling.bK;
        const qSideOk = color === WHITE ? this.castling.wQ : this.castling.bQ;
        const oppColor = this.opponent(color);
        if (kSideOk && !this.board[sq(5, rank)] && !this.board[sq(6, rank)] &&
            this.board[sq(7, rank)] && this.board[sq(7, rank)].type === 'r' && this.board[sq(7, rank)].color === color &&
            !this.isSquareAttacked(sq(4, rank), oppColor) &&
            !this.isSquareAttacked(sq(5, rank), oppColor) &&
            !this.isSquareAttacked(sq(6, rank), oppColor)) {
          addMove(sq(6, rank), { castle: 'K' });
        }
        if (qSideOk && !this.board[sq(3, rank)] && !this.board[sq(2, rank)] && !this.board[sq(1, rank)] &&
            this.board[sq(0, rank)] && this.board[sq(0, rank)].type === 'r' && this.board[sq(0, rank)].color === color &&
            !this.isSquareAttacked(sq(4, rank), oppColor) &&
            !this.isSquareAttacked(sq(3, rank), oppColor) &&
            !this.isSquareAttacked(sq(2, rank), oppColor)) {
          addMove(sq(2, rank), { castle: 'Q' });
        }
      }
    } else {
      // sliding pieces: bishop, rook, queen
      let dirs = [];
      if (piece.type === 'b') dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      if (piece.type === 'r') dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      if (piece.type === 'q') dirs = [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
      for (const [df, dr] of dirs) {
        let f = f0 + df, r = r0 + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const target = sq(f, r);
          const targetPiece = this.board[target];
          if (!targetPiece) {
            addMove(target);
          } else {
            if (targetPiece.color !== color) addMove(target);
            break;
          }
          f += df; r += dr;
        }
      }
    }

    return moves;
  }

  // All legal moves for current player (or specified color)
  legalMoves(color = this.turn) {
    const all = [];
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (p && p.color === color) {
        const pseudo = this.pseudoMovesFrom(i);
        for (const m of pseudo) {
          if (this.moveLeavesKingSafe(m, color)) all.push(m);
        }
      }
    }
    return all;
  }

  legalMovesFrom(i) {
    const p = this.board[i];
    if (!p) return [];
    return this.pseudoMovesFrom(i).filter(m => this.moveLeavesKingSafe(m, p.color));
  }

  moveLeavesKingSafe(move, color) {
    const snapshot = this._snapshot();
    this._applyMoveRaw(move);
    const safe = !this.inCheck(color);
    this._restore(snapshot);
    return safe;
  }

  _snapshot() {
    return {
      board: this.board.map(p => p ? { ...p } : null),
      castling: { ...this.castling },
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      turn: this.turn,
    };
  }

  _restore(snap) {
    this.board = snap.board;
    this.castling = snap.castling;
    this.epSquare = snap.epSquare;
    this.halfmoveClock = snap.halfmoveClock;
    this.fullmoveNumber = snap.fullmoveNumber;
    this.turn = snap.turn;
  }

  // Apply move to board without turn/history bookkeeping (used internally for legality checks)
  _applyMoveRaw(move) {
    const piece = this.board[move.from];
    const rank = piece.color === WHITE ? 0 : 7;

    this.board[move.from] = null;

    if (move.enPassant) {
      const capRank = piece.color === WHITE ? rankOf(move.to) - 1 : rankOf(move.to) + 1;
      this.board[sq(fileOf(move.to), capRank)] = null;
    }

    this.board[move.to] = move.promotion ? { type: move.promotion, color: piece.color } : piece;

    if (move.castle === 'K') {
      this.board[sq(5, rank)] = this.board[sq(7, rank)];
      this.board[sq(7, rank)] = null;
    } else if (move.castle === 'Q') {
      this.board[sq(3, rank)] = this.board[sq(0, rank)];
      this.board[sq(0, rank)] = null;
    }

    // Update castling rights
    if (piece.type === 'k') {
      if (piece.color === WHITE) { this.castling.wK = false; this.castling.wQ = false; }
      else { this.castling.bK = false; this.castling.bQ = false; }
    }
    if (piece.type === 'r') {
      if (move.from === sq(0, 0)) this.castling.wQ = false;
      if (move.from === sq(7, 0)) this.castling.wK = false;
      if (move.from === sq(0, 7)) this.castling.bQ = false;
      if (move.from === sq(7, 7)) this.castling.bK = false;
    }
    if (move.to === sq(0, 0)) this.castling.wQ = false;
    if (move.to === sq(7, 0)) this.castling.wK = false;
    if (move.to === sq(0, 7)) this.castling.bQ = false;
    if (move.to === sq(7, 7)) this.castling.bK = false;

    this.epSquare = move.doublePawn ? sq(fileOf(move.to), (rankOf(move.from) + rankOf(move.to)) / 2) : null;
  }

  // Full move application with turn/history/status update. Returns move object (with SAN-ish info) or null if illegal.
  makeMove(from, to, promotion = 'q') {
    const legal = this.legalMovesFrom(from);
    const move = legal.find(m => m.to === to && (!m.promotion || m.promotion === promotion));
    if (!move) return null;

    const snapshot = this._snapshot();
    const isCapture = !!move.captured || move.enPassant;
    const isPawnMove = move.piece === 'p';

    this._applyMoveRaw(move);

    this.halfmoveClock = (isCapture || isPawnMove) ? 0 : this.halfmoveClock + 1;
    if (this.turn === BLACK) this.fullmoveNumber++;
    this.turn = this.opponent(this.turn);

    this.history.push({ move, prevSnapshot: snapshot });

    this._updateStatus();

    return move;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this._restore(last.prevSnapshot);
    this._updateStatus();
    return true;
  }

  _updateStatus() {
    const moves = this.legalMoves(this.turn);
    const inCheck = this.inCheck(this.turn);
    if (moves.length === 0) {
      this.status = inCheck ? 'checkmate' : 'stalemate';
    } else if (this.halfmoveClock >= 100) {
      this.status = 'draw-50move';
    } else if (this._insufficientMaterial()) {
      this.status = 'draw-material';
    } else {
      this.status = inCheck ? 'check' : 'active';
    }
  }

  _insufficientMaterial() {
    const pieces = this.board.filter(p => p);
    if (pieces.length > 4) return false;
    const nonKing = pieces.filter(p => p.type !== 'k');
    if (nonKing.length === 0) return true; // K vs K
    if (nonKing.length === 1 && (nonKing[0].type === 'b' || nonKing[0].type === 'n')) return true; // K+minor vs K
    return false;
  }

  isGameOver() {
    return ['checkmate', 'stalemate', 'draw-50move', 'draw-material'].includes(this.status);
  }

  winner() {
    if (this.status === 'checkmate') return this.opponent(this.turn);
    return null;
  }
}

if (typeof module !== 'undefined') module.exports = { ChessGame, sq, fileOf, rankOf, algebraic, fromAlgebraic, WHITE, BLACK };
