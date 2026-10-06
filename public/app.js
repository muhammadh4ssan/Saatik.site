(() => {
  const $ = s => document.querySelector(s);
  const T = window.T;
  const url = $('#url'), go = $('#go'), msg = $('#msg'), res = $('#res');
  const root = document.documentElement, tb = $('#theme');

  // theme toggle
  function paint() {
    const light = root.dataset.theme === 'light';
    tb.textContent = light ? '\u263E' : '\u2600\uFE0E';
    tb.setAttribute('aria-label', light ? T.toDark : T.toLight);
  }
  tb.onclick = () => {
    const n = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = n;
    try { localStorage.setItem('theme', n); } catch {}
    paint();
  };
  paint();

  // labels
  $('#b-hd').textContent = T.hd; $('#b-sd').textContent = T.sd;
  $('#b-mp3').textContent = T.mp3; $('#b-all').textContent = T.all;

  $('#paste').onclick = async () => {
    try { url.value = (await navigator.clipboard.readText()).trim(); url.focus(); }
    catch { msg.textContent = T.clip; }
  };
  url.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  go.onclick = run;
  let lastName = 'tiktok';
  const loadZip = () => new Promise((ok, no) => {
    if (window.JSZip) return ok();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = ok; s.onerror = no; document.head.appendChild(s);
  });
  $('#b-all').onclick = async () => {
    const links = [...document.querySelectorAll('#grid a')];
    if (!links.length) return;
    const btn = $('#b-all'); btn.disabled = true;
    try {
      await loadZip();
      const zip = new JSZip();
      for (let i = 0; i < links.length; i++) {
        msg.textContent = T.zipping + ' ' + (i + 1) + '/' + links.length;
        const r = await fetch(links[i].href);
        if (!r.ok) throw new Error('fetch');
        const b = await r.blob();
        const ext = /webp/.test(b.type) ? 'webp' : /png/.test(b.type) ? 'png' : 'jpg';
        zip.file('photo-' + (i + 1) + '.' + ext, b);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out); a.download = lastName + '-photos.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      msg.textContent = '';
    } catch { msg.textContent = T.err.busy; }
    btn.disabled = false;
  };

  // sticky bottom ad: reserve space, allow closing
  const sticky = $('#ad-sticky');
  if (sticky) {
    document.body.classList.add('has-sticky');
    $('#ad-x').onclick = () => { sticky.remove(); document.body.classList.remove('has-sticky'); };
  }

  const dl = (u, n, e) => '/api/download?u=' + encodeURIComponent(u) + '&n=' + encodeURIComponent(n) + '&e=' + e;

  async function run() {
    const v = url.value.trim();
    if (!v) { msg.textContent = T.first; return; }
    msg.textContent = T.getting;
    res.hidden = true; $('#photos').hidden = true; go.disabled = true;
    try {
      const r = await fetch('/api/info?url=' + encodeURIComponent(v));
      const d = await r.json();
      if (!r.ok) { const e = new Error(T.err[d.code] || T.err.generic); e.known = true; throw e; }
      const imgs = d.images || [];
      const name = (d.author || 'tiktok') + '-' + Date.now().toString().slice(-5);
      lastName = name;
      $('#cover').src = d.cover || imgs[0] || '';
      $('#title').textContent = d.title;
      $('#author').textContent = (d.author ? '@' + d.author : '') + (d.duration ? ' \u00B7 ' + d.duration + 's' : '');
      $('#b-hd').hidden = !d.hd; if (d.hd) $('#b-hd').href = dl(d.hd, name + '-hd', 'mp4');
      $('#b-sd').hidden = !d.video; if (d.video) $('#b-sd').href = dl(d.video, name, 'mp4');
      $('#b-mp3').hidden = !d.music; if (d.music) $('#b-mp3').href = dl(d.music, name, 'mp3');
      const grid = $('#grid'); grid.innerHTML = '';
      imgs.forEach((u, i) => {
        const a = document.createElement('a');
        a.href = dl(u, name + '-' + (i + 1), 'jpg'); a.setAttribute('download', '');
        const im = document.createElement('img');
        im.src = u; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.alt = T.photo + ' ' + (i + 1);
        const sp = document.createElement('span'); sp.textContent = T.save;
        a.append(im, sp); grid.appendChild(a);
      });
      $('#ph-count').textContent = imgs.length + ' ' + (imgs.length === 1 ? T.photo : T.photos);
      $('#photos').hidden = !imgs.length;
      res.hidden = false; msg.textContent = '';
      res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { msg.textContent = e.known ? e.message : T.err.busy; }
    go.disabled = false;
  }
})();
