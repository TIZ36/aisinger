// aisinger frontend — talks to FastAPI REST + SSE.
(() => {
  const api = (path, opts) => fetch(path, opts).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b)));
  const apiForm = (path, formData) => fetch(path, { method: 'POST', body: formData }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b)));
  const errMsg = (e) => e?.detail || e?.msg || e?.message || (typeof e === 'string' ? e : JSON.stringify(e));

  function showErr(container, title, detail) {
    if (!container) { console.error(title, detail); return; }
    let box = container.querySelector('.errbox');
    if (!box) { box = document.createElement('div'); box.className = 'errbox'; container.appendChild(box); }
    box.classList.remove('ok');
    box.innerHTML = `<div class="ic">!</div><div class="msg"><b>${escapeHtml(title)}</b>${escapeHtml(detail || '')}</div><div class="x" onclick="this.parentElement.remove()">×</div>`;
  }
  function showOk(container, title, detail) {
    if (!container) return;
    let box = container.querySelector('.errbox');
    if (!box) { box = document.createElement('div'); box.className = 'errbox'; container.appendChild(box); }
    box.classList.add('ok');
    box.innerHTML = `<div class="ic">✓</div><div class="msg"><b>${escapeHtml(title)}</b>${escapeHtml(detail || '')}</div><div class="x" onclick="this.parentElement.remove()">×</div>`;
  }
  function clearErr(container) { container && container.querySelectorAll('.errbox').forEach(b => b.remove()); }

  // ============= STATE =============
  const state = {
    voices: [],
    tracks: [],
    songs: [],
    runningJob: null,   // {job_id, voice_id, stage, pct}
    synth: { voice: null, target: null, params: { pitch: 0, indexRate: 0.75, f0: 'rmvpe' } },
  };

  // ============= ROUTING =============
  function nav(target) {
    document.querySelectorAll('.view').forEach(v => v.style.display = v.dataset.view === target ? '' : 'none');
    document.querySelectorAll('.sb .nav').forEach(el => el.classList.toggle('on', el.dataset.nav === target));
    renderTopbar(target);
    if (target === 'voices') renderVoices();
    if (target === 'tracks') renderTracks();
    if (target === 'songs') renderSongs();
    if (target === 'synth') { renderRecent(); fillWaveform('pv_wave', 60, 0.0); updateSynthPreview(); }
    if (target === 'new') { wireNewVoiceFileInputs(); applyTierUI(newVoice.tier); updateNewVoiceSummary(); }
    document.querySelector('.main').scrollTop = 0;
  }
  window.nav = nav;
  document.querySelectorAll('.sb .nav').forEach(el => el.addEventListener('click', () => nav(el.dataset.nav)));

  function renderTopbar(view) {
    const t = document.getElementById('topbar');
    const right = `<div class="spacer"></div><button class="topbar-btn">⌘K</button>`;
    if (view === 'synth') t.innerHTML = `<div class="crumb"><b>合成</b></div>${right}`;
    else if (view === 'voices') t.innerHTML = `<div class="crumb"><b>音色库</b><span class="sep">·</span><span>${state.voices.length}</span></div>${right}<button class="topbar-primary" onclick="nav('new')">＋ 新建音色</button>`;
    else if (view === 'tracks') t.innerHTML = `<div class="crumb"><b>曲目库</b><span class="sep">·</span><span>${state.tracks.length}</span></div>${right}<button class="topbar-primary" onclick="openNewTrack()">＋ 上传曲目</button>`;
    else if (view === 'songs') t.innerHTML = `<div class="crumb"><b>AI 歌曲库</b><span class="sep">·</span><span>${state.songs.length}</span></div>${right}<button class="topbar-primary" onclick="nav('synth')">＋ 去合成</button>`;
    else if (view === 'new') t.innerHTML = `<div class="crumb"><span style="cursor:pointer" onclick="nav('voices')">音色库</span><span class="sep">/</span><b>新建音色</b></div>${right}`;
  }

  // ============= DATA load =============
  function avatarColor(seed) {
    // simple deterministic gradient based on seed
    const hues = [
      'linear-gradient(135deg,#5e6ad2,#8b95ff)',
      'linear-gradient(135deg,#6b73a8,#8d95c2)',
      'linear-gradient(135deg,#5a6080,#7a80a0)',
      'linear-gradient(135deg,#727888,#525868)',
      'linear-gradient(135deg,#a8a070,#b89580)',
      'linear-gradient(135deg,#7a8398,#9aa2b4)',
    ];
    let h = 0; for (const c of (seed || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return hues[h % hues.length];
  }
  function voiceAv(v) { return { color: avatarColor(v.id), letter: (v.name || '?').slice(0, 1).toUpperCase() }; }

  async function loadAll() {
    const [voices, tracks, songs, jobs] = await Promise.all([
      api('/api/voices'), api('/api/tracks'), api('/api/songs'), api('/api/jobs'),
    ]);
    state.voices = voices;
    state.tracks = tracks;
    state.songs = songs;
    // adopt any running training job
    const rj = jobs.find(j => j.kind === 'train' && j.status === 'running');
    if (rj) attachJob(rj.id, rj.meta && rj.meta.voice_id);
    refreshCurrentView();
  }

  function refreshCurrentView() {
    const cur = document.querySelector('.view[style=""]') || document.querySelector('.view:not([style*="none"])');
    const v = cur ? cur.dataset.view : 'synth';
    nav(v);
  }

  // ============= SYNTH =============
  const V = id => state.voices.find(v => v.id === id);
  const T = id => state.tracks.find(t => t.id === id);

  function updateSynthRow() {
    const vr = document.getElementById('row_voice');
    const tr = document.getElementById('row_target');
    if (state.synth.voice) {
      const v = V(state.synth.voice);
      vr.classList.remove('placeholder');
      const ic = document.getElementById('ic_voice');
      const a = voiceAv(v); ic.style.background = a.color; ic.style.border = '0'; ic.textContent = a.letter;
      document.getElementById('nm_voice').textContent = v.name;
      const sb = document.getElementById('sub_voice'); sb.textContent = v.tier || v.sub || ''; sb.style.display = '';
    } else {
      vr.classList.add('placeholder');
      const ic = document.getElementById('ic_voice'); ic.style.background = ''; ic.style.border = ''; ic.textContent = '+';
      document.getElementById('nm_voice').textContent = '选择音色';
      document.getElementById('sub_voice').style.display = 'none';
    }
    if (state.synth.voice && state.synth.target) {
      const v = V(state.synth.voice);
      tr.classList.remove('placeholder');
      const ic = document.getElementById('ic_target');
      ic.style.background = 'var(--bg-2)'; ic.style.border = '1px solid var(--line)'; ic.style.color = 'var(--fg-2)';
      ic.textContent = '♪';
      if (v.tier === 'simple' || v.tier === 'pro') {
        document.getElementById('lbl_target').textContent = 'WORDS · 文本';
        document.getElementById('nm_target').textContent = state.synth.target.length > 30 ? state.synth.target.slice(0, 30) + '…' : state.synth.target;
        const sb = document.getElementById('sub_target'); sb.textContent = '自由文本'; sb.style.display = '';
      } else {
        const t = T(state.synth.target);
        document.getElementById('lbl_target').textContent = 'SOURCE · 曲目';
        document.getElementById('nm_target').textContent = t.name;
        const sb = document.getElementById('sub_target'); sb.textContent = `${t.artist || ''} · ${fmtDuration(t.duration)}`; sb.style.display = '';
      }
    } else {
      tr.classList.add('placeholder');
      const v = state.synth.voice ? V(state.synth.voice) : null;
      const isText = v && (v.tier === 'simple' || v.tier === 'pro');
      const ic = document.getElementById('ic_target'); ic.style.background = ''; ic.style.border = ''; ic.textContent = '+';
      document.getElementById('lbl_target').textContent = isText ? 'WORDS · 文本' : 'SOURCE · 曲目';
      document.getElementById('nm_target').textContent = isText ? '输入或选择文本' : '选择曲目';
      document.getElementById('sub_target').style.display = 'none';
    }
    const ok = state.synth.voice && state.synth.target;
    const cta = document.getElementById('cta');
    cta.disabled = !ok; cta.classList.toggle('disabled', !ok);
    document.getElementById('cta_hint').textContent = ok ? '预计 8 秒生成' : '先选音色和曲目';
  }
  function updateSynthPreview() {
    const v = state.synth.voice ? V(state.synth.voice) : null;
    const t = state.synth.voice && state.synth.target ? (V(state.synth.voice).tier === 'mid' ? T(state.synth.target) : null) : null;
    const va = document.getElementById('pv_voice_av');
    if (v) { const a = voiceAv(v); va.style.background = a.color; va.style.border = '0'; va.style.color = 'white'; va.style.fontWeight = '600'; va.textContent = a.letter; }
    else { va.style.background = 'var(--bg-2)'; va.style.border = '1px solid var(--line)'; va.style.color = 'var(--fg-3)'; va.style.fontWeight = '400'; va.textContent = '·'; }
    document.getElementById('pv_voice_n').textContent = v ? v.name : '未选';
    const vs = document.getElementById('pv_voice_s');
    if (v) { vs.textContent = v.tier || ''; vs.classList.remove('empty'); } else { vs.textContent = '音色'; vs.classList.add('empty'); }
    document.getElementById('pv_track_av').textContent = '♪';
    const tn = document.getElementById('pv_track_n');
    const ts = document.getElementById('pv_track_s');
    if (state.synth.voice && state.synth.target) {
      const vv = V(state.synth.voice);
      if (vv.tier !== 'mid') {
        tn.textContent = state.synth.target.length > 20 ? state.synth.target.slice(0, 20) + '…' : state.synth.target;
        ts.textContent = '文本输入'; ts.classList.remove('empty');
      } else if (t) {
        tn.textContent = t.name;
        ts.textContent = `${t.artist || ''} · ${fmtDuration(t.duration)}`;
        ts.classList.remove('empty');
      }
      fillWaveform('pv_wave', 60, 0.3);
    } else {
      tn.textContent = '未选';
      ts.textContent = '曲目'; ts.classList.add('empty');
      fillWaveform('pv_wave', 60, 0.0);
    }
  }
  function updateSynth() { updateSynthRow(); updateSynthPreview(); }
  window.updateSynth = updateSynth;

  function fmtDuration(s) { if (!s) return ''; const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${String(ss).padStart(2, '0')}`; }

  document.getElementById('cta').addEventListener('click', async () => {
    const cta = document.getElementById('cta');
    if (cta.disabled) return;
    const errHost = cta.closest('.card-body');
    clearErr(errHost);
    cta.disabled = true; cta.textContent = '合成中…';
    try {
      const v = V(state.synth.voice);
      const body = new FormData();
      body.append('voice_id', state.synth.voice);
      if (v.tier === 'mid') body.append('track_id', state.synth.target);
      else body.append('text', state.synth.target);
      body.append('pitch', state.synth.params.pitch);
      body.append('index_rate', state.synth.params.indexRate);
      const r = await apiForm('/api/songs', body);
      state.songs.unshift(r);
      renderRecent();
      fillWaveform('pv_wave', 60, 0.4);
      showOk(errHost, '合成完成', '已加入 AI 歌曲库');
    } catch (e) {
      showErr(errHost, '合成失败', errMsg(e));
    } finally {
      cta.innerHTML = '开始合成<span class="kbd">⌘↵</span>';
      cta.disabled = false;
    }
  });

  // ============= MODAL =============
  function showModal(html) { document.getElementById('modal').innerHTML = html; document.getElementById('modalBg').classList.add('open'); }
  function closeModal() { document.getElementById('modalBg').classList.remove('open'); }
  window.showModal = showModal; window.closeModal = closeModal;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  window.openPicker = function (kind) {
    if (kind === 'voice') {
      const list = state.voices.map(v => {
        const a = voiceAv(v);
        const isText = v.tier === 'simple' || v.tier === 'pro';
        return `<div class="opt${v.id === state.synth.voice ? ' sel' : ''}" onclick="pickVoice('${v.id}')">
          <div class="av" style="background:${a.color}">${a.letter}</div>
          <div><div class="nm">${escapeHtml(v.name)}</div><div class="sub">${escapeHtml(v.tier || '')}</div></div>
          <div class="right">${state.runningJob && state.runningJob.voice_id === v.id ? '<span style="color:var(--accent)">训练中</span>' : (isText ? '文本' : '唱歌')}</div>
        </div>`;
      }).join('');
      showModal(`
        <div class="mh"><div class="title">选择音色</div><div class="x" onclick="closeModal()">✕</div></div>
        <div class="mb">${list || '<div style="padding:24px;color:var(--fg-3);text-align:center">暂无音色</div>'}</div>
        <div class="mf"><span>${state.voices.length} 个音色</span><span class="add" onclick="closeModal();nav('new')">＋ 新建音色</span></div>
      `);
    } else {
      if (!state.synth.voice) { window.openPicker('voice'); return; }
      const v = V(state.synth.voice);
      if (v.tier !== 'mid') {
        showModal(`
          <div class="mh"><div class="title">输入文本</div><div class="x" onclick="closeModal()">✕</div></div>
          <div class="form" style="padding:18px">
            <textarea id="txtInput" class="nv-input" rows="5" style="resize:vertical">在这片广阔的星空下，每一颗星星都是一个故事，而我，是其中最闪亮的那一颗。</textarea>
            <div class="acts"><button class="secondary" onclick="closeModal()">取消</button><button class="primary" onclick="pickText(document.getElementById('txtInput').value)">确定</button></div>
          </div>
        `);
      } else {
        const list = state.tracks.map(t => `
          <div class="opt${t.id === state.synth.target ? ' sel' : ''}" onclick="pickTrack('${t.id}')">
            <div class="av song">♪</div>
            <div><div class="nm">${escapeHtml(t.name)}</div><div class="sub">${escapeHtml(t.artist || '')}</div></div>
            <div class="right">${fmtDuration(t.duration)}</div>
          </div>`).join('');
        showModal(`
          <div class="mh"><div class="title">选择曲目</div><div class="x" onclick="closeModal()">✕</div></div>
          <div class="mb">${list || '<div style="padding:24px;color:var(--fg-3);text-align:center">尚未上传曲目</div>'}</div>
          <div class="mf"><span>${state.tracks.length} 首曲目</span><span class="add" onclick="closeModal();openNewTrack()">＋ 上传曲目</span></div>
        `);
      }
    }
  };
  window.pickVoice = function (id) {
    state.synth.voice = id;
    const v = V(id);
    if (state.synth.target != null) {
      const isText = v.tier === 'simple' || v.tier === 'pro';
      if (isText && typeof state.synth.target !== 'string') state.synth.target = null;
      if (!isText && typeof state.synth.target === 'string') state.synth.target = null;
    }
    updateSynth(); closeModal();
  };
  window.pickTrack = function (id) { state.synth.target = id; updateSynth(); closeModal(); };
  window.pickText = function (t) { state.synth.target = t || ''; updateSynth(); closeModal(); };
  // ============= NEW VOICE: tier + samples =============
  const newVoice = { tier: 'mid', files: [] };

  function applyTierUI(t) {
    document.querySelectorAll('.tier-card').forEach(c => c.classList.toggle('sel', c.dataset.tier === t));
    const showRef = (t === 'pro' || t === 'simple');
    document.getElementById('nv_reftext_wrap').style.display = showRef ? '' : 'none';
    const lbl = document.getElementById('nv_drop_label');
    const hint = document.getElementById('nv_drop_hint');
    const h2 = document.getElementById('nv_drop_h2');
    if (t === 'simple') {
      lbl.firstChild.textContent = '说话样本 ';
      hint.textContent = '10s–1min 说话音频 1 段即可';
      h2.textContent = 'mp3 / m4a / wav · 越纯净越好 · 单文件 < 30 MB';
    } else if (t === 'pro') {
      lbl.firstChild.textContent = '纯净人声样本 ';
      hint.textContent = '5–20 秒 · 无伴奏无混响';
      h2.textContent = 'mp3 / m4a / wav · 单文件 < 30 MB';
    } else {
      lbl.firstChild.textContent = '样本歌曲 ';
      hint.textContent = '1–5 首 · 带伴奏也行，系统会自动分离人声';
      h2.textContent = 'mp3 / m4a / wav / flac / ogg · 单文件 < 30 MB';
    }
    renderNewVoiceFiles();
  }
  window.pickTier = function (t) { newVoice.tier = t; applyTierUI(t); };

  const ALLOWED_EXT = new Set(['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac']);
  const MAX_BYTES = 30 * 1024 * 1024;
  function fmtBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

  function addNewVoiceFiles(fileList) {
    const errHost = document.querySelector('.view[data-view="new"]');
    clearErr(errHost);
    const rejected = [];
    for (const f of fileList) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) { rejected.push(`${f.name}：格式不支持`); continue; }
      if (f.size > MAX_BYTES) { rejected.push(`${f.name}：超过 30 MB`); continue; }
      if (newVoice.files.length >= 5) { rejected.push(`${f.name}：最多 5 个样本`); continue; }
      // dedupe by name
      if (newVoice.files.some(x => x.name === f.name && x.size === f.size)) continue;
      newVoice.files.push(f);
    }
    if (rejected.length) showErr(errHost, '部分文件未加入', rejected.join('；'));
    renderNewVoiceFiles();
  }
  function removeNewVoiceFile(idx) {
    newVoice.files.splice(idx, 1);
    renderNewVoiceFiles();
  }
  window.removeNewVoiceFile = removeNewVoiceFile;

  function renderNewVoiceFiles() {
    const c = document.getElementById('nv_files');
    if (!c) return;
    c.innerHTML = newVoice.files.map((f, i) => `
      <div class="nv-file">
        <div class="nv-file-ic">♪</div>
        <div class="nv-file-info">
          <div class="nv-file-name">${escapeHtml(f.name)}</div>
          <div class="nv-file-meta">${fmtBytes(f.size)}</div>
        </div>
        <button class="nv-mini-btn nv-x" onclick="removeNewVoiceFile(${i})">✕</button>
      </div>`).join('');
    const sum = document.getElementById('nv_summary');
    const cnt = newVoice.files.length;
    if (cnt === 0) { sum.style.display = 'none'; updateNewVoiceSummary(); return; }
    sum.style.display = '';
    document.getElementById('nv_count').textContent = cnt;
    const total = newVoice.files.reduce((s, f) => s + f.size, 0);
    document.getElementById('nv_totalsize').textContent = fmtBytes(total);
    const t = newVoice.tier;
    const limits = { simple: { min: 1, max: 1 }, mid: { min: 1, max: 5 }, pro: { min: 1, max: 1 } };
    const lim = limits[t];
    const check = document.getElementById('nv_check');
    if (cnt < lim.min) { check.textContent = `还需 ${lim.min - cnt} 个`; check.style.color = '#b88420'; }
    else if (cnt > lim.max) { check.textContent = `超出 ${cnt - lim.max} 个`; check.style.color = '#d04848'; }
    else { check.textContent = '✓ 符合要求'; check.style.color = 'var(--green)'; }
    updateNewVoiceSummary();
  }

  function updateNewVoiceSummary() {
    const t = newVoice.tier;
    const tierLbl = { simple: '简易 · F5-TTS', mid: '中等 · RVC v2', pro: '高级 · GPT-SoVITS' };
    const sumTier = document.getElementById('sum_tier'); if (sumTier) sumTier.textContent = tierLbl[t] || t;
    const name = document.getElementById('nv_name')?.value?.trim() || '—';
    const sumName = document.getElementById('sum_name'); if (sumName) sumName.textContent = name;
    const cnt = newVoice.files.length;
    const total = newVoice.files.reduce((s, f) => s + f.size, 0);
    const sumCnt = document.getElementById('sum_count'); if (sumCnt) sumCnt.textContent = String(cnt);
    const sumSize = document.getElementById('sum_size'); if (sumSize) sumSize.textContent = fmtBytes(total);
    const ep = document.querySelector('#newVoice input[type=range]')?.value;
    const epEl = document.getElementById('sum_ep'); if (epEl && ep) epEl.textContent = ep;
    // hide epochs / batch rows for non-mid tier
    const showTrain = (t === 'mid');
    const epRow = document.getElementById('sum_eprow'); if (epRow) epRow.style.display = showTrain ? '' : 'none';
    const bsRow = document.getElementById('sum_bsrow'); if (bsRow) bsRow.style.display = showTrain ? '' : 'none';
    const eta = document.getElementById('sum_eta');
    if (eta) {
      if (cnt === 0) eta.textContent = '—';
      else if (t === 'simple') eta.textContent = '约 30 秒';
      else if (t === 'pro') eta.textContent = '约 10 秒';
      else eta.textContent = '约 25–30 分钟';
    }
  }
  // listen to name input + tier changes
  document.addEventListener('input', (e) => {
    if (e.target && (e.target.id === 'nv_name' || e.target.closest('.nv-param'))) updateNewVoiceSummary();
  });

  function wireNewVoiceFileInputs() {
    const input = document.getElementById('nv_file_input');
    const drop = document.getElementById('nv_drop');
    if (!input || !drop || input.dataset.wired) return;
    input.dataset.wired = '1';
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { addNewVoiceFiles(input.files); input.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.background = 'var(--accent-soft)'; });
    drop.addEventListener('dragleave', () => { drop.style.background = ''; });
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.style.background = '';
      addNewVoiceFiles(e.dataTransfer.files);
    });
  }

  window.openNewTrack = function () {
    showModal(`
      <div class="mh"><div class="title">上传曲目</div><div class="x" onclick="closeModal()">✕</div></div>
      <form class="form" id="newTrackForm" enctype="multipart/form-data">
        <div class="f"><label>歌曲名</label><input class="nv-input" name="name" placeholder="例：几分之几" required/></div>
        <div class="f"><label>艺人 / 备注</label><input class="nv-input" name="artist" placeholder="可选"/></div>
        <div class="f"><label>音频文件</label><input type="file" name="file" accept="audio/*" required style="font-size:13px"/></div>
        <div class="acts"><button type="button" class="secondary" onclick="closeModal()">取消</button><button type="submit" class="primary">上传</button></div>
      </form>
    `);
    document.getElementById('newTrackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errHost = e.target;
      clearErr(errHost);
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '上传中…';
      try {
        const r = await apiForm('/api/tracks', new FormData(e.target));
        state.tracks.unshift(r); closeModal(); nav('tracks');
      } catch (err) {
        showErr(errHost, '上传失败', errMsg(err));
        btn.disabled = false; btn.textContent = '上传';
      }
    });
  };

  // ============= LISTS =============
  function fillWaveMini(node, count) { for (let i = 0; i < count; i++) { const b = document.createElement('i'); b.style.height = (3 + Math.random() * 18) + 'px'; node.appendChild(b); } }
  function fillWaveform(id, count, played) {
    const c = document.getElementById(id); if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < count; i++) { const b = document.createElement('i'); b.style.height = (4 + Math.random() * 32) + 'px'; if (played > 0 && i >= count * played) b.classList.add('x'); c.appendChild(b); }
  }
  window.fillWaveform = fillWaveform;
  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderVoices() {
    const c = document.getElementById('voiceList');
    if (!state.voices.length) {
      c.innerHTML = `<div style="padding:64px 16px;text-align:center;color:var(--fg-3)"><div style="color:var(--fg);font-size:15px;font-weight:500;margin-bottom:6px">还没有音色</div><div style="font-size:13px;margin-bottom:20px">上传 1–5 段歌唱或说话音频，开始训练</div><button class="topbar-primary" onclick="nav('new')">＋ 新建音色</button></div>`;
      return;
    }
    c.innerHTML = state.voices.map(v => {
      const a = voiceAv(v);
      const isRunning = state.runningJob && state.runningJob.voice_id === v.id;
      if (isRunning) {
        const j = state.runningJob;
        return `<div class="training-row" id="tr_${v.id}" onclick="document.getElementById('tr_${v.id}').classList.toggle('open')">
          <div class="tr-top">
            <div class="av" style="background:${a.color}">${a.letter}</div>
            <div><div class="nm">${escapeHtml(v.name)}</div><div class="nsub"><span class="dot"></span>训练中 · <span id="tr_stg_${v.id}">${j.stage_label || '人声分离'}</span></div></div>
            <div class="pct"><span id="tr_pct_${v.id}">${Math.floor(j.pct || 0)}</span>%</div>
          </div>
          <div class="bar"><i id="tr_bar_${v.id}" style="width:${j.pct || 0}%"></i></div>
          <div class="meta-r"><span id="tr_eta_${v.id}">约 — 分钟</span><span>${escapeHtml(v.tier || '')}</span></div>
          <div class="details">
            <div class="stages" id="tr_stages_${v.id}">
              ${['separate','slice','rvc-pp','rvc-f0','rvc-feat','rvc-train','rvc-index'].map((s, i) => `<div class="stage" data-s="${s}"><div class="tk"></div>${['人声分离','切片归一化','RVC 预处理','f0 提取','语义特征','训练主网络','构建索引'][i]}<div class="pp">—</div></div>`).join('')}
            </div>
          </div>
        </div>`;
      }
      return `<div class="list-row" onclick="state.synth=window._state?.synth||{};window.pickVoice('${v.id}');nav('synth')">
        <div class="av" style="background:${a.color}">${a.letter}</div>
        <div class="name">${escapeHtml(v.name)}<div class="nsub">${escapeHtml(v.tier || '')}</div></div>
        <div class="status-cell done"><span class="dot"></span>就绪</div>
        <div class="meta-c"></div>
        <div class="actions"><button class="use">使用 →</button><button>⋯</button></div>
      </div>`;
    }).join('');
  }

  function renderTracks() {
    const c = document.getElementById('trackList');
    if (!state.tracks.length) {
      c.innerHTML = `<div style="padding:64px 16px;text-align:center;color:var(--fg-3)"><div style="color:var(--fg);font-size:15px;font-weight:500;margin-bottom:6px">曲目库为空</div><div style="font-size:13px;margin-bottom:20px">上传你想用 AI 翻唱的歌曲</div><button class="topbar-primary" onclick="openNewTrack()">＋ 上传曲目</button></div>`;
      return;
    }
    c.innerHTML = state.tracks.map(t => `
      <div class="list-row" style="grid-template-columns: 44px 1fr 1.4fr 110px 90px" onclick="window.pickTrack('${t.id}');nav('synth')">
        <div class="av song">♪</div>
        <div class="name">${escapeHtml(t.name)}<div class="nsub">${escapeHtml(t.artist || '')}</div></div>
        <div class="wave-mini" id="wm_${t.id}"></div>
        <div class="meta-c">${fmtDuration(t.duration)}</div>
        <div class="actions"><button>▶</button><button class="use">翻唱 →</button></div>
      </div>`).join('');
    state.tracks.forEach(t => { const n = document.getElementById('wm_' + t.id); if (n) { n.innerHTML = ''; fillWaveMini(n, 30); } });
  }

  function fmtRelative(ts) {
    if (!ts) return '';
    const d = Date.now() / 1000 - ts;
    if (d < 60) return '刚刚';
    if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
    if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
    return `${Math.floor(d / 86400)} 天前`;
  }
  function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

  function renderSongs() {
    const c = document.getElementById('songList');
    if (!state.songs.length) {
      c.innerHTML = `<div style="padding:64px 16px;text-align:center;color:var(--fg-3)"><div style="color:var(--fg);font-size:15px;font-weight:500;margin-bottom:6px">还没有作品</div><div style="font-size:13px;margin-bottom:20px">去合成页生成第一首吧</div><button class="topbar-primary" onclick="nav('synth')">→ 去合成</button></div>`;
      return;
    }
    c.innerHTML = state.songs.map((s, i) => {
      const v = V(s.voice_id); const t = s.track_id ? T(s.track_id) : null;
      const av = v ? voiceAv(v) : { color: 'var(--bg-3)', letter: '?' };
      const title = t ? t.name : (s.text || '文本合成');
      const sub = (v ? v.name : '?') + (t ? ' × ' + (t.artist || t.name) : ' · TTS');
      return `<div class="list-row" style="grid-template-columns: 44px 1fr 1.4fr 110px 90px" onclick="playSong('${s.id}')">
        <div class="av" style="background:${av.color}">${av.letter}</div>
        <div class="name">${escapeHtml(title)}<div class="nsub">${escapeHtml(sub)}</div></div>
        <div class="wave-mini" id="sw_${i}"></div>
        <div class="meta-c">${fmtRelative(s.created_at)}<div style="font-size:10px;opacity:0.7;margin-top:2px">${fmtSize(s.size_bytes || 0)}</div></div>
        <div class="actions"><button onclick="event.stopPropagation();playSong('${s.id}')">▶</button><button>⋯</button></div>
      </div>`;
    }).join('');
    state.songs.forEach((s, i) => { const n = document.getElementById('sw_' + i); if (n) { n.innerHTML = ''; fillWaveMini(n, 30); } });
  }
  window.playSong = function (sid) {
    const a = new Audio(`/api/songs/${sid}/audio`);
    a.play().catch(() => {});
  };

  function renderRecent() {
    const c = document.getElementById('synthRecent'); if (!c) return;
    const recent = state.songs.slice(0, 4);
    c.innerHTML = recent.map(s => {
      const v = V(s.voice_id); const t = s.track_id ? T(s.track_id) : null;
      const av = v ? voiceAv(v) : { color: 'var(--bg-3)', letter: '?' };
      return `<div class="recent-card" onclick="playSong('${s.id}')">
        <div class="pp" style="background:${av.color}">${av.letter}</div>
        <div class="info"><div class="n">${escapeHtml(t ? t.name : (s.text || '文本'))}</div><div class="s">${escapeHtml((v ? v.name : '?') + (t ? ' · ' + (t.artist || '') : ''))}</div></div>
        <div class="ts">${fmtRelative(s.created_at)}</div>
      </div>`;
    }).join('') || `<div style="padding:16px;color:var(--fg-3);font-size:12px;text-align:center">尚无输出</div>`;
  }

  // ============= NEW VOICE submit =============
  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.id === 'newVoiceSubmit' ? e.target : null;
    if (!btn) return;
    const newView = document.querySelector('.view[data-view="new"]');
    clearErr(newView);

    const tier = newVoice.tier;
    const name = (document.getElementById('nv_name')?.value || '').trim();
    if (!name) { showErr(newView, '请填写音色名称', ''); return; }
    if (newVoice.files.length === 0) { showErr(newView, '请上传样本音频', ''); return; }
    const refText = (document.getElementById('nv_reftext')?.value || '').trim();
    if (tier === 'pro' && !refText) { showErr(newView, '高级档需要填写参考音频对应文字', ''); return; }

    const form = new FormData();
    form.append('name', name);
    form.append('tier', tier);
    if (refText) form.append('ref_text', refText);
    // epochs / batch only for mid
    if (tier === 'mid') {
      const ep = document.getElementById('ep_v')?.textContent?.match(/\d+/)?.[0] || '20';
      const bs = document.getElementById('bs_v')?.textContent || '4';
      form.append('epochs', ep);
      form.append('batch_size', bs);
    }
    for (const f of newVoice.files) form.append('samples', f);

    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await apiForm('/api/voices', form);
      state.voices = await api('/api/voices');
      if (r.job_id) attachJob(r.job_id, r.voice_id || (r.voice && r.voice.id));
      // 重置表单
      newVoice.files = []; renderNewVoiceFiles();
      const nm = document.getElementById('nv_name'); if (nm) nm.value = '';
      const rt = document.getElementById('nv_reftext'); if (rt) rt.value = '';
      nav('voices');
    } catch (err) {
      showErr(newView, '启动失败', errMsg(err));
    } finally {
      btn.disabled = false; btn.textContent = '开始训练 →';
    }
  });

  // ============= SSE attach =============
  const STAGE_LBL = { separate: '人声分离', slice: '切片归一化', 'rvc-pp': 'RVC 预处理', 'rvc-f0': 'f0 提取', 'rvc-feat': '语义特征', 'rvc-train': '训练主网络', 'rvc-index': '构建索引' };
  function attachJob(jobId, voiceId) {
    state.runningJob = { job_id: jobId, voice_id: voiceId, pct: 0, stage: '', stage_label: '人声分离' };
    const es = new EventSource(`/sse/jobs/${jobId}`);
    es.addEventListener('snapshot', (e) => {
      try { const d = JSON.parse(e.data); state.runningJob.stage = d.stage || ''; state.runningJob.pct = d.pct || 0; } catch {}
    });
    es.addEventListener('stage', (e) => {
      try {
        const d = JSON.parse(e.data);
        state.runningJob.stage = d.stage;
        state.runningJob.pct = d.pct;
        state.runningJob.stage_label = STAGE_LBL[d.stage] || d.stage;
        updateRunningRow();
      } catch {}
    });
    es.addEventListener('log', () => {/* could be displayed */});
    es.addEventListener('done', async () => {
      es.close();
      state.runningJob = null;
      state.voices = await api('/api/voices');
      renderVoices();
    });
    es.addEventListener('error', async (e) => {
      es.close();
      let detail = '';
      try { detail = JSON.parse(e.data)?.msg || ''; } catch {}
      if (state.runningJob) state.runningJob.error = detail || '训练失败';
      renderVoices();
      // 找到训练行标红
      const row = document.getElementById('tr_' + (state.runningJob?.voice_id || ''));
      if (row) row.classList.add('failed');
      state.runningJob = null;
    });
  }
  function updateRunningRow() {
    const j = state.runningJob; if (!j) return;
    const vid = j.voice_id;
    const bar = document.getElementById('tr_bar_' + vid); if (bar) bar.style.width = j.pct + '%';
    const pct = document.getElementById('tr_pct_' + vid); if (pct) pct.textContent = Math.floor(j.pct);
    const stg = document.getElementById('tr_stg_' + vid); if (stg) stg.textContent = j.stage_label;
    const stages = document.getElementById('tr_stages_' + vid);
    if (stages) {
      const order = ['separate','slice','rvc-pp','rvc-f0','rvc-feat','rvc-train','rvc-index'];
      stages.querySelectorAll('.stage').forEach(el => el.classList.remove('active'));
      const idx = order.indexOf(j.stage);
      for (let i = 0; i < idx; i++) {
        const el = stages.querySelector(`.stage[data-s="${order[i]}"]`);
        if (el) { el.classList.add('done'); el.querySelector('.pp').textContent = '完成'; }
      }
      const el = stages.querySelector(`.stage[data-s="${j.stage}"]`);
      if (el) { el.classList.add('active'); el.querySelector('.pp').textContent = Math.floor(j.pct) + '%'; }
    }
  }

  // INIT
  loadAll().then(() => nav('synth')).catch(err => {
    console.error(err); document.body.innerHTML = '<pre style="padding:24px">加载失败：' + (err?.detail || JSON.stringify(err)) + '</pre>';
  });
})();
