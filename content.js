// EchoLike v2.2 — content script (notas escritas: mantener ~500 ms, tecla N, ✎) en x.com. Detecta clics en Like/Bookmark y los manda al background (que los guarda en local; solo los envía si el usuario activó sync).
(function (root) {
  const ACCIONES = { like: "like", unlike: "unlike", bookmark: "bookmark", removeBookmark: "unbookmark" };

  function botonAccion(target) {
    const el = target && target.closest && target.closest('[data-testid]');
    let b = el;
    while (b && !ACCIONES[b.getAttribute("data-testid")]) b = b.parentElement && b.parentElement.closest('[data-testid]');
    return b || null;
  }

  // Extrae datos del tweet que contiene el botón. Pura: solo DOM, testeable con fixtures.
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
    return {
      id: m[2], handle: m[1], url: `https://x.com/${m[1]}/status/${m[2]}`,
      text: txtEl ? txtEl.innerText || txtEl.textContent || "" : "",
      tweet_time: time ? time.getAttribute("datetime") : null
    };
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
    const { id, handle, url, text, tweet_time } = d;
    return { v: 2, kind: "nota_texto", type: "nota_texto", clicked_at: new Date().toISOString(),
      nota: t.slice(0, 4000), origen: origen || "caja", id, handle, url, text, tweet_time };
  }
  // Teclas dentro de la caja: Enter guarda, Shift+Enter salto de línea, Esc cancela.
  function accionTecla(e) {
    if (e.key === "Escape") return "cancelar";
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) return "guardar";
    return null;
  }

  const api = { botonAccion, extraer, evento, ACCIONES, esEditable, teclaAbreNota, teclaEsLike, teclaEsBookmark, itemNota, accionTecla, HOLD_MS, N_MS };
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
      if (ev) { mandar(ev); if (ev.kind === "like") { ultimoLike = { t: Date.now(), d: ev, boton: botonAccion(e.target) }; } }
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
    for (const like of root.document.querySelectorAll('article [data-testid="like"], article [data-testid="unlike"]')) {
      const grupo = like.closest('[role="group"]') || like.parentElement;
      if (!grupo || grupo.querySelector(".echolike-mic")) continue;
      const b = root.document.createElement("button");
      b.className = "echolike-mic"; b.type = "button"; b.title = t("micTitle"); b.textContent = "🎙";
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); grabar(b).catch((x) => { console.warn(x); b.textContent = "✗"; }); });
      grupo.appendChild(b);
    }
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
      mandar(ev);
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
    for (const like of root.document.querySelectorAll('article [data-testid="like"], article [data-testid="unlike"]')) {
      const grupo = like.closest('[role="group"]') || like.parentElement;
      if (!grupo || grupo.querySelector(".echolike-pen")) continue;
      const b = root.document.createElement("button");
      b.className = "echolike-pen"; b.type = "button"; b.title = t("penTitle"); b.textContent = "✎";
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); abrirCaja(b, false); });
      grupo.appendChild(b);
    }
  }
  ext.storage.local.get({ mic: true, notas: true }, (c) => {
    const f = () => { if (c.mic) ponerMics(); if (c.notas) ponerPlumas(); };
    f(); new MutationObserver(f).observe(root.document.body, { childList: true, subtree: true });
  });
})(typeof window !== "undefined" ? window : globalThis);
