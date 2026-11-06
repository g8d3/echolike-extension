// EchoLike v2.2 — content script (notas escritas: mantener ~500 ms, tecla N, ✎) en x.com. Detecta clics en Like/Bookmark y los manda al background (que los guarda en local; solo los envía si el usuario activó sync).
(function (root) {
  // Idempotency guard: MV3 can re-inject this file (scripting.executeScript fallback,
  // extension update/reload paths). Running the IIFE twice would stack observers,
  // listeners and timers, multiplying CPU work and destabilizing the page.
  if (root.__echolikeContentLoaded) return;
  try { root.__echolikeContentLoaded = true; } catch (e) { return; }
  const ACCIONES = { like: "like", unlike: "unlike", bookmark: "bookmark", removeBookmark: "unbookmark" };

  function botonAccion(target) {
    const el = target && target.closest && target.closest('[data-testid]');
    let b = el;
    while (b && !ACCIONES[b.getAttribute("data-testid")]) b = b.parentElement && b.parentElement.closest('[data-testid]');
    return b || null;
  }

  // Extrae datos del tweet que contiene el botón. Pura: solo DOM, testeable con fixtures.
  // Además de lo básico lee los contadores visibles de la barra de acciones
  // (replies, reposts, likes, views). Los bookmarks NO tienen contador público
  // en X: nunca se inventan, quedan null.
  function parseCount(s) {
    if (s === null || s === undefined) return null;
    const m = String(s).toLowerCase().replace(/[\s\u00a0\u202f]+/g, "").match(/([\d.,]+)(mil|mm|[kmb])?/);
    if (!m) return null;
    let num = m[1], mult = 1;
    if (m[2] === "k" || m[2] === "mil") mult = 1e3;
    else if (m[2] === "m" || m[2] === "mm") mult = 1e6;
    else if (m[2] === "b") mult = 1e9;
    if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");   // miles en es (12.345)
    else if (num.indexOf(".") !== -1 && num.indexOf(",") !== -1) num = num.replace(/,/g, "");
    else if (num.indexOf(",") !== -1) {
      const p = num.split(",");
      num = (p.length === 2 && p[1].length !== 3) ? p[0] + "." + p[1] : p.join("");
    }
    const n = parseFloat(num);
    return isFinite(n) ? Math.round(n * mult) : null;
  }

  // Un botón/contador: el total real vive en el aria-label ("12 replies",
  // "1.2K likes"); el texto visible es el compacto ("1.2K"). Sin dígitos = null.
  function numEn(el) {
    if (!el) return null;
    try {
      const aria = el.getAttribute && el.getAttribute("aria-label");
      const ma = aria && String(aria).match(/([\d.,\s\u00a0\u202f]+)(mil|mm|[kmb])?\b/i);
      if (ma) { const n = parseCount((ma[1] || "") + (ma[2] || "")); if (n !== null) return n; }
    } catch (e) {}
    const txt = el.innerText || el.textContent || "";
    const mt = String(txt).match(/([\d.,]+)\s*(mil|mm|[kmb])?\b/i);
    return mt ? parseCount((mt[1] || "") + (mt[2] || "")) : null;
  }

  // Contadores de la barra de acciones del tweet propio (no del citado).
  function metricas(art) {
    const fueraCita = (el) => { try { return !el.closest('[role="link"][tabindex]'); } catch (e) { return true; } };
    const primero = (sel) => {
      let els = [];
      try { els = art.querySelectorAll(sel); } catch (e) { return null; }
      for (const el of els) if (fueraCita(el)) return el;
      return null;
    };
    const vista = primero('a[href*="/analytics"]') || primero('[aria-label*="iew"],[aria-label*="ISTA"],[aria-label*="ista"]');
    return {
      replies: numEn(primero('[data-testid="reply"]')),
      reposts: numEn(primero('[data-testid="retweet"]')),
      likes: numEn(primero('[data-testid="like"],[data-testid="unlike"]')),
      views: numEn(vista)
    };
  }

  // Outbound links of the post: t.co href + title/display text + photo urls (capped).
  // Pure over the article node, so it is unit-testable with fixtures.
  function outgoingLinks(art) {
    const links = [];
    try {
      const txt = art.querySelector('[data-testid="tweetText"]') || art;
      for (const a of txt.querySelectorAll('a[href*="t.co"]')) {
        if (links.length >= 10) break;
        const href = a.getAttribute("href") || "";
        if (!href || links.some((l) => l.href === href)) continue;
        links.push({ href, title: (a.getAttribute("title") || "").slice(0, 500),
          text: (a.innerText || a.textContent || "").slice(0, 200) });
      }
      // Article cards link straight at /i/article/ (no t.co hop): record them resolved.
      for (const a of art.querySelectorAll('a[href*="/i/article/"]')) {
        if (links.length >= 10) break;
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/i\/article\/(\d+)/);
        if (!m || links.some((l) => l.href === href)) continue;
        links.push({ href, resuelto: "https://x.com/i/article/" + m[1],
          title: (a.getAttribute("title") || "").slice(0, 500),
          text: (a.innerText || a.textContent || "").slice(0, 200) });
      }
    } catch (e) {}
    return links;
  }
  function mediaInfo(art) {
    const fotos = [];
    try {
      for (const img of art.querySelectorAll('a[href*="/photo/"] img[src], [data-testid="tweetPhoto"] img[src]')) {
        if (fotos.length >= 4) break;
        const src = img.getAttribute("src") || "";
        if (src && fotos.indexOf(src) < 0) fotos.push(src);
      }
    } catch (e) {}
    let video = false;
    try { video = !!art.querySelector('[data-testid="videoPlayer"]'); } catch (e) {}
    return { fotos, video };
  }
  // X truncates long posts behind a "Show more" affordance. Returns true when the
  // visible text is known-incomplete, so the backend marks the capture, not the content.
  function isTruncated(art) {
    try {
      const txt = art.querySelector('[data-testid="tweetText"]');
      if (!txt) return false;
      const s = (txt.innerText || txt.textContent || "");
      return /show more|mostrar m.s|ver m.s|(…|\.\.\.)\s*$|show this thread|ver este hilo/i.test(s) ||
        !!txt.querySelector('span[class*="showMore"], div[role="button"]');
    } catch (e) { return false; }
  }
  // Click the inline expander (no navigation) so a delayed re-read gets the full post.
  function expandPost(art) {
    try {
      const txt = art.querySelector('[data-testid="tweetText"]');
      if (!txt) return false;
      for (const el of txt.querySelectorAll('span, div[role="button"]')) {
        if (/^\s*(show more|mostrar m.s|ver m.s)\s*$/i.test(el.innerText || el.textContent || "")) {
          const btn = el.closest('[role="button"]') || el;
          btn.click(); return true;
        }
      }
    } catch (e) {}
    return false;
  }
  function extraer(boton, loc) {
    const art = boton.closest("article") || boton.closest('[data-testid="tweet"]');
    if (!art) return null;
    // El link de la hora (<a href="/user/status/ID"><time>) identifica el tweet propio, no el citado.
    let a = null;
    for (const t of art.querySelectorAll("time")) {
      const p = t.closest('a[href*="/status/"]');
      if (p && !p.closest('[role="link"][tabindex]') ) { a = p; break; }
      if (p && !a) a = p;
    }
    if (!a) a = art.querySelector('a[href*="/status/"]');
    let m = a && a.getAttribute("href").match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (!m && loc) m = String(loc).match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/); // vista de detalle
    if (!m) return null;
    const txtEl = art.querySelector('[data-testid="tweetText"]');
    const time = a && a.querySelector("time");
    const truncated = isTruncated(art);
    return Object.assign({
      id: m[2], handle: m[1], url: `https://x.com/${m[1]}/status/${m[2]}`,
      text: txtEl ? txtEl.innerText || txtEl.textContent || "" : "",
      tweet_time: time ? time.getAttribute("datetime") : null,
      truncated, links: outgoingLinks(art), media: mediaInfo(art)
    }, metricas(art));
  }

  function evento(target, loc) {
    const b = botonAccion(target);
    if (!b) return null;
    const accion = ACCIONES[b.getAttribute("data-testid")];   // testid ANTES del clic = acción que hace
    const d = extraer(b, loc);
    if (!d) return null;
    return Object.assign({ v: 2, kind: accion, clicked_at: new Date().toISOString() }, d);
  }

  // ---- Notas escritas (v2.2): funciones puras, testeables ----
  const HOLD_MS = 500, N_MS = 5000;
  function esEditable(el) {
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      const tg = x.tagName;
      if (tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT") return true;
      if (x.isContentEditable || x.getAttribute("contenteditable") === "true" || x.getAttribute("role") === "textbox") return true;
    }
    return false;
  }
  // ¿La tecla abre la nota? Solo N sin modificadores, fuera de campos de texto, ≤5 s tras un like.
  function teclaAbreNota(e, ultimoLikeMs, ahoraMs) {
    if (!e || (e.key !== "n" && e.key !== "N") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return false;
    if (esEditable(e.target)) return false;
    return !!ultimoLikeMs && ahoraMs - ultimoLikeMs >= 0 && ahoraMs - ultimoLikeMs <= N_MS;
  }
  function itemNota(d, texto, origen) {
    const t = String(texto || "").trim();
    if (!d || !d.id || !t) return null;
    const { id, handle, url, text, tweet_time, replies = null, reposts = null, likes = null, views = null } = d;
    return { v: 2, kind: "nota_texto", type: "nota_texto", clicked_at: new Date().toISOString(),
      nota: t.slice(0, 4000), origen: origen || "caja", id, handle, url, text, tweet_time,
      replies, reposts, likes, views };
  }
  // Teclas dentro de la caja: Enter guarda, Shift+Enter salto de línea, Esc cancela.
  function accionTecla(e) {
    if (e.key === "Escape") return "cancelar";
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) return "guardar";
    return null;
  }

  // Two-phase send for truncated posts: ship the capture now, click the inline
  // expander, re-read after X repaints, and follow up with kind "followup" only
  // when the text actually grew. The backend merges it into the same like.
  const FOLLOWUP_MS = 800;
  function sendWithFollowup(ev, art, mandarFn) {
    mandarFn(ev);
    try {
      if (!ev || !ev.truncated || !art || !art.isConnected) return;
      if (!expandPost(art)) return;
      const likeBtn = art.querySelector('[data-testid="like"],[data-testid="unlike"]');
      setTimeout(() => {
        try {
          if (!art.isConnected || !likeBtn || !likeBtn.isConnected) return;
          const d2 = extraer(likeBtn, null);
          if (!d2 || d2.id !== ev.id) return;
          if ((d2.text || "").length > (ev.text || "").length + 20) {
            mandarFn({ v: 2, kind: "followup", clicked_at: new Date().toISOString(),
              id: d2.id, handle: d2.handle, url: d2.url, text: d2.text,
              tweet_time: d2.tweet_time, truncated: d2.truncated, links: d2.links, media: d2.media });
          }
        } catch (e) {}
      }, FOLLOWUP_MS);
    } catch (e) {}
  }
  const api = { botonAccion, extraer, evento, ACCIONES, esEditable, teclaAbreNota, teclaEsLike, teclaEsBookmark, itemNota, accionTecla, HOLD_MS, N_MS, parseCount, metricas, outgoingLinks, mediaInfo, isTruncated, expandPost, sendWithFollowup, FOLLOWUP_MS, articlePage, articleText, detailId, articleCards, ejecutarJS };
  if (typeof module !== "undefined") module.exports = api;
  root.EchoLike = api;

  const ext = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) ? chrome : (typeof browser !== "undefined" ? browser : null);
  const t = (k, s) => { try { const m = ext && ext.i18n && ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
  if (!ext || !root.document || root.__echolikeV22) return;
  root.__echolikeV22 = true;

  function toast(msg, ok) {
    let t = root.document.getElementById("echolike-toast");
    if (!t) { t = root.document.createElement("div"); t.id = "echolike-toast"; root.document.body.appendChild(t); }
    t.textContent = msg; t.className = ok ? "ok" : "err"; t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = "0"), ok ? 2500 : 6000);
  }
  // ---- Passive enrichment (v2.10): the reader's own session already rendered the page.
  // Article pages and tweet-detail views are scraped once per load and sent back keyed
  // to the liked tweet. The backend merges them and NEVER creates likes from views.
  function articlePage(path) { const m = String(path || "").match(/\/i\/article\/(\d+)/); return (m && m[1]) || null; }
  function articleText(doc) {
    let title = "", body = "";
    try {
      const h1 = doc.querySelector("h1");
      title = h1 ? (h1.innerText || h1.textContent || "").trim().slice(0, 300) : "";
      const c = doc.querySelector("article") || doc.querySelector("main") || doc.body;
      body = c ? (c.innerText || c.textContent || "") : "";
    } catch (e) {}
    body = String(body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 100000);
    return { title, body };
  }
  function detailId(path) { const m = String(path || "").match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:[/?#]|$)/); return m ? { handle: m[1], id: m[2] } : null; }
  // Cards visible on the page (article previews, quote cards): what the reader
  // actually saw, including when the article route itself redirects away.
  function articleCards(doc) {
    const out = [];
    try {
      for (const a of doc.querySelectorAll('a[href*="/i/article/"]')) {
        if (out.length >= 5) break;
        const m = (a.getAttribute("href") || "").match(/\/i\/article\/(\d+)/);
        if (!m || out.some((o) => o.id === m[1])) continue;
        const box = a.closest('[data-testid="card.wrapper"]') || a.parentElement;
        const card = box ? (box.innerText || box.textContent || "") : "";
        out.push({ id: m[1], card: card.replace(/\s+/g, " ").trim().slice(0, 1000) });
      }
    } catch (e) {}
    return out;
  }
  let enrichDone = null;
  const enrichSkip = new Set(); // detail ids confirmed not captured here — avoid re-reading storage
  function enrichDetail() {
    try {
      const d = detailId(root.location.pathname);
      if (!d || enrichDone === d.id || enrichSkip.has(d.id)) return;
      // Read truncated_recent first (small). Only fall back to the full datos blob
      // when needed; datos can be large with unlimitedStorage and repeated reads
      // add CPU/IO pressure on a heavy SPA.
      ext.storage.local.get({ truncated_recent: [] }, (s1) => {
        try {
          const ent = (s1.truncated_recent || []).find((x) => x && String(x.id) === d.id);
          const afterKnown = (known) => {
            if (!known) { enrichSkip.add(d.id); return; } // never liked here: looking is not capturing
            let art = null;
            try {
              for (const a of root.document.querySelectorAll("article")) {
                try { if (a.querySelector(`a[href$="/status/${d.id}"] time`)) { art = a; break; } } catch (e) {}
              }
            } catch (e) {}
            const like = art && art.querySelector('[data-testid="like"],[data-testid="unlike"]');
            const d2 = like && extraer(like, root.location.pathname);
            if (!d2 || d2.id !== d.id) return;
            if ((d2.text || "").length > (known.chars || 0) + 20) {
              enrichDone = d.id;
              mandar({ v: 2, kind: "followup", clicked_at: new Date().toISOString(),
                id: d2.id, handle: d2.handle, url: d2.url, text: d2.text,
                tweet_time: d2.tweet_time, truncated: d2.truncated, links: d2.links, media: d2.media });
            }
          };
          if (ent) return afterKnown(ent.chars);
          ext.storage.local.get({ datos: [] }, (s2) => {
            try {
              const it = (s2.datos || []).find((x) => x && String(x.id) === d.id && (x.kind === "like" || x.kind === "bookmark"));
              afterKnown(it ? { chars: (it.text || "").length } : null);
            } catch (e) {}
          });
        } catch (e) {}
      });
    } catch (e) {}
  }
  function enrichPage() {
    try {
      const aid = articlePage(root.location.pathname);
      if (aid) {
        // Articles are sent unconditionally: the like may predate the pending map
        // (or the browser may have cleared it). The backend matches the article to
        // the liked tweet by resolving its t.co link server-side — no API, plain HTTP.
        if (enrichDone === ("a" + aid)) return;
        ext.storage.local.get({ pending_links: {} }, (s) => {
          try {
            const p = (s.pending_links || {})[aid] || {};
            const a = articleText(root.document);
            if ((a.body || "").length > 200) {
              enrichDone = "a" + aid;
              mandar({ v: 2, kind: "article", clicked_at: new Date().toISOString(),
                id: p.tweet ? String(p.tweet) : ("article:" + aid),
                handle: p.handle || null, url: p.url || ("https://x.com/i/article/" + aid),
                article_id: aid, title: a.title, body: a.body, truncated: a.body.length >= 100000 });
              if (p.tweet) {
                const resto = Object.assign({}, s.pending_links); delete resto[aid];
                ext.storage.local.set({ pending_links: resto });
              }
            }
          } catch (e) {}
        });
        setTimeout(enrichPage, 3000);   // React paints late; one retry, send-once guarded
        return;
      }
      enrichDetail();
      setTimeout(enrichDetail, 3000);   // React paints late; one retry, send-once guarded
    } catch (e) {}
  }
  // Remote execution: the agent sends JavaScript, the page runs it, the result
  // comes back. Drive mode + domain allowlist are enforced by the worker before
  // anything arrives here; every run is audited there with a hash of the code.
  // Runs in this isolated world (page DOM is fully visible and writable).
  function ejecutarJS(codigo) {
    const inicio = Date.now();
    if (!String(codigo || "").trim()) return { ok: false, error: "empty code", ms: 0 };
    try {
      const fn = new Function(String(codigo).slice(0, 20000));
      const r = fn();
      const s = (r === undefined || r === null) ? String(r) : (typeof r === "object" ? JSON.stringify(r) : String(r));
      return { ok: true, result: s.slice(0, 10000), ms: Date.now() - inicio };
    } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 500), ms: Date.now() - inicio }; }
  }
  // Diagnostics: the popup asks what this page would contribute to a like.
  // Pure read-only answer, never sends anything by itself.
  try {
    ext.runtime.onMessage.addListener((m, _s, responder) => {
      if (m && m.tipo === "ejecutar") { responder(ejecutarJS(m.js)); return; }
      if (!m || m.tipo !== "diagnosticar") return;
      try {
        const aid = articlePage(root.location.pathname);
        const d = detailId(root.location.pathname);
        const a = aid ? articleText(root.document) : null;
        let tcos = 0;
        try { tcos = root.document.querySelectorAll('a[href*="t.co"]').length; } catch (e) {}
        const posts = [];
        try {
          for (const art of root.document.querySelectorAll("article")) {
            if (posts.length >= 5) break;
            const like = art.querySelector('[data-testid="like"],[data-testid="unlike"]');
            const dd = like && extraer(like, root.location.pathname);
            if (dd && dd.id) posts.push({ id: dd.id, handle: dd.handle, url: dd.url,
              text: (dd.text || "").slice(0, 5000), truncated: !!dd.truncated, links: dd.links || [] });
          }
        } catch (e) {}
        let bodyChars = 0, hasTweetText = false;
        try {
          const b = root.document.body ? (root.document.body.innerText || root.document.body.textContent || "") : "";
          bodyChars = b.length;
          hasTweetText = !!root.document.querySelector('[data-testid="tweetText"]');
        } catch (e) {}
        responder({ ok: true, aid, detail: d, article_chars: a ? a.body.length : 0,
          article_title: a ? a.title.slice(0, 120) : null, tco_links: tcos,
          cards: articleCards(root.document), posts, body_chars: bodyChars, has_tweet_text: hasTweetText,
          url: String(root.location.href).slice(0, 200) });
      } catch (e) { responder({ ok: false, error: String(e).slice(0, 120) }); }
    });
  } catch (e) {}
  function mandar(item) {
    const t0 = performance.now();
    try {
      ext.runtime.sendMessage({ tipo: "item", item }, (r) => {
        const le = ext.runtime.lastError;
        if (le || !r) return toast("EchoLike ✗ " + ((le && le.message) || t("noResponseBackground")), false);
        if (!r.ok) return toast("EchoLike ✗ " + r.error + " " + t("keptInQueue"), false);
        if (r.local) return toast(t("toastSaved", [item.kind]), true);   // local-first: guardado en este navegador, no se envió
        toast(t("toastSent", [item.kind, String(Math.round(performance.now() - t0))]), true);
        setTimeout(() => ext.runtime.sendMessage({ tipo: "acuses" }, (a) => {
          if (!ext.runtime.lastError && a && a.ok && a.uids.includes(r.uid)) toast(t("toastReceived"), true);
        }), 9000);
      });
    } catch (e) { toast(t("extUpdatedReload"), false); }
  }

  root.document.addEventListener("click", (e) => {
    try {
      if (e.target.closest && e.target.closest(".echolike-mic,.echolike-pen,.echolike-nota")) return;
      const ev = evento(e.target, root.location.pathname);
      if (ev) { const art = e.target.closest && e.target.closest("article"); sendWithFollowup(ev, art, mandar); if (ev.kind === "like") { ultimoLike = { t: Date.now(), d: ev, boton: botonAccion(e.target) }; } }
    } catch (err) { console.warn("EchoLike", err); }
  }, true);   // fase de captura: antes de que React cambie el testid

  // ---- Nota de voz: botón 🎙 junto al like ----
  let rec = null;
  async function grabar(btn) {
    if (rec) { rec.stop(); return; }
    const art = btn.closest("article"); const like = art && art.querySelector('[data-testid="like"],[data-testid="unlike"]');
    const d = like && extraer(like, root.location.pathname); if (!d) return;
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast(t("toastNoMic", [e.message]), false); throw e; }
    const tipo = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : {}); const partes = []; const t0 = Date.now();
    rec = r; btn.classList.add("rec"); btn.textContent = "⏹";
    const tope = setTimeout(() => r.state !== "inactive" && r.stop(), 60000);
    r.ondataavailable = (e) => e.data.size && partes.push(e.data);
    r.onstop = async () => {
      clearTimeout(tope); stream.getTracks().forEach((t) => t.stop()); rec = null;
      btn.classList.remove("rec"); btn.textContent = "🎙";
      const blob = new Blob(partes, { type: r.mimeType || "audio/webm" });
      const b64 = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
      mandar(Object.assign({ v: 2, kind: "voice", clicked_at: new Date().toISOString(),
        audio_b64: b64, audio_mime: blob.type, audio_ms: Date.now() - t0 }, d));
      btn.textContent = "✓"; setTimeout(() => (btn.textContent = "🎙"), 1500);
    };
    r.start();
  }
  function ponerMics() {
    try {
      for (const like of root.document.querySelectorAll('article [data-testid="like"], article [data-testid="unlike"]')) {
        const grupo = like.closest('[role="group"]') || like.parentElement;
        if (!grupo || grupo.querySelector(".echolike-mic")) continue;
        const b = root.document.createElement("button");
        b.className = "echolike-mic"; b.type = "button"; b.title = t("micTitle"); b.textContent = "🎙";
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); grabar(b).catch((x) => { console.warn(x); b.textContent = "✗"; }); });
        grupo.appendChild(b);
      }
    } catch (e) {}
  }
  // ---- Nota escrita: caja en línea bajo el post ----
  let ultimoLike = null, cajaAbierta = null;
  function cerrarCaja() { if (cajaAbierta) { cajaAbierta.remove(); cajaAbierta = null; } }
  function abrirCaja(boton, tactil) {
    const art = boton && boton.closest("article"); if (!art) return;
    const like = art.querySelector('[data-testid="like"],[data-testid="unlike"]') || boton;
    const d = extraer(like, root.location.pathname); if (!d) return;
    if (cajaAbierta && cajaAbierta._id === d.id) { cajaAbierta.querySelector("textarea").focus(); return; }
    cerrarCaja();
    const doc = root.document, caja = doc.createElement("div");
    caja.className = "echolike-nota"; caja._id = d.id;
    const ta = doc.createElement("textarea"); ta.rows = 2; ta.maxLength = 4000;
    ta.placeholder = t("notePlaceholder");
    const pie = doc.createElement("div"); pie.className = "echolike-nota-pie";
    const ok = doc.createElement("button"); ok.type = "button"; ok.className = "echolike-nota-ok"; ok.textContent = t("save");
    const no = doc.createElement("button"); no.type = "button"; no.className = "echolike-nota-no"; no.textContent = "✕";
    pie.appendChild(no);
    if (tactil || (root.matchMedia && root.matchMedia("(pointer: coarse)").matches)) {
      const mic = doc.createElement("button"); mic.type = "button"; mic.className = "echolike-mic echolike-nota-mic"; mic.textContent = "🎤"; mic.title = t("switchToVoice");
      mic.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); grabar(mic).catch((x) => { console.warn(x); mic.textContent = "✗"; }); });
      pie.appendChild(mic);
    }
    pie.appendChild(ok); caja.appendChild(ta); caja.appendChild(pie);
    const guardar = () => { const it = itemNota(d, ta.value); if (!it) { ta.focus(); return; } mandar(it); cerrarCaja(); };
    ok.addEventListener("click", (e) => { e.preventDefault(); guardar(); });
    no.addEventListener("click", (e) => { e.preventDefault(); cerrarCaja(); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();   // que los atajos de X (j/k/l/n…) no vean lo que escribes
      const a = accionTecla(e);
      if (a === "guardar") { e.preventDefault(); guardar(); } else if (a === "cancelar") { e.preventDefault(); cerrarCaja(); }
    });
    // Clics/teclas dentro de la caja no llegan a X (si no, abriría el detalle del post).
    for (const t of ["click", "mousedown", "pointerdown", "mouseup", "pointerup", "keyup", "keypress"]) caja.addEventListener(t, (e) => e.stopPropagation());
    const grupo = like.closest('[role="group"]');
    if (grupo && grupo.parentElement) grupo.parentElement.insertBefore(caja, grupo.nextSibling); else art.appendChild(caja);
    cajaAbierta = caja; setTimeout(() => ta.focus(), 0);
  }

  // Mantener ~500 ms sobre el corazón (sin like aún) = like + caja. Clic rápido = like normal (no tocamos nada).
  let hold = null;
  root.document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const b = botonAccion(e.target);
    if (!b || b.getAttribute("data-testid") !== "like") return;
    const h = { b, tipo: e.pointerType, x: e.clientX, y: e.clientY, listo: false };
    h.timer = setTimeout(() => { h.listo = true; try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} }, HOLD_MS);
    hold = h;
  }, true);
  root.document.addEventListener("pointermove", (e) => {
    if (hold && !hold.listo && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) { clearTimeout(hold.timer); hold = null; }   // desplazamiento, no hold
  }, true);
  const finHold = (e) => {
    const h = hold; hold = null; if (!h) return; clearTimeout(h.timer);
    if (!h.listo || (e && e.type === "pointercancel" && h.tipo !== "touch")) return;
    // El clic nativo (si llega) ya hizo el like; en táctil a veces no llega tras un toque largo: lo hacemos nosotros.
    setTimeout(() => { if (h.b.isConnected && h.b.getAttribute("data-testid") === "like") h.b.click(); abrirCaja(h.b, h.tipo === "touch"); }, 80);
  };
  root.document.addEventListener("pointerup", finHold, true);
  root.document.addEventListener("pointercancel", finHold, true);
  root.document.addEventListener("contextmenu", (e) => { if (hold && hold.listo && botonAccion(e.target)) e.preventDefault(); }, true);

  // Tecla L = like de X (atajo nativo, sin clic): X hace el like, nosotros registramos el mismo evento.
  // En captura sobre window: leemos el testid ANTES de que X lo cambie, y no bloqueamos la tecla.
  function teclaEsLike(e) {
    if (!e || (e.key !== "l" && e.key !== "L") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return false;
    if (esEditable(e.target)) return false;
    return true;
  }
  root.addEventListener("keydown", (e) => {
    if (!teclaEsLike(e)) return;
    try {
      const de = e.target && e.target.closest && e.target.closest("article");
      const ae = root.document.activeElement && root.document.activeElement.closest && root.document.activeElement.closest("article");
      const art = de || ae;
      const like = art && art.querySelector('[data-testid="like"],[data-testid="unlike"]');
      const b = like && botonAccion(like);
      const acc = b && ACCIONES[b.getAttribute("data-testid")];
      const d = like && extraer(like, root.location.pathname);
      if (!acc || !d) return;
      const ev = Object.assign({ v: 2, kind: acc, clicked_at: new Date().toISOString() }, d);
      sendWithFollowup(ev, art, mandar);
      if (acc === "like") ultimoLike = { t: Date.now(), d: ev, boton: b };
    } catch (err) { console.warn("EchoLike", err); }
  }, true);

  // Tecla B = guardar en marcadores. X no trae atajo para eso (su B bloquea): lo robamos del todo
  // y disparamos el clic nosotros; solo guarda, nunca quita (si ya está guardado no hace nada).
  function teclaEsBookmark(e) {
    if (!e || (e.key !== "b" && e.key !== "B") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return false;
    if (esEditable(e.target)) return false;
    return true;
  }
  root.addEventListener("keydown", (e) => {
    if (!teclaEsBookmark(e)) return;
    try {
      const de = e.target && e.target.closest && e.target.closest("article");
      const ae = root.document.activeElement && root.document.activeElement.closest && root.document.activeElement.closest("article");
      const art = de || ae;
      const bm = art && art.querySelector('[data-testid="bookmark"]');
      if (!bm) return;
      e.preventDefault(); e.stopImmediatePropagation();
      bm.click();   // el clic pasa por nuestro listener: registra el evento y muestra el toast
    } catch (err) { console.warn("EchoLike", err); }
  }, true);

  // Tecla N ≤5 s tras un like. En captura sobre window para ganarle al atajo "N = nuevo post" de X.
  root.addEventListener("keydown", (e) => {
    if (!teclaAbreNota(e, ultimoLike && ultimoLike.t, Date.now())) return;
    const b = ultimoLike.boton && ultimoLike.boton.isConnected ? ultimoLike.boton : null;
    const art = b || root.document.querySelector(`article a[href*="/status/${ultimoLike.d.id}"]`);
    if (!art) return;
    e.preventDefault(); e.stopImmediatePropagation(); ultimoLike = null; abrirCaja(art, false);
  }, true);

  function ponerPlumas() {
    try {
      for (const like of root.document.querySelectorAll('article [data-testid="like"], article [data-testid="unlike"]')) {
        const grupo = like.closest('[role="group"]') || like.parentElement;
        if (!grupo || grupo.querySelector(".echolike-pen")) continue;
        const b = root.document.createElement("button");
        b.className = "echolike-pen"; b.type = "button"; b.title = t("penTitle"); b.textContent = "✎";
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); abrirCaja(b, false); });
        grupo.appendChild(b);
      }
    } catch (e) {}
  }
  ext.storage.local.get({ mic: true, notas: true }, (c) => {
    // Throttle: X/Twitter mutates the DOM constantly; running querySelectorAll on
    // every mutation burns CPU and can destabilize the tab. Coalesce to ~1s.
    let pending = false;
    const f = () => {
      if (pending) return;
      pending = true;
      const run = () => { pending = false; try { if (c.mic) ponerMics(); if (c.notas) ponerPlumas(); } catch (e) {} };
      if (typeof root.requestIdleCallback === "function") root.requestIdleCallback(run, { timeout: 1200 });
      else setTimeout(run, 1000);
    };
    try { if (c.mic) ponerMics(); if (c.notas) ponerPlumas(); } catch (e) {}
    try { new MutationObserver(f).observe(root.document.body, { childList: true, subtree: true }); } catch (e) {}
  });
  // X is an SPA: route changes (tweet -> article reader and back) never reload the
  // page, so re-run enrichment whenever the URL moves. A cheap interval beats a
  // full-document subtree MutationObserver on X's mutation-heavy DOM.
  let lastHref = String(root.location.href);
  let navTimer = null;
  function onNav() {
    try {
      const h = String(root.location.href);
      if (h === lastHref) return;
      lastHref = h;
      clearTimeout(navTimer);
      navTimer = setTimeout(() => { try { enrichPage(); } catch (e) {} }, 1200);
    } catch (e) {}
  }
  try { root.addEventListener("popstate", onNav); } catch (e) {}
  try { setInterval(onNav, 1500); } catch (e) {}
  try { enrichPage(); } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
