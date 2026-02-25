/**
 * tools/chess.js
 * Full chess game manager: board state, move validation, ASCII rendering,
 * and a heuristic computer AI — all without touching the LLM.
 *
 * Uses chess.js for rules enforcement (legal moves, check/checkmate/stalemate).
 */

import { Chess } from 'chess.js';

// ── Piece values for heuristic AI ─────────────────────────────────────────────
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ── Unicode chess pieces ───────────────────────────────────────────────────────
const PIECE_UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

export class ChessGame {
  constructor() {
    // Map of chatId → { chess: Chess instance, playerColor: 'w'|'b', moveCount: number }
    this.sessions = new Map();
  }

  // ── Start a new game ─────────────────────────────────────────────────────────
  start(chatId, playerColor = 'w') {
    const chess = new Chess();
    const col = playerColor.toLowerCase().startsWith('b') ? 'b' : 'w';
    this.sessions.set(chatId, { chess, playerColor: col, moveCount: 0 });

    const board = this._renderBoard(chess, col);
    const colorName = col === 'w' ? 'White ♙' : 'Black ♟';
    let msg = `♟️ *Chess game started!*\nYou are playing as *${colorName}*.\n\n${board}\n\n`;

    if (col === 'w') {
      msg += `Your turn! Make your move (e.g. \`e4\`, \`Nf3\`, \`e2e4\`).`;
    } else {
      // Computer plays first as white
      const compMove = this._pickMove(chess);
      chess.move(compMove);
      const updatedBoard = this._renderBoard(chess, col);
      msg = `♟️ *Chess game started!*\nYou are playing as *${colorName}*.\n\n${updatedBoard}\n\nI opened with *${compMove.san}*. Your move!`;
    }
    return { text: msg, active: true };
  }

  // ── Handle a player move ─────────────────────────────────────────────────────
  move(chatId, moveInput) {
    const session = this.sessions.get(chatId);
    if (!session) return null; // no active game — signal caller to ignore

    const { chess, playerColor } = session;

    // It must be the player's turn
    if (chess.turn() !== playerColor) {
      return { text: `⏳ Wait — it's not your turn yet.`, active: true };
    }

    // Try to parse the move
    let playerMove;
    try {
      // chess.js accepts SAN ("e4", "Nf3", "O-O") and UCI ("e2e4")
      const input = moveInput.trim();
      playerMove = chess.move(input) || chess.move({ from: input.slice(0, 2), to: input.slice(2, 4), promotion: 'q' });
    } catch {
      playerMove = null;
    }

    if (!playerMove) {
      const legal = chess.moves().slice(0, 8).join(', ');
      return {
        text: `❌ *"${moveInput}"* is not a legal move. Try: \`${legal}${chess.moves().length > 8 ? '…' : ''}\``,
        active: true,
      };
    }

    session.moveCount++;

    // Check game-ending conditions after player move
    const afterPlayer = this._gameStatus(chess, playerColor);
    if (afterPlayer.over) {
      this.sessions.delete(chatId);
      const board = this._renderBoard(chess, playerColor);
      return { text: `${board}\n\n${afterPlayer.message}`, active: false };
    }

    // Computer's turn
    const compMoveSan = this._pickMove(chess);
    if (!compMoveSan) {
      // Shouldn't happen, but guard
      this.sessions.delete(chatId);
      return { text: this._renderBoard(chess, playerColor) + '\n\n🤝 *Draw — no legal moves.*', active: false };
    }
    chess.move(compMoveSan);
    session.moveCount++;

    // Check game-ending conditions after computer move
    const afterComp = this._gameStatus(chess, playerColor);
    const board = this._renderBoard(chess, playerColor);

    if (afterComp.over) {
      this.sessions.delete(chatId);
      return { text: `${board}\n\nI played *${compMoveSan.san}*\n\n${afterComp.message}`, active: false };
    }

    const checkHint = chess.inCheck() ? ' — *you are in check!*' : '';
    return {
      text: `${board}\n\nI played *${compMoveSan.san}*${checkHint}\n\nYour move! (Move ${Math.ceil(session.moveCount / 2 + 1)})`,
      active: true,
    };
  }

  // ── Check if a chatId has an active game ──────────────────────────────────────
  hasGame(chatId) {
    return this.sessions.has(chatId);
  }

  // ── Resign ───────────────────────────────────────────────────────────────────
  resign(chatId) {
    this.sessions.delete(chatId);
    return { text: `🏳️ You resigned. Better luck next time! Start a new game with \`/chess\`.`, active: false };
  }

  // ── Show current board ────────────────────────────────────────────────────────
  showBoard(chatId) {
    const session = this.sessions.get(chatId);
    if (!session) return null;
    const board = this._renderBoard(session.chess, session.playerColor);
    const turn = session.chess.turn() === session.playerColor ? "Your turn" : "My turn";
    return { text: `${board}\n\n${turn}`, active: true };
  }

  // ── Heuristic AI: pick best move ──────────────────────────────────────────────
  _pickMove(chess) {
    const moves = chess.moves({ verbose: true });
    if (!moves.length) return null;

    // Score each move: capture value + check bonus + centre bonus
    const scored = moves.map(m => {
      let score = 0;
      if (m.captured) score += PIECE_VALUE[m.captured] * 10;
      // Check bonus
      chess.move(m);
      if (chess.inCheck()) score += 5;
      if (chess.isCheckmate()) score += 1000;
      chess.undo();
      // Prefer centre squares
      if (['d4', 'd5', 'e4', 'e5'].includes(m.to)) score += 3;
      if (['c4', 'c5', 'f4', 'f5'].includes(m.to)) score += 1;
      // Add small random noise to avoid repetitive play
      score += Math.random() * 0.5;
      return { move: m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].move;
  }

  // ── Render board as Unicode text ─────────────────────────────────────────────
  _renderBoard(chess, playerColor) {
    const board = chess.board(); // 8×8 array, rank 0 = rank 8
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    // White sees rank 8 at top (board[0]); Black sees rank 1 at top (board[7])
    const ranks = playerColor === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const fileCols = playerColor === 'b' ? [...files].reverse() : files;

    const lines = [];
    lines.push('```');
    lines.push(`  ${fileCols.map(f => f.toUpperCase()).join(' ')}`);

    for (const r of ranks) {
      const rankNum = 8 - r;
      const row = board[r];
      const cells = (playerColor === 'b' ? [...row].reverse() : row).map((sq, ci) => {
        if (!sq) {
          // Light/dark square indicator
          const isLight = (r + (playerColor === 'b' ? (7 - ci) : ci)) % 2 === 0;
          return isLight ? '·' : '·';
        }
        const key = sq.color + sq.type.toUpperCase();
        return PIECE_UNICODE[key] || sq.type;
      });
      lines.push(`${rankNum} ${cells.join(' ')} ${rankNum}`);
    }

    lines.push(`  ${fileCols.map(f => f.toUpperCase()).join(' ')}`);
    lines.push('```');

    // Status line
    const status = [];
    if (chess.inCheck()) status.push('⚠️ Check!');
    if (chess.isDraw()) status.push('½ Draw');
    if (status.length) lines.push(status.join(' '));

    return lines.join('\n');
  }

  // ── Detect game-over states ───────────────────────────────────────────────────
  _gameStatus(chess, playerColor) {
    if (chess.isCheckmate()) {
      const winner = chess.turn() !== playerColor ? 'You win' : 'I win';
      const emoji = chess.turn() !== playerColor ? '🎉' : '😈';
      return { over: true, message: `${emoji} *Checkmate! ${winner}!*\n\nGG! Type \`/chess\` to play again.` };
    }
    if (chess.isStalemate()) return { over: true, message: `🤝 *Stalemate — it's a draw!*` };
    if (chess.isDraw()) return { over: true, message: `🤝 *Draw! (${chess.isThreefoldRepetition() ? 'threefold repetition' : chess.isInsufficientMaterial() ? 'insufficient material' : '50-move rule'})*` };
    return { over: false };
  }
}
