/* ═══════════════════════════════════════════════════════════════════════════
   📌 ASSIGNED PRACTICE — the same file in all three Math Fact Review folders. Change all three together.

   Marcos 10/19/2026: "I want to be able to assign specific assignments for the math fact reviews.
   When the student logs in, a large banner should show and should force the student to do the
   assignment. They should not be able to navigate the site without completing the task."
   He chose: assign from the Teacher Dashboard (🧮 Fact Fluency → 📌 Assign Fact Practice); a student
   finishes by getting N right (a wrong answer never counts against them); he picks Type It, Multiple
   Choice or Student's choice on each assignment.

   A LIST (Marcos 10/20: "yes, and have the new go to the end of the list or give me a choice when
   assigning"): a student can have several assignments. They do them one at a time, in order; the
   whole site opens after the last one. Mr. O adds each one to the end or the front of the list, or
   replaces the list.

   THE SHEET — the facts-assign tab, one row per assignment, for all three sites. It is written with the
   sheet's usual 'submit', so the Apps Script did not change:
     name       '<student> #<order>' — order is the ms it was assigned (end of the list) or minus that
                (front of the list); the list is sorted by it. The sheet's leaderboard read gives back
                ONE row per name, so every assignment comes back. (A row named just '<student>' is an
                assignment from before lists, 10/19; it is sorted by its score.)
     sessionId  'FA-<ms assigned>-<n>'   one per assignment, so each one is updated on its own
     form       'facts-review · Mult · 6s · Get 20 right · Type It · Stop after 40 tries'
                (site · operation · set · goal · Type It | Choice | Either · try limit), or 'None' = taken away.
                The try limit (Marcos 10/19 evening: "build the try limit for typed, multiple choice and
                student's choice") ends the assignment after that many answers even if the goal is not met,
                so a student who doesn't know the set yet is never stuck. A row without one has no limit.
     score      the ms it was written. Of two rows with the same name, the read keeps the higher score —
                so taking an assignment away = a newer 'None' row with its name. maxScore lifts the
                sheet's 99999 cap.
     correct · total · wrongQuestions · elapsed   their progress, written back by this page every
                5 answers and at the end. The sheet stores the score in Correct when Correct is 0,
                so a Correct equal to the score means 0.
     done       true once they get the goal right or reach the try limit (this page), or on a 'None' row (Mr. O)

   At sign-in the student waits for that read (up to ASSIGN_WAIT_MS). If the sheet cannot be reached,
   the list this device saw last is used; a device that saw none lets the student in. After each
   assignment the tab is read again, so one Mr. O added meanwhile comes next.
   Mr. O, a guest, Teacher Access and a share link are never assigned anything.
═══════════════════════════════════════════════════════════════════════════ */
const ASSIGN_GAME    = 'facts-assign';
const ASSIGN_CACHE   = 'facts_assign_v2';   // + ':' + name — the list this device saw last, with its progress
const ASSIGN_CACHE_V1 = 'facts_assign_v1';  // + ':' + name — one assignment, from before lists (read once, as a list of one)
const ASSIGN_WAIT_MS = 10000;
const ASSIGN_MAX_KEY = 1e15;

const ASSIGN_SITES = {
    'facts-review': { title: 'Multiplication & Division', path: 'math-fact-review',        suffix: '',        ops: { Mult: 'multiplication', Div: 'division' } },
    'facts-tens':   { title: 'Multiples of 10',           path: 'math-fact-review-tens',   suffix: ' (x10s)', ops: { Mult: 'multiplication', Div: 'division' } },
    'facts-addsub': { title: 'Addition & Subtraction',    path: 'math-fact-review-addsub', suffix: '',        ops: { Add: 'addition', Sub: 'subtraction' } }
};
const ASSIGN_OPS = {
    Mult: { word: 'Multiplication', sign: '×' },
    Div:  { word: 'Division',       sign: '÷' },
    Add:  { word: 'Addition',       sign: '+' },
    Sub:  { word: 'Subtraction',    sign: '−' }
};
const ASSIGN_STYLES = {
    'Type It': { style: 'type',   text: 'Type each answer.' },
    'Choice':  { style: 'choice', text: 'Pick from 4 answers.' },
    'Either':  { style: 'either', text: 'You pick: type each answer, or pick from 4.' }
};

let assignList = [];     // the signed-in student's assignments in order, finished ones too
let assignment = null;   // the first unfinished one (what the banner shows), or null = free to practice anything
let assignRun  = null;   // while they practice it: { baseElapsed } (seconds from earlier tries)
let assignTurn = 0;      // which sign-in a sheet read belongs to

// ── The banner screen (built here, so the three index.html files only call in) ──
(function buildAssignScreen() {
    const css = document.createElement('style');
    css.textContent = `
        .assign-banner { background: #fff8e1; border: 4px solid #f1c40f; border-radius: 20px;
            padding: 24px 24px 20px; margin: 16px 0 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); position: relative; }
        .assign-banner p { margin: 0; }
        .assign-eyebrow { font-size: 1.05rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #7a5c00; margin-bottom: 10px !important; }
        .assign-what { font-size: 2.3rem; font-weight: 800; color: #2c3e50; line-height: 1.2; margin-bottom: 8px !important; }
        .assign-goal { font-size: 1.7rem; font-weight: 800; color: #1e7d46; margin-bottom: 6px !important; }
        .assign-how, .assign-where { font-size: 1.3rem; color: #333; font-weight: 600; margin-bottom: 4px !important; }
        .assign-where { color: #a04000; }
        .assign-progress { margin: 14px auto 0; max-width: 380px; }
        .assign-bar { height: 16px; background: #eee; border-radius: 10px; overflow: hidden; }
        .assign-bar span { display: block; height: 100%; background: #2ecc71; }
        .assign-count { font-size: 1.2rem; font-weight: 700; color: #333; margin-top: 6px !important; }
        .assign-more { font-size: 1.2rem; font-weight: 700; color: #7a5c00; margin-top: 10px !important; }
        .assign-go { display: inline-block; box-sizing: border-box; width: 100%; max-width: 440px; margin-top: 18px;
            background-color: var(--success-color); font-size: 1.35rem; text-decoration: none; }
        .assign-rule { font-size: 1.15rem; color: #444; font-weight: 600; margin-top: 12px !important; }
        .assign-checking { font-size: 1.4rem; color: #444; font-weight: 700; padding: 18px 0; }
        .assign-say { cursor: pointer; margin-left: 8px; font-size: 0.75em; opacity: 0.8; user-select: none; }
        .assign-say:hover, .assign-say:focus { opacity: 1; outline: none; }
        .assign-listen { position: absolute; top: 12px; right: 14px; background: white; border: 2px solid #f1c40f;
            border-radius: 50px; padding: 6px 14px; font-size: 1rem; font-weight: 700; color: #7a5c00; cursor: pointer; font-family: inherit; }
        @media (max-width: 600px) { .assign-listen { position: static; display: block; margin: 0 auto 12px; } }
        body.assign-on #style-screen .btn-nav { display: none; }   /* no way back to the levels during an assignment */
        #practice-screen .feedback.final { height: auto; min-height: 30px; }   /* the end message may take two lines */
    `;
    document.head.appendChild(css);

    const screen = document.createElement('div');
    screen.id = 'assign-screen';
    screen.className = 'hidden';
    screen.innerHTML = `
        <div class="student-bar">
            <span>👋 Hi, <strong class="assign-name"></strong>!</span>
            <button class="btn-switch" onclick="signOut()">Not you?</button>
        </div>
        <section class="assign-banner" aria-live="polite">
            <p class="assign-checking">⏳ Getting your practice ready…</p>
            <div class="assign-body hidden">
                <button type="button" class="assign-listen" onclick="assignSayAll()">🔊 Listen</button>
                <p class="assign-eyebrow"></p>
                <p class="assign-what"></p>
                <p class="assign-goal"></p>
                <p class="assign-how"></p>
                <p class="assign-where"></p>
                <div class="assign-progress"><div class="assign-bar"><span></span></div><p class="assign-count"></p></div>
                <p class="assign-more"></p>
                <button type="button" class="btn assign-go assign-start" onclick="assignStart()"></button>
                <a class="btn assign-go assign-away" href="#"></a>
                <p class="assign-rule"></p>
            </div>
        </section>`;
    document.querySelector('.container').appendChild(screen);

    // a 🔊 reads its own line (Marcos 10/8: "speaker icons so the whole page doesn't need to be read aloud"),
    // on the banner and on the end message
    document.addEventListener('click', e => {
        const spk = e.target.closest('.assign-say');
        if (spk) assignSay(spk.parentElement.dataset.say);
    });
    document.addEventListener('keydown', e => {
        const spk = e.target.closest('.assign-say');
        if (spk && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); assignSay(spk.parentElement.dataset.say); }
    });
})();

function assignSay(text) {
    if (!text || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.82;   // a read the student asks for (the class sites' rate, Marcos 10/26)
    speechSynthesis.speak(u);
}

function assignSayAll() {
    const lines = [...document.querySelectorAll('#assign-screen .assign-body p[data-say]')]
        .filter(p => !p.classList.contains('hidden') && !p.closest('.hidden'));
    assignSay(lines.map(p => p.dataset.say).join(' '));
}

/* One line of the banner: its words, what the 🔊 says, and the 🔊 itself. */
function assignLine(el, text, say = text) {
    el.textContent = text;
    el.dataset.say = say;
    el.classList.toggle('hidden', !text);
    if (!text) return;
    const spk = document.createElement('span');
    spk.className = 'assign-say';
    spk.setAttribute('role', 'button');
    spk.setAttribute('tabindex', '0');
    spk.setAttribute('aria-label', 'Listen');
    spk.textContent = '🔊';
    el.appendChild(spk);
}

// ── Reading the assignment ──

/* One sheet row → one of this student's assignments, or null (someone else's, taken away, or unreadable —
   a row this page cannot read never locks a student out). */
function assignParse(row, student) {
    if (!row || !row.sessionId || typeof row.form !== 'string' || typeof row.name !== 'string') return null;
    const mine = row.name === student || row.name.startsWith(student + ' #');
    if (!mine) return null;
    const [site, op, set, goal, how, stopAfter] = row.form.split('·').map(p => p.trim());
    const info = ASSIGN_SITES[site];
    if (!info || !info.ops[op] || !ASSIGN_STYLES[how]) return null;
    const one   = /^(\d+)s$/.exec(set || '');
    const range = /^(?:Mixed|All) (\d+)-(\d+)$/.exec(set || '');
    const want  = /^Get (\d+) right$/.exec(goal || '');
    const limit = /^Stop after (\d+) tries$/.exec(stopAfter || '');
    if ((!one && !range) || !want || (stopAfter && !limit)) return null;
    const min = Number(one ? one[1] : range[1]);
    const max = Number(one ? one[1] : range[2]);
    if (!(min >= 1 && min <= max && max <= 12) || !(Number(want[1]) >= 1)) return null;
    if (row.name !== student && !/^-?\d+$/.test(row.name.slice(student.length + 2))) return null;
    const key   = Number(row.score) || 0;
    const right = Number(row.correct) === key ? 0 : Math.max(0, Number(row.correct) || 0);
    return {
        id: String(row.sessionId), rowName: row.name, form: row.form, key, site, op, set, min, max, how,
        order:    row.name === student ? key : Number(row.name.slice(student.length + 2)),
        goal:     Number(want[1]),
        limit:    limit ? Number(limit[1]) : 0,   // 0 = no try limit
        right,
        answered: Math.max(right, Number(row.total) || 0),
        missed:   String(row.wrongQuestions || '').split(' | ').filter(Boolean),
        elapsed:  Number(row.elapsedSeconds) || 0,
        done:     row.done === true || row.done === 'true'
    };
}

const assignStopped  = a => a.limit > 0 && a.answered >= a.limit && a.right < a.goal;   // the try limit, not the goal
const assignFinished = a => a.done || a.right >= a.goal || assignStopped(a);

/* The sheet's row and this device's copy of the same assignment: the most progress wins. */
function assignMerge(fromSheet, saved) {
    if (!fromSheet || !saved || saved.id !== fromSheet.id) return fromSheet;
    return {
        ...fromSheet,
        right:    Math.max(fromSheet.right, saved.right),
        answered: Math.max(fromSheet.answered, saved.answered),
        missed:   [...new Set([...fromSheet.missed, ...saved.missed])],
        elapsed:  Math.max(fromSheet.elapsed, saved.elapsed),
        done:     fromSheet.done || saved.done
    };
}

const assignValid = a => !!(a && typeof a.id === 'string' && typeof a.rowName === 'string' && ASSIGN_SITES[a.site]
    && ASSIGN_SITES[a.site].ops[a.op] && ASSIGN_STYLES[a.how] && a.goal >= 1 && Number.isFinite(a.limit)
    && Number.isFinite(a.order) && Number.isFinite(a.right) && Number.isFinite(a.answered) && Array.isArray(a.missed));

function assignSavedList(name) {
    try {
        const list = JSON.parse(localStorage.getItem(ASSIGN_CACHE + ':' + name) || 'null');
        if (Array.isArray(list)) return list.filter(assignValid);
        const one = JSON.parse(localStorage.getItem(ASSIGN_CACHE_V1 + ':' + name) || 'null');   // from before lists
        return one ? [{ limit: 0, ...one, rowName: name, order: one.key }].filter(assignValid) : [];
    } catch (e) { return []; }
}

function assignSaveList(name, list) {
    try {
        localStorage.setItem(ASSIGN_CACHE + ':' + name, JSON.stringify(list));
        localStorage.removeItem(ASSIGN_CACHE_V1 + ':' + name);
    } catch (e) {}
}

/* The sheet's rows → this student's list in order, each one joined with this device's copy (the most
   progress wins). At sign-in, one finished here whose done row the sheet never got is sent again (not on the
   re-read right after an assignment: its done row is still on the way). */
function assignBuild(rows, name, saved, resend = true) {
    return rows.map(r => assignParse(r, name)).filter(Boolean)
        .sort((a, b) => a.order - b.order || a.key - b.key)
        .map(fromSheet => {
            const a = assignMerge(fromSheet, saved.find(s => s.id === fromSheet.id));
            if (resend && !fromSheet.done && assignFinished(a)) assignPost({ ...a, done: true });
            return a;
        });
}

function assignSetList(list) {
    assignList = list;
    assignment = list.find(a => !assignFinished(a)) || null;
}

/* The facts-assign tab (one row per student). null = the sheet could not be reached in time. */
async function assignReadTab() {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), ASSIGN_WAIT_MS);
    try {
        const res = await fetch(`${SHEET_URL}?action=leaderboard&game=${ASSIGN_GAME}`, { cache: 'no-store', signal: stop.signal });
        const rows = await res.json();
        return Array.isArray(rows) ? rows : null;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/* Progress (not finished) or the finish back to the student's row on the sheet. */
function assignPost(a) {
    if (teacherPreview || !studentName) return;
    fetch(SHEET_URL, {
        method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action:         'submit',
            game:           ASSIGN_GAME,
            sessionId:      a.id,
            name:           a.rowName,
            form:           a.form,
            score:          a.key,
            maxScore:       ASSIGN_MAX_KEY,
            correct:        a.right,
            total:          a.answered,
            percent:        a.answered ? Math.round((a.right / a.answered) * 100) : 0,
            done:           assignFinished(a),
            elapsed:        a.elapsed,
            tabSwitches:    0,
            wrongQuestions: a.missed.join(' | ')
        })
    }).catch(() => {});
}

/* After sign-in (signIn calls this instead of opening the welcome screen). */
async function assignCheck(name) {
    const turn = ++assignTurn;
    assignment = null;
    assignRun = null;
    document.body.classList.remove('assign-on');
    if (teacherPreview || window.SHARE_MODE || name === TEACHER_NAME || !ROSTER.some(s => s.name === name)) {
        showScreen('welcome');
        return;
    }
    assignRender('checking');
    showScreen('assign');
    const rows = await assignReadTab();
    if (turn !== assignTurn || studentName !== name) return;   // signed out, or someone else signed in, meanwhile
    let list;
    if (rows === null) {
        list = assignSavedList(name);                           // the sheet is out of reach: what this device saw last
    } else {
        list = assignBuild(rows, name, assignSavedList(name));
        assignSaveList(name, list);
    }
    assignSetList(list);
    goHome();
}

/* After an assignment: read the tab again (in the background), so one Mr. O added or took away meanwhile
   counts. The one being practiced right now is never swapped out. */
async function assignSync(name) {
    const turn = assignTurn;
    const rows = await assignReadTab();
    if (rows === null || turn !== assignTurn || studentName !== name) return;
    const list = assignBuild(rows, name, assignList, false);
    assignSaveList(name, list);
    if (assignRun) { assignList = list.map(a => (a.id === assignment.id ? assignment : a)); return; }
    assignSetList(list);
    if (!assignment) document.body.classList.remove('assign-on');
    if (!screens.assign.classList.contains('hidden')) goHome();   // on the banner: show the latest
    else assignShowNext();
}

function assignReset() {
    assignTurn++;
    assignList = [];
    assignment = null;
    assignRun = null;
    document.body.classList.remove('assign-on');
    assignShowNext();
}

/* The end-of-practice button: 📌 Next Assignment while the list has more, else the site's own label. */
const ASSIGN_HOME_HTML = document.getElementById('home-btn').innerHTML;
function assignShowNext() {
    const left = assignList.filter(a => !assignFinished(a)).length;
    document.getElementById('home-btn').innerHTML = assignment
        ? `📌 Next Assignment<span class="btn-sub">You have ${left} more.</span>`
        : ASSIGN_HOME_HTML;
}

/* The banner — the only screen a student with an open assignment can reach (goHome comes here). */
function showAssignment() {
    document.body.classList.add('assign-on');
    assignRender(assignment.site === GAME_KEY ? 'here' : 'elsewhere');
    showScreen('assign');
}

function assignRender(mode) {
    const screen = document.getElementById('assign-screen');
    const $ = sel => screen.querySelector(sel);
    $('.assign-name').textContent = document.getElementById('student-name-display').textContent;
    $('.assign-checking').classList.toggle('hidden', mode !== 'checking');
    $('.assign-body').classList.toggle('hidden', mode === 'checking');
    if (mode === 'checking') return;

    const a = assignment, info = ASSIGN_SITES[a.site], op = ASSIGN_OPS[a.op];
    const setSay = a.min === a.max ? `number ${a.min}` : a.set.replace('-', ' to ');
    const here = mode === 'here';
    assignLine($('.assign-eyebrow'), '📌 Your assignment from Mr. O', 'Your assignment from Mister O.');
    assignLine($('.assign-what'), `${op.sign} ${op.word}: ${a.set}${info.suffix}`, `${op.word}. ${setSay}.`);
    assignLine($('.assign-goal'), `Get ${a.goal} right.`);
    assignLine($('.assign-how'), ASSIGN_STYLES[a.how].text);
    assignLine($('.assign-where'), here ? '' : `This assignment is on the ${info.title} site.`);
    const pct = Math.min(100, Math.round((a.right / a.goal) * 100));
    $('.assign-progress').classList.toggle('hidden', a.right === 0);
    $('.assign-bar span').style.width = pct + '%';
    assignLine($('.assign-count'), a.right ? `You have ${a.right} of ${a.goal} right so far.` : '');
    const more = assignList.filter(x => !assignFinished(x)).length - 1;
    assignLine($('.assign-more'), more > 0 ? `After this one, you have ${more} more.` : '');
    $('.assign-start').classList.toggle('hidden', !here);
    $('.assign-start').innerHTML = `${a.right ? '▶️ Keep Going' : '▶️ Start My Assignment'}<span class="btn-sub">Get ${a.goal} right to finish.</span>`;
    const away = $('.assign-away');
    away.classList.toggle('hidden', here);
    away.href = `../${info.path}/`;
    away.innerHTML = `➡️ Go to ${info.title}<span class="btn-sub">You stay signed in.</span>`;
    assignLine($('.assign-rule'), 'Finish this assignment first. Then you can practice anything you want.');
}

// ── Doing the assignment ──

/* ▶️ Start My Assignment: the site's own steps, with Mr. O's choices already made. */
function assignStart() {
    const a = assignment;
    if (!a || a.site !== GAME_KEY) return;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    assignRun = { baseElapsed: a.elapsed };
    initSelection(ASSIGN_SITES[a.site].ops[a.op]);   // also turns the 3-minute timer off
    pickSet(a.min, a.max);
    const style = ASSIGN_STYLES[a.how].style;
    if (style !== 'either') chooseAnswerStyle(style);   // 'either': the student picks (no Back to Levels)
}

/* startPractice calls this last: no Finish button, and the count where the timer goes. */
function assignPracticeStarted() {
    if (!assignRun) return;
    ui.finishBtn.classList.add('hidden');
    ui.practiceTitle.innerText = '📌 ' + ui.practiceTitle.innerText;
    assignShowCount();
}

function assignShowCount() {
    ui.timerDisplay.innerText = `📌 ${assignment.right} / ${assignment.goal} right`;
    ui.timerDisplay.style.color = '#2c3e50';
}

/* checkAnswer calls this after the score moves. A wrong answer is listed, never taken away. */
function assignRecordAnswer(isCorrect, typed) {
    if (!assignRun) return;
    const miss = `${state.problemText} (${typed})`;
    assignment = {
        ...assignment,
        right:    assignment.right + (isCorrect ? 1 : 0),
        answered: assignment.answered + 1,
        missed:   isCorrect || assignment.missed.includes(miss) ? assignment.missed : [...assignment.missed, miss],
        elapsed:  assignRun.baseElapsed + factsActiveSeconds()
    };
    assignList = assignList.map(a => (a.id === assignment.id ? assignment : a));
    assignSaveList(studentName, assignList);
    assignShowCount();
    if (assignFinished(assignment)) return;   // assignFinish sends the done row
    if (assignment.answered % PARTIAL_EVERY === 0) assignPost(assignment);
}

const assignGoalMet = () => !!(assignRun && assignment && assignFinished(assignment));

/* The goal is met, or the try limit is reached: save it as done and say which. The next one on the list
   comes next (📌 Next Assignment); after the last one the whole site opens again. */
function assignFinish() {
    const done = { ...assignment, done: true, elapsed: assignRun.baseElapsed + factsActiveSeconds() };
    const stopped = assignStopped(done);
    const list = assignList.map(a => (a.id === done.id ? done : a));
    assignSaveList(studentName, list);
    assignPost(done);
    assignRun = null;
    assignSetList(list);
    if (!assignment) document.body.classList.remove('assign-on');
    endSession();
    assignShowNext();
    assignSync(studentName);
    assignLine(ui.feedback, stopped
        ? `👍 You practiced ${done.answered} problems. Mr. O will help you with the rest.`
        : `🎉 Assignment done! You got ${done.goal} right.`);
}

// Closing the tab mid-assignment keeps what they did (this device has it already; this is the sheet).
window.addEventListener('pagehide', () => {
    if (assignRun && assignment) assignPost({ ...assignment, elapsed: assignRun.baseElapsed + factsActiveSeconds() });
});
