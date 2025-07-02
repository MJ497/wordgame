// static/js/game.js

document.addEventListener('DOMContentLoaded', () => {
  // ======= CONFIG =======
  let wordBank = {};
  const gridSize = { easy: 8, medium: 10, hard: 12 };
  const maxHints = 3;

  fetch('/api/words')
    .then(r => r.json())
    .then(data => {
      Object.assign(wordBank, data);
      console.log('Loaded wordBank:', wordBank);
      diffBtns.forEach(b => b.disabled = false);
    })
    .catch(err => {
      console.error('Could not load word bank:', err);
      alert('Failed to load game words. Please try again later.');
    });

  // ======= STATE =======
  let currentDifficulty = null;
  let grid = [], wordsToFind = [], foundWords = new Set();
  let hintsLeft = 0, score = 0, timeLeft = 0, timerInterval = null;
  let selecting = false, selStart = null, selEnd = null;
  let leaderboardMode = 'normal'; // 'normal' or 'aggregate'

  // ======= DOM =======
  const gridEl = document.getElementById('wordGrid');
  const listEl = document.getElementById('wordList');
  const timerEl = document.getElementById('timer');
  const scoreEl = document.getElementById('score');
  const hintBtn = document.getElementById('hintBtn');
  const startBtn = document.getElementById('startBtn');
  const diffBtns = document.querySelectorAll('.difficulty-btn');
  const modal = document.getElementById('gameCompleteModal');
  const finalScore = document.getElementById('finalScore');
  const finalTime = document.getElementById('finalTime');
  const finalDiff = document.getElementById('finalDifficulty');
  const playAgain = document.getElementById('playAgainBtn');
  const shareBtn = document.getElementById('shareScoreBtn');
  const defEl = document.getElementById('wordDefinition');
  const leaderboardToggleBtn = document.getElementById('toggleLeaderboardBtn');
  const leaderboardEntries = document.getElementById('leaderboardEntries');
  const scoreHeader = document.getElementById('scoreHeader');
  const levelHeader = document.getElementById('levelHeader');

  // ======= UTILS =======
  function shuffle(a) { return a.sort(() => Math.random() - 0.5); }
  function fmt(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0'),
      s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  // ======= GRID GEN =======
  const dirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  function genGrid(size, words) {
    let g = Array(size).fill().map(() => Array(size).fill(''));
    shuffle(words).forEach(w => {
      let placed = false, tries = 0;
      while (!placed && tries++ < 100) {
        const { x: dx, y: dy } = dirs[Math.random() * dirs.length | 0],
          r = Math.random() * size | 0,
          c = Math.random() * size | 0;
        if ([...w].every((ch, i) => {
          const rr = r + dy * i, cc = c + dx * i;
          return rr >= 0 && rr < size && cc >= 0 && cc < size && (g[rr][cc] === '' || g[rr][cc] === ch);
        })) {
          [...w].forEach((ch, i) => g[r + dy * i][c + dx * i] = ch);
          placed = true;
        }
      }
    });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!g[r][c]) g[r][c] = letters[letters.length * Math.random() | 0];
    }
    return g;
  }

  // ======= RENDER =======
  function renderGrid() {
    gridEl.innerHTML = '';
    grid.forEach((row, r) => row.forEach((ch, c) => {
      const d = document.createElement('div');
      d.className = 'cell selectable';
      d.dataset.row = r; d.dataset.col = c;
      d.textContent = ch;
      gridEl.appendChild(d);
    }));
  }
  function renderList() {
    listEl.innerHTML = '';
    wordsToFind.forEach(w => {
      const d = document.createElement('div');
      d.className = 'word-item cursor-pointer p-2 bg-gray-100 rounded text-center font-semibold';
      if (foundWords.has(w)) d.classList.add('line-through', 'text-green-600');
      d.textContent = w;
      d.onclick = () => defEl.innerHTML = `<p><strong>${w}</strong>: definition of <em>${w.toLowerCase()}</em>.</p>`;
      listEl.appendChild(d);
    });
  }

  // ======= SELECTION =======
  function between(a, b) {
    const dr = b.row - a.row, dc = b.col - a.col;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return [];
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    const sr = dr ? dr / Math.abs(dr) : 0, sc = dc ? dc / Math.abs(dc) : 0;
    const out = []; let r = a.row, c = a.col;
    for (let i = 0; i <= steps; i++) {
      out.push({ row: r, col: c });
      r += sr; c += sc;
    }
    return out;
  }
  function clearSel() {
    selecting = false; selStart = selEnd = null;
    document.querySelectorAll('.cell.selected').forEach(x => x.classList.remove('selected'));
  }
  function checkMatch(str) {
    if (wordsToFind.includes(str)) return str;
    const rev = str.split('').reverse().join('');
    if (wordsToFind.includes(rev)) return rev;
    return null;
  }
  // ...existing code...

  function markFound(w) {
    foundWords.add(w);
    // Award points based on difficulty
    let points = 10;
    if (currentDifficulty === 'medium') points = 15;
    else if (currentDifficulty === 'hard') points = 20;
    score += points;
    scoreEl.textContent = score;
    renderList();

    // highlight the found word temporarily
    const size = grid.length;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        dirs.some(d => {
          if ([...w].every((ch, i) => {
            const rr = r + d.y * i, cc = c + d.x * i;
            return rr >= 0 && rr < size && cc >= 0 && cc < size && grid[rr][cc] === ch;
          })) {
            [...w].forEach((_, i) => {
              const cell = document.querySelector(`.cell[data-row="${r + d.y * i}"][data-col="${c + d.x * i}"]`);
              cell.classList.add('found');
              setTimeout(() => cell.classList.remove('found'), 1000);
            });
            return true;
          }
          return false;
        });
      }
    }

    if (foundWords.size === wordsToFind.length) finish();
  }

// ...existing code...

  // ======= EVENTS =======
  gridEl.onmousedown = e => {
    if (e.target.classList.contains('cell')) {
      selecting = true;
      selStart = { row: +e.target.dataset.row, col: +e.target.dataset.col };
      e.target.classList.add('selected');
    }
  };
  gridEl.onmousemove = e => {
    if (!selecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el?.classList.contains('cell')) return;

    selEnd = { row: +el.dataset.row, col: +el.dataset.col };
    document.querySelectorAll('.cell.selected').forEach(c => c.classList.remove('selected'));
    between(selStart, selEnd).forEach(({ row, col }) => {
      document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
        .classList.add('selected');
    });
  };

  document.onmouseup = () => {
    if (!selecting) return;
    const str = between(selStart, selEnd)
      .map(({ row, col }) => grid[row][col])
      .join('');
    const match = checkMatch(str);
    if (match && !foundWords.has(match)) markFound(match);
    clearSel();
  };
  // touch support
  gridEl.ontouchstart = e => { e.preventDefault(); gridEl.onmousedown(e.touches[0]); };
  gridEl.ontouchmove = e => { e.preventDefault(); gridEl.onmousemove(e.touches[0]); };
  document.ontouchend = e => { e.preventDefault(); document.onmouseup(); };

  // ======= HINT =======
  hintBtn.onclick = () => {
    if (hintsLeft <= 0) {
      return alert('No hints left!');
    }
    const remaining = wordsToFind.filter(w => !foundWords.has(w));
    if (remaining.length === 0) return;
    const hintWord = remaining[Math.floor(Math.random() * remaining.length)];
    const size = grid.length;
    let cellsToHighlight = [];
    outer:
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const { x: dx, y: dy } of dirs) {
          let ok = true;
          for (let i = 0; i < hintWord.length; i++) {
            const rr = r + dy * i;
            const cc = c + dx * i;
            if (
              rr < 0 || rr >= size ||
              cc < 0 || cc >= size ||
              grid[rr][cc] !== hintWord[i]
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          cellsToHighlight = [];
          for (let i = 0; i < hintWord.length; i++) {
            cellsToHighlight.push({ row: r + dy * i, col: c + dx * i });
          }
          break outer;
        }
      }
    }
    cellsToHighlight.forEach(({ row, col }) => {
      document
        .querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
        .classList.add('hint');
    });
    setTimeout(() => {
      cellsToHighlight.forEach(({ row, col }) => {
        document
          .querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
          .classList.remove('hint');
      });
    }, 1500);
    hintsLeft--;
    hintBtn.textContent = `Hint (${hintsLeft})`;
  };

  // ======= START / FINISH =======
  function submitScoreToServer() {
    if (!playerName) return console.warn("No player name!");
    fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player: playerName,
        score: score,
        level: currentDifficulty
      })
    })
      .then(res => res.json())
      .then(data => console.log("Leaderboard update:", data))
      .catch(err => console.error("Leaderboard error:", err));
  }

  function finish() {
    clearInterval(timerInterval);
    finalScore.textContent = score;
    finalTime.textContent = fmt(timeLeft);
    finalDiff.textContent = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
    modal.classList.remove('hidden');
    submitScoreToServer();
    loadLeaderboard(); // reload leaderboard after game
  }

  // ======= LEADERBOARD =======
  function renderLeaderboard(entries, mode) {
    leaderboardEntries.innerHTML = '';
    entries.forEach((entry, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-6 py-4">${i + 1}</td>
        <td class="px-6 py-4">${entry.player}</td>
        <td class="px-6 py-4 text-center">${entry.score}</td>
        <td class="px-6 py-4 text-right">${mode === 'normal' ? (entry.level ? (entry.level.charAt(0).toUpperCase() + entry.level.slice(1)) : '-') : '-'}</td>
      `;
      leaderboardEntries.appendChild(tr);
    });
    if (scoreHeader) scoreHeader.textContent = mode === 'aggregate' ? 'Total Score' : 'Score';
    if (levelHeader) levelHeader.textContent = mode === 'aggregate' ? '' : 'Level';
  }

  function loadLeaderboard() {
    fetch(`/api/leaderboard?mode=${leaderboardMode}`)
      .then(res => res.json())
      .then(data => {
        renderLeaderboard(data, leaderboardMode);
      });
  }

  if (leaderboardToggleBtn) {
    leaderboardToggleBtn.addEventListener('click', function () {
      leaderboardMode = leaderboardMode === 'normal' ? 'aggregate' : 'normal';
      this.textContent = leaderboardMode === 'normal' ? 'Show Aggregate Scores' : 'Show Game-by-Game';
      loadLeaderboard();
    });
  }

  // Initial leaderboard load
  loadLeaderboard();

  // ======= GAME START =======
  function start() {
    diffBtns.forEach(b => b.disabled = true);
    startBtn.disabled = true;
    hintsLeft = maxHints;
    hintBtn.disabled = false;
    hintBtn.textContent = `Hint (${hintsLeft})`;
    score = 0; scoreEl.textContent = 0;
    timeLeft = currentDifficulty === 'easy' ? 120 : currentDifficulty === 'medium' ? 180 : 240;
    timerEl.textContent = fmt(timeLeft);
    foundWords.clear();
    wordsToFind = [...wordBank[currentDifficulty]];
    grid = genGrid(gridSize[currentDifficulty], wordsToFind);
    gridEl.innerHTML = ''; listEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${gridSize[currentDifficulty]},1fr)`;
    renderGrid();
    renderList();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeLeft--;
      timerEl.textContent = fmt(timeLeft);
      if (timeLeft <= 0) finish();
    }, 1000);
  }

 diffBtns.forEach(btn => {
    btn.onclick = () => {
      diffBtns.forEach(b => {
        const lvl = b.dataset.level;
        b.classList.remove(
          lvl === 'easy' ? 'bg-green-500' :
            lvl === 'medium' ? 'bg-yellow-500' :
              'bg-red-500'
        );
        b.classList.add(
          lvl === 'easy' ? 'bg-green-100' :
            lvl === 'medium' ? 'bg-yellow-100' :
              'bg-red-100'
        );
      });
      const lvl = btn.dataset.level;
      btn.classList.remove(
        lvl === 'easy' ? 'bg-green-100' :
          lvl === 'medium' ? 'bg-yellow-100' :
            'bg-red-100'
      );
      btn.classList.add(
        lvl === 'easy' ? 'bg-green-500' :
          lvl === 'medium' ? 'bg-yellow-500' :
            'bg-red-500'
      );
      currentDifficulty = lvl;
      startBtn.disabled = false;
    };
  });

  startBtn.onclick = start;

  playAgain.onclick = () => {
    modal.classList.add('hidden');
    diffBtns.forEach(b => b.disabled = false);
    startBtn.disabled = false;
    location.reload();
  };

  startBtn.disabled = true;
  hintBtn.disabled = true;
});

