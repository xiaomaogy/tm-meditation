const WAVE = `<svg class="fill-wave" viewBox="0 0 400 50" preserveAspectRatio="none">
<path d="M0,0 L0,15 Q200,50 400,15 L400,0 Z"/>
</svg>`;

const App = {
    state: 'idle',
    secs: 20 * 60,
    mins: 20,
    timer: null,
    sessions: JSON.parse(localStorage.getItem('tm_sessions') || '[]'),
    month: new Date(),

    init() {
        this.renderIdle();
        this.renderStats();
        this.bindTabs();
    },

    save() { localStorage.setItem('tm_sessions', JSON.stringify(this.sessions)); },

    addSession(dur) {
        this.sessions.push({ id: crypto.randomUUID(), date: new Date().toISOString(), duration: dur });
        this.save();
        this.renderStats();
    },

    // ====== TIMER ======
    renderIdle() {
        document.getElementById('timer-tab').innerHTML = `
            <div class="timer-page">
                <div class="fill-wrap" id="fill">${WAVE}<div class="fill-solid"></div></div>
                <div class="idle-ui" id="idle">
                    <div class="top-row">
                        <div class="count-wrap"><div class="count-bar"></div><div><div class="count-num">850</div><div class="count-lbl">meditating now</div></div></div>
                        <button class="gear-btn" id="gear">⚙</button>
                    </div>
                    <div class="mid-row">
                        <div><div class="dur-type">TM</div><div class="dur-num" id="dur-btn">${this.mins} mins</div></div>
                        <div class="toggle" id="track"><div class="thumb" id="thumb"></div></div>
                    </div>
                </div>
                <div class="tap-zone" id="tap"></div>
            </div>
            <div class="picker-bg" id="picker"><div class="picker-sheet" style="position:relative">
                <h3>Duration (minutes)</h3>
                <button class="picker-done" id="picker-done">Done</button>
                <div class="scroll-wrap">
                    <div class="scroll-mask-top"></div>
                    <div class="scroll-mask-bot"></div>
                    <div class="scroll-highlight"></div>
                    <div class="scroll-list" id="scroll-list">
                        <div style="height:80px"></div>
                        ${Array.from({length:60},(_,i)=>`<div class="scroll-item" data-v="${i+1}">${i+1} min</div>`).join('')}
                        <div style="height:80px"></div>
                    </div>
                </div>
            </div></div>
            <div class="settings-bg" id="stg"><div class="settings-sheet"><h3>Settings</h3>
                <div class="s-row"><label>Sessions</label><span class="s-val">${this.sessions.length}</span></div>
                <div class="s-row"><label>Minutes</label><span class="s-val">${this.totalMins()}</span></div>
                <div class="s-row"><label>Streak</label><span class="s-val">${this.streak()} days</span></div>
                <button class="clr-btn" id="clr">Clear All Data</button>
            </div></div>`;
        this.bindTimer();
    },

    renderRunning() {
        // Replace timer-tab content with ONLY the fill — nothing else
        document.getElementById('timer-tab').innerHTML = `
            <div class="timer-page">
                <div class="fill-wrap" id="fill"><div class="fill-solid"></div>${WAVE}</div>
                <div class="tap-zone" id="tap" style="display:block"></div>
            </div>`;
        document.getElementById('tab-bar').style.display = 'none';
        document.getElementById('tap').onclick = () => this.stop();
    },

    bindTimer() {
        const thumb = document.getElementById('thumb');
        const track = document.getElementById('track');
        let dragY = 0, dragging = false;

        const onStart = y => { if (this.state === 'idle') { dragging = true; dragY = y; } };
        const onMove = y => { if (dragging && y - dragY > 40) { dragging = false; this.start(); } };
        const onEnd = () => { dragging = false; };

        thumb.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
        document.addEventListener('touchmove', e => onMove(e.touches[0].clientY));
        document.addEventListener('touchend', onEnd);
        thumb.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientY); });
        document.addEventListener('mousemove', e => onMove(e.clientY));
        document.addEventListener('mouseup', onEnd);

        track.onclick = () => { if (this.state === 'idle') this.start(); };

        document.getElementById('dur-btn').onclick = () => {
            const picker = document.getElementById('picker');
            picker.classList.add('open');
            const list = document.getElementById('scroll-list');
            // Scroll to current selection (each item is 40px, need to center it)
            list.scrollTop = (this.mins - 1) * 40 - 80;
            this.updateScrollHighlight();
            list.addEventListener('scroll', () => this.updateScrollHighlight());
        };
        document.getElementById('picker-done').onclick = () => {
            const list = document.getElementById('scroll-list');
            const idx = Math.round((list.scrollTop + 80) / 40);
            this.mins = Math.max(1, Math.min(60, idx + 1));
            this.secs = this.mins * 60;
            document.getElementById('picker').classList.remove('open');
            this.renderIdle();
        };
        document.getElementById('picker').onclick = e => {
            if (e.target.id === 'picker') e.target.classList.remove('open');
        };
        document.getElementById('gear').onclick = () => document.getElementById('stg').classList.add('open');
        document.getElementById('stg').onclick = e => { if (e.target.id === 'stg') e.target.classList.remove('open'); };
        document.getElementById('clr').onclick = () => {
            if (confirm('Clear all meditation data?')) { this.sessions = []; this.save(); this.renderIdle(); this.renderStats(); }
        };
    },

    updateScrollHighlight() {
        const list = document.getElementById('scroll-list');
        if (!list) return;
        const center = list.scrollTop + 100; // 100 = half of 200px wrap height
        list.querySelectorAll('.scroll-item').forEach(el => {
            const itemCenter = el.offsetTop + 20;
            el.classList.toggle('active', Math.abs(itemCenter - center) < 20);
        });
    },

    start() {
        this.state = 'running';
        this.secs = this.mins * 60;
        this.playChime();
        this.renderRunning();
        this.updateFill();
        this.timer = setInterval(() => this.tick(), 1000);
    },

    stop() {
        clearInterval(this.timer);
        this.state = 'idle';
        this.secs = this.mins * 60;
        document.getElementById('tab-bar').style.display = '';
        this.renderIdle();
    },

    tick() {
        if (this.secs > 0) {
            this.secs--;
            this.updateFill();
        } else {
            clearInterval(this.timer);
            this.state = 'finished';
            this.playChime();
            this.addSession(this.mins * 60);

            const fill = document.getElementById('fill');
            fill.style.height = '100%';
            const wave = fill.querySelector('.fill-wave');
            if (wave) wave.style.display = 'none';

            setTimeout(() => {
                this.state = 'idle';
                this.secs = this.mins * 60;
                document.getElementById('tab-bar').style.display = '';
                this.renderIdle();
            }, 4000);
        }
    },

    updateFill() {
        const fill = document.getElementById('fill');
        if (!fill) return;
        const pct = 1 - (this.secs / (this.mins * 60));
        fill.style.height = `${Math.min(pct * 100, 100)}%`;
    },

    playChime() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine'; o.frequency.setValueAtTime(528, ctx.currentTime);
            g.gain.setValueAtTime(0.3, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);
            o.start(); o.stop(ctx.currentTime + 2.5);
        } catch(e) {}
    },

    // ====== STATS ======
    renderStats() {
        document.getElementById('stats-tab').innerHTML = `
            <div class="cards">
                <div class="card"><div class="card-v g">${this.streak()}</div><div class="card-l">Day Streak</div></div>
                <div class="card"><div class="card-v b">${this.sessions.length}</div><div class="card-l">Sessions</div></div>
                <div class="card"><div class="card-v gr">${this.totalMins()}</div><div class="card-l">Minutes</div></div>
            </div>
            <div class="cal-sec">
                <div class="cal-hd"><button class="cal-nav" id="cp">‹</button><h3>${this.mthStr()}</h3><button class="cal-nav" id="cn">›</button></div>
                <div class="cal-wk"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                <div class="cal-days">${this.calDays()}</div>
            </div>
            <div class="sl"><h3>Recent Sessions</h3>${this.sesList()}</div>`;
        const cp = document.getElementById('cp'), cn = document.getElementById('cn');
        if (cp) cp.onclick = () => { this.month = new Date(this.month.getFullYear(), this.month.getMonth()-1); this.renderStats(); };
        if (cn) cn.onclick = () => { this.month = new Date(this.month.getFullYear(), this.month.getMonth()+1); this.renderStats(); };
    },

    calDays() {
        const y = this.month.getFullYear(), m = this.month.getMonth();
        const f = new Date(y,m,1).getDay(), n = new Date(y,m+1,0).getDate(), tk = this.dk(new Date());
        const sd = new Set(this.sessions.filter(s=>{const d=new Date(s.date);return d.getFullYear()===y&&d.getMonth()===m;}).map(s=>this.dk(new Date(s.date))));
        let h='';
        for(let i=0;i<f;i++) h+='<div class="cd"></div>';
        for(let d=1;d<=n;d++){const k=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const c=['cd'];if(sd.has(k))c.push('hs');if(k===tk)c.push('td');h+=`<div class="${c.join(' ')}">${d}</div>`;}
        return h;
    },

    sesList() {
        if(!this.sessions.length) return '<div class="empty">No sessions yet. Start meditating!</div>';
        return this.sessions.slice(-10).reverse().map(s=>{const d=new Date(s.date);return `<div class="si"><div><div class="si-d">${d.toLocaleDateString()}</div><div class="si-t">${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div></div><div class="si-dur">${Math.round(s.duration/60)} min</div></div>`;}).join('');
    },

    dk(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;},
    mthStr(){return this.month.toLocaleDateString('en',{month:'long',year:'numeric'});},

    streak() {
        const days=[...new Set(this.sessions.map(s=>this.dk(new Date(s.date))))].sort().reverse();
        if(!days.length)return 0;
        const t=this.dk(new Date()),y=this.dk(new Date(Date.now()-864e5));
        let s=0,c=new Date();
        if(days[0]!==t){if(days[0]!==y)return 0;c=new Date(Date.now()-864e5);}
        while(days.includes(this.dk(c))){s++;c=new Date(c.getTime()-864e5);}
        return s;
    },

    totalMins(){return Math.round(this.sessions.reduce((a,s)=>a+s.duration,0)/60);},

    bindTabs() {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
                b.classList.add('active');
                document.getElementById(`${b.dataset.tab}-tab`).classList.add('active');
            };
        });
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
