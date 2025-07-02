// static/js/game.js

document.addEventListener('DOMContentLoaded', () => {
  // ======= CONFIG =======
  let wordBank = {
  };
  const gridSize = { easy:8, medium:10, hard:12 };
  const maxHints = 3;
  
 fetch('/api/words')
    .then(r => r.json())
    .then(data => {
      // populate our wordBank in place
      Object.assign(wordBank, data);
      console.log('Loaded wordBank:', wordBank);
      // now allow the user to pick a level & start
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

  // ======= DOM =======
  const gridEl      = document.getElementById('wordGrid');
  const listEl      = document.getElementById('wordList');
  const timerEl     = document.getElementById('timer');
  const scoreEl     = document.getElementById('score');
  const hintBtn     = document.getElementById('hintBtn');
  const startBtn    = document.getElementById('startBtn');
  const diffBtns    = document.querySelectorAll('.difficulty-btn');
  const modal       = document.getElementById('gameCompleteModal');
  const finalScore  = document.getElementById('finalScore');
  const finalTime   = document.getElementById('finalTime');
  const finalDiff   = document.getElementById('finalDifficulty');
  const playAgain   = document.getElementById('playAgainBtn');
  const shareBtn    = document.getElementById('shareScoreBtn');
  const defEl       = document.getElementById('wordDefinition');

  console.log({
  hintBtn,
  startBtn,
  gridEl,
  listEl,
  timerEl,
  scoreEl
});

  // ======= UTILS =======
  function shuffle(a){ return a.sort(()=>Math.random()-0.5); }
  function fmt(sec){
    const m = String(Math.floor(sec/60)).padStart(2,'0'),
          s = String(sec%60).padStart(2,'0');
    return `${m}:${s}`;
  }

  // ======= GRID GEN =======
  const dirs = [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:-1,y:1}];
  function genGrid(size, words){
    let g = Array(size).fill().map(()=>Array(size).fill(''));
    shuffle(words).forEach(w=>{
      let placed=false, tries=0;
      while(!placed && tries++<100){
        const {x:dx,y:dy} = dirs[Math.random()*dirs.length|0],
              r = Math.random()*size|0,
              c = Math.random()*size|0;
        if([...w].every((ch,i)=>{
          const rr=r+dy*i, cc=c+dx*i;
          return rr>=0&&rr<size&&cc>=0&&cc<size&&(g[rr][cc]===''||g[rr][cc]===ch);
        })){
          [...w].forEach((ch,i)=>g[r+dy*i][c+dx*i]=ch);
          placed=true;
        }
      }
    });
    const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for(let r=0;r<size;r++)for(let c=0;c<size;c++){
      if(!g[r][c]) g[r][c] = letters[letters.length*Math.random()|0];
    }
    return g;
  }

  // ======= RENDER =======
  function renderGrid(){
    gridEl.innerHTML='';
    grid.forEach((row,r)=>row.forEach((ch,c)=>{
      const d = document.createElement('div');
      d.className='cell selectable';
      d.dataset.row=r; d.dataset.col=c;
      d.textContent=ch;
      gridEl.appendChild(d);
    }));
  }
  function renderList(){
    listEl.innerHTML='';
    wordsToFind.forEach(w=>{
      const d = document.createElement('div');
      d.className='word-item cursor-pointer p-2 bg-gray-100 rounded text-center font-semibold';
      if(foundWords.has(w)) d.classList.add('line-through','text-green-600');
      d.textContent=w;
      d.onclick = ()=> defEl.innerHTML = `<p><strong>${w}</strong>: definition of <em>${w.toLowerCase()}</em>.</p>`;
      listEl.appendChild(d);
    });
  }

  // ======= SELECTION =======
  function between(a,b){
    const dr = b.row - a.row, dc = b.col - a.col;
    if(dr!==0&&dc!==0 && Math.abs(dr)!==Math.abs(dc)) return [];
    const steps = Math.max(Math.abs(dr),Math.abs(dc));
    const sr = dr?dr/Math.abs(dr):0, sc = dc?dc/Math.abs(dc):0;
    const out=[]; let r=a.row,c=a.col;
    for(let i=0;i<=steps;i++){
      out.push({row:r,col:c});
      r+=sr; c+=sc;
    }
    return out;
  }
  function clearSel(){
    selecting=false; selStart=selEnd=null;
    document.querySelectorAll('.cell.selected').forEach(x=>x.classList.remove('selected'));
  }
  function checkMatch(str){
    if(wordsToFind.includes(str)) return str;
    const rev=str.split('').reverse().join('');
    if(wordsToFind.includes(rev)) return rev;
    return null;
  }
  function markFound(w){
  foundWords.add(w);
  score += 10;
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

            // Remove visual highlight after 1s to allow reuse
            setTimeout(() => cell.classList.remove('found'), 1000);
          });
          return true;
        }
        return false;
      });
    }
  }

  // If all words found
  if (foundWords.size === wordsToFind.length) finish();
}


  // ======= EVENTS =======
  gridEl.onmousedown = e=>{
    if(e.target.classList.contains('cell')){
      selecting=true;
      selStart={row:+e.target.dataset.row,col:+e.target.dataset.col};
      e.target.classList.add('selected');
    }
  };
  gridEl.onmousemove = e => {
  if (!selecting) return;
  const el = document.elementFromPoint(e.clientX,e.clientY);
  if (!el?.classList.contains('cell')) return;

  selEnd = { row:+el.dataset.row, col:+el.dataset.col };
  // clear any old
  document.querySelectorAll('.cell.selected').forEach(c => c.classList.remove('selected'));
  // highlight only the between(selStart,selEnd) cells
  between(selStart, selEnd).forEach(({row,col}) => {
    document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
            .classList.add('selected');
  });
};

  document.onmouseup = ()=>{
    if (!selecting) return;
    const str = between(selStart,selEnd)
                   .map(({row,col})=>grid[row][col])
                   .join('');
    const match = checkMatch(str);
    if(match && !foundWords.has(match)) markFound(match);
    clearSel();
  };
  // touch support
  gridEl.ontouchstart = e=>{ e.preventDefault(); gridEl.onmousedown(e.touches[0]); };
  gridEl.ontouchmove  = e=>{ e.preventDefault(); gridEl.onmousemove(e.touches[0]); };
  document.ontouchend  = e=>{ e.preventDefault(); document.onmouseup(); };

  // ======= HINT =======
 hintBtn.onclick = () => {
  if (hintsLeft <= 0) {
    return alert('No hints left!');
  }

  // 1) all words not yet found
  const remaining = wordsToFind.filter(w => !foundWords.has(w));
  if (remaining.length === 0) return;

  // 2) pick one at random
  const hintWord = remaining[Math.floor(Math.random() * remaining.length)];

  // 3) find its placement
  const size = grid.length;
  let cellsToHighlight = [];
  outer:
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const { x: dx, y: dy } of dirs) {
        // can it fit here?
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

        // record the exact cells
        cellsToHighlight = [];
        for (let i = 0; i < hintWord.length; i++) {
          cellsToHighlight.push({ row: r + dy * i, col: c + dx * i });
        }
        break outer;
      }
    }
  }

  // 4) highlight them
  cellsToHighlight.forEach(({ row, col }) => {
    document
      .querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
      .classList.add('hint');
  });

  // remove highlight after 1.5s
  setTimeout(() => {
    cellsToHighlight.forEach(({ row, col }) => {
      document
        .querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)
        .classList.remove('hint');
    });
  }, 1500);

  // 5) update hints left
  hintsLeft--;
  hintBtn.textContent = `Hint (${hintsLeft})`;
};


  // ======= START / FINISH =======
// … your other code …

function submitScoreToServer() {
  // playerName is now set by the inline script in dashboard.html
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

// Call submitScoreToServer() at the end of your `finish()` or wherever you want
function finish() {
  clearInterval(timerInterval);
  finalScore.textContent = score;
  finalTime.textContent  = fmt(timeLeft);
  finalDiff.textContent  = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
  modal.classList.remove('hidden');

  // push to leaderboard
  submitScoreToServer();
}

let leaderboardOffset = 0;
const leaderboardLimit = 10;

function loadLeaderboard(){
  fetch(`/api/leaderboard?limit=${leaderboardLimit}&offset=${leaderboardOffset}`)
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('leaderboardEntries');
      data.forEach(entry => {
        const row = document.createElement('div');
        row.className = "grid grid-cols-4 p-4";
        row.innerHTML = `
          <div>${entry.rank}</div>
          <div>${entry.player}</div>
          <div class="text-center">${entry.score}</div>
          <div class="text-right">${entry.level.charAt(0).toUpperCase() + entry.level.slice(1)}</div>
        `;
        container.appendChild(row);
      });
      leaderboardOffset += leaderboardLimit;
    });
}

document.getElementById('loadMoreBtn').addEventListener('click', loadLeaderboard);


  function start(){
    // freeze difficulty
    diffBtns.forEach(b=>b.disabled=true);
    startBtn.disabled=true;

    // initialize state
    hintsLeft = maxHints;
    hintBtn.disabled=false;
    hintBtn.textContent = `Hint (${hintsLeft})`;

    score=0; scoreEl.textContent=0;
    timeLeft = currentDifficulty==='easy'?120:currentDifficulty==='medium'?180:240;
    timerEl.textContent = fmt(timeLeft);

    foundWords.clear();
    wordsToFind = [...wordBank[currentDifficulty]];
    grid = genGrid(gridSize[currentDifficulty], wordsToFind);

    // render
    gridEl.innerHTML=''; listEl.innerHTML='';
    gridEl.style.gridTemplateColumns = `repeat(${gridSize[currentDifficulty]},1fr)`;
    renderGrid();
    renderList();

    clearInterval(timerInterval);
    timerInterval = setInterval(()=>{
      timeLeft--;
      timerEl.textContent = fmt(timeLeft);
      if(timeLeft<=0) finish();
    }, 1000);
  }

  // hook up difficulty buttons
  // diffBtns.forEach(btn=>{
  //   btn.onclick = ()=>{
  //     // highlight selected
  //     diffBtns.forEach(b=>b.classList.toggle('bg-opacity-100', b===btn));
  //     currentDifficulty = btn.dataset.level;
  //     startBtn.disabled = false;
  //   };
  // });
  // hook up difficulty buttons so only the clicked one is green-500
// hook up difficulty buttons so each returns to its 100 shade and only the clicked one goes to its 500 shade
diffBtns.forEach(btn => {
  btn.onclick = () => {
    // reset *all* buttons to their light (100) shade
    diffBtns.forEach(b => {
      const lvl = b.dataset.level;
      b.classList.remove(
        lvl === 'easy'   ? 'bg-green-500' :
        lvl === 'medium' ? 'bg-yellow-500' :
                           'bg-red-500'
      );
      b.classList.add(
        lvl === 'easy'   ? 'bg-green-100' :
        lvl === 'medium' ? 'bg-yellow-100' :
                           'bg-red-100'
      );
    });

    // now highlight the clicked one in its 500 shade
    const lvl = btn.dataset.level;
    btn.classList.remove(
      lvl === 'easy'   ? 'bg-green-100' :
      lvl === 'medium' ? 'bg-yellow-100' :
                         'bg-red-100'
    );
    btn.classList.add(
      lvl === 'easy'   ? 'bg-green-500' :
      lvl === 'medium' ? 'bg-yellow-500' :
                         'bg-red-500'
    );

    currentDifficulty = lvl;
    startBtn.disabled = false;
  };
});



  // start button
  startBtn.onclick = start;

playAgain.onclick = () => {
  // Optional: Hide the modal and re-enable buttons (can be skipped if reloading anyway)
  modal.classList.add('hidden');
  diffBtns.forEach(b => b.disabled = false);
  startBtn.disabled = false;

  // Reload the page
  location.reload();
};


  

  // initially disable Start & Hint until level chosen
  startBtn.disabled = true;
  hintBtn.disabled  = true;
});

document.getElementById('cancelBtn').addEventListener('click', () => {
  // simply hide the modal
  document.getElementById('gameCompleteModal').classList.add('hidden');
});
