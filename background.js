// EchoLike v2.7 — background. Local-first: todo se guarda en storage.local de este navegador y NADA sale de él
// salvo que el usuario active «sync» (opt-in). Con sync: cola persistente, cifra (AES-GCM), publica en ntfy.sh, lee acuses del receptor.
const ext = typeof browser !== "undefined" ? browser : chrome;
const t = (k, s) => { try { const m = ext && ext.i18n && ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const MAXEV = 20;

function parseCodigo(raw) {
  const s = String(raw || "").replace(/\s+/g, "").replace(/^["'`]+|["'`]+$/g, "");
  const p = s.split("|");
  if (p.length !== 4 || p[0] !== "EL2") return { error: t("errInvalidCode") };
  const [, servidor, topic, clave] = p;
  if (!/^https:\/\/[^/]+$/.test(servidor)) return { error: t("errInvalidServer") };
  try { if (unb64(clave).length !== 32) return { error: t("errInvalidKey") }; } catch (e) { return { error: t("errKeyNotBase64") }; }
  return { servidor, topic, clave };
}
async function syncOn() { await migrar(); return !!(await ext.storage.local.get({ sync: false })).sync; }
const INBOX_DEFAULT = "";
// Zero-config bootstrap: install-and-done. The extension probes these in order
// (saved server first — sticky, never silently move data — then same-machine,
// then the directory mirror) and claims a token by itself. Paste stays as fallback.
const INBOX_CANDIDATES = ["http://127.0.0.1:8911"];
const INBOX_DIRECTORY_URL = "https://echolike.app/inbox-servers.json";
async function sondear(url, ms) {
  const t0 = Date.now();
  const c = new AbortController();
  const to = setTimeout(() => { try { c.abort(); } catch (e) {} }, ms || 2000);
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/api/health", { cache: "no-store", signal: c.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.ok) return null;
    return { url: url.replace(/\/$/, ""), rtt: Date.now() - t0, api: j.api || 1 };
  } catch (e) { return null; }
  finally { clearTimeout(to); }
}
async function autoconectar(origen) {
  // 1. sticky: the server the user already chose wins if it still answers
  const g = await ext.storage.local.get({ inbox_url: INBOX_DEFAULT, device_token: "" });
  if (g.inbox_url && g.device_token) {
    const h = await sondear(g.inbox_url, 2500);
    if (h) return { ok: true, inbox_url: g.inbox_url, sticky: true };
  }
  // 2. same-machine candidates (desktop: no paste needed)
  const vistos = [];
  for (const c of INBOX_CANDIDATES) {
    const h = await sondear(c, 1500);
    if (h && (h.api || 1) >= 2) vistos.push(h);
  }
  // 3. directory mirror (discovery only: every entry is probed, latency ranks)
  try {
    const dir = origen === "local" ? null : await (await fetch(INBOX_DIRECTORY_URL, { cache: "no-store" })).json();
    const lista = (dir && dir.servers) || [];
    for (const s of lista) {
      if (!s || !s.url) continue;
      const h = await sondear(s.url, 2000);
      if (h && (h.api || 1) >= 2) vistos.push(h);
    }
  } catch (e) { /* offline directory: keep what we have */ }
  vistos.sort((a, b) => a.rtt - b.rtt);
  for (const h of vistos) {
    try {
      const r = await fetch(h.url + "/api/claim", { method: "POST" });
      const j = await r.json();
      if (j && j.device_token) {
        await ext.storage.local.set({ inbox_url: h.url, device_token: j.device_token, transport: "direct", sync: true });
        return { ok: true, inbox_url: h.url, user_id: j.user_id || null };
      }
    } catch (e) { /* try the next candidate */ }
  }
  return { ok: false, error: t("errCantReach") };
}
async function transporte() {
  await migrar();
  const s = await ext.storage.local.get({ transport: "direct", inbox_url: INBOX_DEFAULT, device_token: "" });
  return s.transport || "direct";
}
async function cfgDirect() {
  const s = await ext.storage.local.get({ inbox_url: INBOX_DEFAULT, device_token: "" });
  const url = (s.inbox_url || "").replace(/\/$/, "");
  try { const u = new URL(url); if (u.port === "8904") return { error: t("errIsVault") }; } catch (e) {}
  if (!/^https?:\/\/[^/]+$/.test(url) && !/^https?:\/\/[^/]+\/[^\s]*$/.test(url)) return { error: t("errBadInboxUrl") };
  if (!s.device_token) return { error: t("errNoToken") };
  return { inbox_url: url, device_token: s.device_token };
}
// Phone clocks are not in sync with the PC (measured: ~300 ms), and that error lands in every
// latency the server computes. /api/health returns its own now_ms, so the offset is measured
// here (three samples, keep the one with the shortest round trip) instead of guessed.
async function medirDesfase(c) {
  let best = null;
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${c.inbox_url}/api/health`, { cache: "no-store" });
      const j = await r.json();
      const t1 = Date.now();
      if (typeof j.now_ms === "number") {
        const rtt = t1 - t0;
        const off = Math.round(j.now_ms + rtt / 2 - t1);
        if (best === null || rtt < best.rtt) best = { off, rtt };
      }
    } catch (e) { /* keep whatever sample we have */ }
  }
  if (best !== null) await ext.storage.local.set({ clock_offset_ms: best.off, clock_offset_rtt: best.rtt, clock_offset_at: new Date().toISOString() });
  return best === null ? null : best.off;
}

async function pingDirecto(c) {
  const r = await fetch(`${c.inbox_url}/api/health`, { headers: { authorization: `Bearer ${c.device_token}` } });
  if (!r.ok) throw new Error("inbox HTTP " + r.status);
  medirDesfase(c).catch(() => {});
  return { ok: true };
}
async function publicarDirecto(items, c) { // batch POST; confirmation arrives in the same response
  // Latency the server cannot see: from the click to the moment the like leaves this device.
  // clicked_at and Date.now() are the same clock, so the number is honest even if the clock is off.
  const t0 = Date.now();
  const { clock_offset_ms } = await ext.storage.local.get({ clock_offset_ms: null });
  const conLat = items.map((it) => {
    const c0 = Date.parse(it.clicked_at);
    return Object.assign({}, it, {
      sent_ms: isNaN(c0) ? null : Math.max(0, t0 - c0),
      clock_offset_ms: typeof clock_offset_ms === "number" ? clock_offset_ms : null,
      queued: items.length,
    });
  });
  const r = await fetch(`${c.inbox_url}/api/likes`, {
    method: "POST", headers: { authorization: `Bearer ${c.device_token}`, "content-type": "application/json" },
    body: JSON.stringify({ items: conLat, post_ms: Date.now() - t0 }),
  });
  if (r.status === 401) throw new Error(t("errBadToken"));
  if (r.status === 429) {
    let body = "";
    try { body = await r.text(); } catch (e) {}
    let quota = false;
    try { quota = (JSON.parse(body) || {}).error === "quota_exceeded"; } catch (e) {}
    if (quota) { const e = new Error(t("errQuotaSpent")); e.code = "quota_spent"; throw e; }
    throw new Error("inbox HTTP 429");
  }
  if (!r.ok) throw new Error("inbox HTTP " + r.status + " " + (await r.text()).slice(0, 120));
  const out = await r.json();
  return new Set((out.received || []).map((x) => x.id + "|" + x.kind));
}
async function cfg() {
  let c = await ext.storage.local.get({ codigo: "", sync: false });
  if (!c.codigo && !c.sync) return { error: t("errSyncOff") };   // sin sync no se crean credenciales ni se habla con ningún servidor
  if (!c.codigo) { // primer arranque: genera sus credenciales; el usuario las activa con /par en el bot (nadie memoriza nada)
    c.codigo = "EL2|https://ntfy.sh|el2_" + crypto.randomUUID().replace(/-/g, "") + "|" + b64(crypto.getRandomValues(new Uint8Array(32)));
    await ext.storage.local.set({ codigo: c.codigo });
  }
  return parseCodigo(c.codigo);
}
async function clave(c, uso) { return crypto.subtle.importKey("raw", unb64(c.clave), "AES-GCM", false, [uso]); }
async function cifrar(obj, c) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await clave(c, "encrypt"), new TextEncoder().encode(JSON.stringify(obj))));
  return "EL1." + b64(iv) + "." + b64(ct);
}
async function descifrar(s, c) {
  const [, iv, ct] = s.trim().split(".");
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await clave(c, "decrypt"), unb64(ct))));
}
async function badge() { // contador rojo en el icono mientras haya eventos fallando
  const { cola } = await ext.storage.local.get({ cola: [] });
  const n = cola.length;
  try { ext.action.setBadgeText({ text: n ? String(n) : "" }); if (n) ext.action.setBadgeBackgroundColor({ color: "#d0021b" }); } catch (e) {}
}
async function anotar(item, estado, error) {
  const st = await ext.storage.local.get({ eventos: [] });
  let ev = st.eventos.find((e) => e.uid === item.uid);
  if (!ev) { ev = { uid: item.uid, kind: item.kind, id: item.id || null, handle: item.handle || null, at: item.clicked_at }; st.eventos.unshift(ev); }
  if (!(ev.estado === "recibido" && estado !== "recibido")) ev.estado = estado;
  ev.error = error || null; ev.t = new Date().toISOString();
  await ext.storage.local.set({ eventos: st.eventos.slice(0, MAXEV), ultimo: ev });
  if ((estado === "en cola" || estado === "guardado") && (item.kind === "like" || item.kind === "bookmark")) { // contador «hoy» (fecha local)
    const s = await ext.storage.local.get({ hoy: null }); const d = new Date().toLocaleDateString("en-CA");
    const h = s.hoy && s.hoy.d === d ? s.hoy : { d, likes: 0, bookmarks: 0 };
    h[item.kind === "like" ? "likes" : "bookmarks"]++;
    await ext.storage.local.set({ hoy: h });
  }
  badge();
}
async function publicar(item, c) {
  item.sent_at = new Date().toISOString();
  const cuerpo = await cifrar(item, c);
  const grande = cuerpo.length > 3900;   // ntfy: >4KB va como adjunto (voz)
  const r = await fetch(`${c.servidor}/${c.topic}`, { method: grande ? "PUT" : "POST", body: cuerpo, headers: grande ? { Filename: "echolike.txt" } : {} });
  if (!r.ok) throw new Error("ntfy HTTP " + r.status + " " + (await r.text()).slice(0, 120));
}
// Cola en storage: sobrevive a que Chrome duerma el service worker.
async function encolar(item) { const s = await ext.storage.local.get({ cola: [] }); s.cola.push(item); await ext.storage.local.set({ cola: s.cola }); }
// ---- Enrichment links (v2.10): resolve t.co without any API, using plain HTTP.
// A 301 from t.co is public (no login needed). Article/thread targets become pending
// entries: when the reader later opens that page, content.js scrapes the rendered
// text (their own logged-in session) and sends it back as kind "article"/"followup".
const RESOLVER_MS = 6000;
async function resolverEnlace(href) {
  try {
    const r = await Promise.race([fetch(href, { redirect: "manual" }), new Promise((_, no) => setTimeout(() => no(new Error("t")), RESOLVER_MS))]);
    const loc = r.headers && r.headers.get && r.headers.get("location");
    if (loc) return String(loc).slice(0, 500);
  } catch (e) {}
  return null;
}
async function resolverEnlaces(item) {
  try {
    const links = item && item.links;
    if (!item || !Array.isArray(links) || !links.length) return item;
    for (const l of links) {
      if (!l || l.resuelto || typeof l.href !== "string" || l.href.indexOf("https://t.co/") !== 0) continue;
      const url = await resolverEnlace(l.href);
      if (url) l.resuelto = url;
    }
    const arts = links.map((l) => l.resuelto || "").filter((u) => /\/i\/article\/(\d+)/.test(u));
    if (arts.length && (item.kind === "like" || item.kind === "bookmark") && item.id) {
      const s = await ext.storage.local.get({ pending_links: {} });
      const p = s.pending_links || {};
      for (const u of arts) { const m = u.match(/\/i\/article\/(\d+)/); if (m) p[m[1]] = { tweet: String(item.id), handle: item.handle || null, url: u, at: new Date().toISOString() }; }
      const ks = Object.keys(p).slice(-50);   // bounded: the map is a hint, not an archive
      const rec = {}; for (const k of ks) rec[k] = p[k];
      await ext.storage.local.set({ pending_links: rec });
    }
  } catch (e) {}
  return item;
}
let vaciando = null;
async function vaciarLegacy(cola) { // ntfy path, unchanged from 2.7
  const c = await cfg(); const { ntfy429hasta } = await ext.storage.local.get({ ntfy429hasta: 0 }); let res = { ok: true };
  if (Date.now() < (ntfy429hasta || 0)) return { ok: false, error: t("errNtfy429") };
  if (c.error) { for (const it of cola) await anotar(it, "error", c.error); return { ok: false, error: c.error }; }
  while (cola.length) {
    const it = cola[0];
    try { await publicar(it, c); await anotar(it, "enviado"); cola.shift(); await ext.storage.local.set({ ntfy429hasta: 0, ntfy429msg: "" }); }
    catch (e) { const msg = String(e.message || e); it.intentos = (it.intentos || 0) + 1; await anotar(it, "error", msg); res = { ok: false, error: msg };
      if (/ntfy HTTP 429/.test(msg)) await ext.storage.local.set({ ntfy429hasta: Date.now() + 10 * 60 * 1000, ntfy429msg: msg.slice(0, 160) });
      if (it.intentos >= 30) cola.shift();   // reintenta por alarma cada minuto, hasta 30 veces
      break; }
  }
  return res;
}
function proximaMedianoche() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); } // local midnight: the priced quota resets daily
async function vaciarDirecto(cola) { // Worker path: one batch POST, received in the same response
  const c = await cfgDirect();
  if (c.error) { for (const it of cola) await anotar(it, "error", c.error); return { ok: false, error: c.error }; }
  const { quota429hasta, quota429msg } = await ext.storage.local.get({ quota429hasta: 0, quota429msg: "" });
  if (Date.now() < (quota429hasta || 0)) return { ok: false, error: quota429msg || t("errQuotaSpent"), fallback: false }; // parked: quota resets at midnight, no fetch, no retries
  try {
    const ok = await publicarDirecto(cola, c);
    for (const it of [...cola]) {
      if (ok.has(it.id + "|" + it.kind)) { await anotar(it, "recibido"); cola.shift(); }
      else { await anotar(it, "error", "inbox skipped item"); it.intentos = (it.intentos || 0) + 1; if (it.intentos >= 30) cola.shift(); break; }
    }
    await ext.storage.local.set({ quota429hasta: 0, quota429msg: "" });
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if ((e && e.code) === "quota_spent") { // priced quota spent: park until local midnight, keep the queue for tomorrow
      for (const it of cola) await anotar(it, "error", msg);
      await ext.storage.local.set({ quota429hasta: proximaMedianoche(), quota429msg: msg.slice(0, 160) });
      return { ok: false, error: msg, fallback: false };
    }
    for (const it of cola) { it.intentos = (it.intentos || 0) + 1; await anotar(it, "error", msg); }
    while (cola.length && (cola[0].intentos || 0) >= 30) cola.shift();
    return { ok: false, error: msg, fallback: /inbox HTTP (429|5\d\d)/.test(msg) || /Failed to fetch|NetworkError/.test(msg) };
  }
}
async function vaciar() {
  if (vaciando) return vaciando;
  vaciando = (async () => {
    const mode = await transporte();
    const { cola } = await ext.storage.local.get({ cola: [] });
    if (!cola.length) return { ok: true };
    if (mode === "legacy") { const r = await vaciarLegacy(cola); await ext.storage.local.set({ cola }); return r; }
    const r = await vaciarDirecto(cola);
    if (!r.ok && r.fallback && mode === "both") { const r2 = await vaciarLegacy(cola); await ext.storage.local.set({ cola }); return r2; }
    await ext.storage.local.set({ cola }); return r;
  })();
  try { return await vaciando; } finally { vaciando = null; }
}
// ---- Almacén local (fuente de verdad): lista de items en storage.local["datos"] ----
let guardando = Promise.resolve();
function guardarLocal(item) {
  guardando = guardando.then(async () => {
    const { datos } = await ext.storage.local.get({ datos: [] });
    if (!datos.some((d) => d.uid === item.uid)) { datos.push(Object.assign({ saved_at: new Date().toISOString() }, item)); await ext.storage.local.set({ datos }); }
  }).catch(() => {});
  return guardando;
}
const FORMATO = "echolike-export";
async function exportar() {
  const { datos } = await ext.storage.local.get({ datos: [] });
  return { ok: true, data: { format: FORMATO, format_version: 1, extension_version: ext.runtime.getManifest().version, exported_at: new Date().toISOString(), count: datos.length, items: datos } };
}
async function importar(obj) {
  if (!obj || obj.format !== FORMATO || !Array.isArray(obj.items)) return { ok: false, error: t("errImportFormat") };
  let n = 0;
  await (guardando = guardando.then(async () => {
    const { datos } = await ext.storage.local.get({ datos: [] }); const vistos = new Set(datos.map((d) => d.uid));
    for (const it of obj.items) if (it && typeof it === "object" && it.uid && typeof it.kind === "string" && !vistos.has(it.uid)) { datos.push(it); vistos.add(it.uid); n++; }
    await ext.storage.local.set({ datos });
  }));
  return { ok: true, added: n, total: obj.items.length };
}
async function enviar(item) {
  item.uid = item.uid || crypto.randomUUID();
  if (item.kind !== "ping") await guardarLocal(item);
  if (!(await syncOn())) { if (item.kind === "ping") return { ok: false, uid: item.uid, error: t("errSyncOff") }; await anotar(item, "guardado"); return { ok: true, uid: item.uid, local: true }; }
  const mode = await transporte();
  if (item.kind === "ping" && mode !== "legacy") { // direct ping = inbox health check, never queued
    try { const c = await cfgDirect(); if (c.error) return { ok: false, uid: item.uid, error: c.error }; await pingDirecto(c); await anotar(item, "recibido"); return { ok: true, uid: item.uid, direct: true }; }
    catch (e) { const msg = String(e.message || e); await anotar(item, "error", msg); return { ok: false, uid: item.uid, error: msg }; }
  }
  if (item.kind === "like" || item.kind === "bookmark") {
    await resolverEnlaces(item);
    if (item.truncated && item.id) {   // detail-page re-capture list: bounded, ids only
      const s = await ext.storage.local.get({ truncated_recent: [] });
      const l = (s.truncated_recent || []).filter((x) => x && String(x.id) !== String(item.id));
      l.push({ id: String(item.id), chars: (item.text || "").length, at: new Date().toISOString() });
      await ext.storage.local.set({ truncated_recent: l.slice(-50) });
    }
  }
  await anotar(item, "en cola"); await encolar(item);
  const r = await vaciar(); return Object.assign({ uid: item.uid }, r);
}
// ---- Diagnostics (v2.11): the popup hands a URL, the worker runs the same
// capture path the like flow uses and reports every step. The trace ships as a
// kind:diagnostico item through the normal pipeline, so extension, inbox and
// backend all keep the same record; the backend drops a review file for the agent.
const DIAG_MS = 8000;
const espera = (ms) => new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms));
async function diagnosticar(url) {
  const trace = { at: new Date().toISOString(), version: ext.runtime.getManifest().version, url: String(url || "").slice(0, 500) };
  try {
    const u = trace.url;
    trace.es_tco = /https?:\/\/t\.co\//.test(u);
    let fin = u;
    if (trace.es_tco) {
      try {
        const r = await Promise.race([fetch(u, { redirect: "manual" }), espera(DIAG_MS)]);
        fin = (r.headers && r.headers.get && r.headers.get("location")) || u;
        trace.resuelto = String(fin).slice(0, 500);
      } catch (e) { trace.error_resolver = String((e && e.message) || e).slice(0, 120); }
    }
    let m = String(fin).match(/\/i\/article\/(\d+)/);
    trace.es_articulo = (m && m[1]) || null;
    if (!trace.es_articulo) { m = String(fin).match(/\/status\/(\d+)/); trace.es_tweet = (m && m[1]) || null; }
    trace.sync = await syncOn();
    trace.transport = await transporte();
    trace.pagina = null;
    try {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      trace.tab = tab && tab.url ? String(tab.url).slice(0, 200) : null;
      if (tab && tab.id != null && /^https:\/\/(x\.com|twitter\.com|mobile\.(x|twitter)\.com)\//.test(trace.tab || "")) {
        trace.pagina = await Promise.race([ext.tabs.sendMessage(tab.id, { tipo: "diagnosticar" }), espera(DIAG_MS)]);
      }
    } catch (e) { trace.pagina = { error: String((e && e.message) || e).slice(0, 160) }; }
  } catch (e) { trace.error = String((e && e.message) || e).slice(0, 160); }
  const item = { v: 2, kind: "diagnostico", clicked_at: trace.at, url: trace.url,
    id: "diag-" + Date.now().toString(36), traza: trace, text: JSON.stringify(trace).slice(0, 5000) };
  const r = await enviar(item);
  return Object.assign({ uid: item.uid, trace }, r);
}
async function acuses() {
  if (!(await syncOn())) return { ok: true, uids: [], nuevos: 0, local: true };
  if ((await transporte()) === "direct") return { ok: true, uids: [], nuevos: 0, direct: true }; // confirmations already inline
  const c = await cfg(); if (c.error) return { ok: false, error: c.error };
  const r = await fetch(`${c.servidor}/${c.topic}_ack/json?poll=1&since=6h`);
  if (r.status === 429) return { ok: false, error: t("errAck429") };
  if (!r.ok) return { ok: false, error: "ack HTTP " + r.status };
  const uids = new Set();
  for (const l of (await r.text()).split("\n")) {
    if (!l.trim()) continue; const m = JSON.parse(l); if (m.event !== "message") continue;
    try { (await descifrar(m.message, c)).uids.forEach((u) => uids.add(u)); } catch (e) {}
  }
  const st = await ext.storage.local.get({ eventos: [] }); let n = 0;
  for (const e of st.eventos) if (uids.has(e.uid) && e.estado !== "recibido") { e.estado = "recibido"; n++; }
  await ext.storage.local.set({ eventos: st.eventos, ultimo_ack: new Date().toISOString() }); return { ok: true, uids: [...uids], nuevos: n };
}
ext.runtime.onMessage.addListener((m, _s, responder) => {
  const p = m && m.tipo === "item" ? enviar(m.item)
    : m && m.tipo === "diagnostico" ? diagnosticar(m.url)
: m && m.tipo === "selftest" ? autoPrueba("manual")
: m && m.tipo === "auditar" ? auditar(m.accion, m.detalle, "user").then(() => ({ ok: true }))
    : m && m.tipo === "prueba" ? enviar({ v: 2, kind: "ping", prueba: true, clicked_at: new Date().toISOString() })
    : m && m.tipo === "acuses" ? acuses()
    : m && m.tipo === "validar" ? Promise.resolve(parseCodigo(m.codigo))
    : m && m.tipo === "exportar" ? exportar()
    : m && m.tipo === "importar" ? importar(m.data)
    : m && m.tipo === "sync" ? (async () => { await ext.storage.local.set({ sync: !!m.on }); if (m.on && (await transporte()) !== "direct") await cfg(); return { ok: true, sync: !!m.on }; })()
    : m && m.tipo === "transport" ? ext.storage.local.set({ transport: m.mode }).then(() => ({ ok: true, transport: m.mode }))
    : m && m.tipo === "directConfig" ? (async () => { const cur = await ext.storage.local.get({ inbox_url: "", device_token: "" }); const patch = {}; if (m.inbox_url) patch.inbox_url = String(m.inbox_url); if (m.device_token) patch.device_token = String(m.device_token); await ext.storage.local.set(patch); return { ok: true }; })()
    : m && m.tipo === "autoconectar" ? autoconectar(m.origen) : null;
  if (!p) return;
  p.then(responder, (e) => responder({ ok: false, error: String(e && e.message || e) })); return true;
});
// Migración a 2.7 (local-first), en cada arranque hasta decidirla una vez: quien ya enviaba en ≤2.6.3
// (tiene código + eventos enviados/recibidos) conserva el sync encendido. Instalación nueva: apagado (2.7 no crea código).
let migrada = null;
function migrar() {
  return migrada = migrada || (async () => {
    const st = await ext.storage.local.get(["sync", "codigo", "eventos"]);
    if (st.sync !== undefined) return;
    const yaEnviaba = !!st.codigo && (st.eventos || []).some((e) => e.estado === "recibido" || (e.estado === "enviado" && e.kind !== "ping"));
    await ext.storage.local.set(Object.assign({ sync: yaEnviaba }, st.transport === undefined ? { transport: yaEnviaba ? "legacy" : "direct" } : null));
  })();
}
migrar();
function alarmas() { ext.alarms.create("latido", { periodInMinutes: 30 }); ext.alarms.create("reintento", { periodInMinutes: 1 }); }
alarmas();
ext.alarms.onAlarm.addListener((a) => {
  syncOn().then((on) => { if (!on) return;   // sin sync: cero tráfico de fondo
    if (a.name === "latido") enviar({ v: 2, kind: "ping", clicked_at: new Date().toISOString() });
    if (a.name === "reintento") ext.storage.local.get({ cola: [] }).then((s) => { if (s.cola.length) vaciar(); }); });
});
// Al instalar/actualizar: inyectar en pestañas de X ya abiertas (si no, no detecta nada hasta recargar).
ext.runtime.onInstalled.addListener(async (det) => {
  alarmas();
  await migrar();
  if (!ext.scripting) return;
  const tabs = await ext.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*", "https://mobile.x.com/*", "https://mobile.twitter.com/*"] });
  for (const t of tabs) {
    try { await ext.scripting.insertCSS({ target: { tabId: t.id }, files: ["content.css"] });
          await ext.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }); } catch (e) {}
  }
});
// Emparejamiento web (sin códigos): la página privada de echolike.app envía las
// credenciales tras un clic. Solo se acepta ese origen; el código se valida igual.
if (ext.runtime.onMessageExternal && ext.runtime.onMessageExternal.addListener) ext.runtime.onMessageExternal.addListener((m, remitente, responder) => {
  const ok_origen = remitente && remitente.url === "https://echolike.app/private/" || remitente && remitente.url === "https://echolike.app/es/private/";
  if (!ok_origen || !m || m.tipo !== "emparejar") { responder({ ok: false, error: t("errUnauthorizedOrigin") }); return true; }
  (async () => {
    if (m.modo === "direct" || (m.inbox_url && m.device_token)) { // emparejar-direct desde la página privada
      await ext.storage.local.set({ inbox_url: String(m.inbox_url || INBOX_DEFAULT), device_token: String(m.device_token || ""), transport: "direct", sync: true });
      const r = await enviar({ v: 2, kind: "ping", prueba: true, clicked_at: new Date().toISOString() });
      return { ok: !!r.ok, version: ext.runtime.getManifest().version, error: r.error || null };
    }
    const v = parseCodigo(m.codigo);
    if (v.error) return { ok: false, error: v.error };
    await ext.storage.local.set({ codigo: String(m.codigo).replace(/\s+/g, ""), sync: true });   // emparejar = activar sync a propósito
    const r = await enviar({ v: 2, kind: "ping", prueba: true, clicked_at: new Date().toISOString() });
    return { ok: !!r.ok, version: ext.runtime.getManifest().version, error: r.error || null };
  })().then(responder, (e) => responder({ ok: false, error: String(e && e.message || e) }));
  return true;
});
async function auditar(accion, detalle, origen) {
  try {
    const s = await ext.storage.local.get({ auditoria: [] });
    const a = s.auditoria || [];
    a.push({ at: new Date().toISOString(), accion: String(accion || ""), detalle: String(detalle || "").slice(0, 300), origen: String(origen || "agent") });
    await ext.storage.local.set({ auditoria: a.slice(-100) });
  } catch (e) {}
}
async function puedeLeer() { const s = await ext.storage.local.get({ selftest: false, drive: false }); return !!(s.selftest || s.drive); }
async function puedeActuar(dominio) {
  const s = await ext.storage.local.get({ drive: false, write: {} });
  if (!s.drive) return false;
  const d = String(dominio || "").toLowerCase();
  return Object.keys(s.write || {}).some((k) => d === k || d.endsWith("." + k));
}
async function ejecutarComando(cmd, vistos) {
  if (!cmd || !cmd.id || (vistos && vistos.has(cmd.id))) return 0;
  if (vistos) vistos.add(cmd.id);
  try {
    if (cmd.action === "diagnostico" && cmd.url) await diagnosticar(cmd.url);
    else if (cmd.action === "fetch_page" && cmd.url) await fetchPage(cmd.url);
    else if (cmd.action === "selftest") await autoPrueba("remote:" + cmd.id);
    else return 0;
    await auditar("cmd", cmd.action + " " + (cmd.url || cmd.id || ""), "agent");
    return 1;
  } catch (e) { return 0; }
}
async function revisarComandosDirectos() {
  const c = await cfgDirect();
  if (c.error) return { ok: false };
  let j;
  try {
    const r = await Promise.race([fetch(`${c.inbox_url}/api/cmd`, { headers: { authorization: `Bearer ${c.device_token}` } }), espera(DIAG_MS)]);
    if (!r.ok) return { ok: false };
    j = await r.json();
  } catch (e) { return { ok: false }; }
  if (!j || !j.cmd) return { ok: true, hechos: 0 };
  const s = await ext.storage.local.get({ cmd_vistos: [] });
  const vistos = new Set(s.cmd_vistos || []);
  const hechos = await ejecutarComando(j.cmd, vistos);
  await ext.storage.local.set({ cmd_vistos: [...vistos].slice(-50) });
  return { ok: true, hechos };
}
async function fetchPage(url) {
  const u = String(url || "").slice(0, 500);
  let host = "";
  try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return { ok: false, error: "bad url" }; }
  if (!(await puedeActuar(host))) { await auditar("rechazado", "fetch_page " + host, "worker"); return { ok: false, error: "drive mode or domain not allowed" }; }
  await auditar("fetch_page", u, "agent");
  let tab = null;
  try {
    tab = await ext.tabs.create({ url: u, active: false });
    await Promise.race([
      new Promise((ok, no) => {
        const f = (id, info) => { if (id === tab.id && info.status === "complete") { try { ext.tabs.onUpdated.removeListener(f); } catch (e) {} ok(); } };
        try { ext.tabs.onUpdated.addListener(f); } catch (e) { ok(); }
        setTimeout(() => no(new Error("load timeout")), 25000);
      }), espera(25000)]);
    await new Promise((r) => setTimeout(r, 2500));   // React paints late
    const st = await Promise.race([ext.tabs.sendMessage(tab.id, { tipo: "diagnosticar" }), espera(DIAG_MS)]);
    const out = { ok: true, url: u, state: st || null };
    try {
      const acts = [];
      for (const p of (st && st.posts) || []) {
        if (p.text && p.text.length > 50) acts.push(enviar({ v: 2, kind: "followup", clicked_at: new Date().toISOString(),
          id: p.id, handle: p.handle, url: p.url, text: p.text, truncated: p.truncated, links: p.links || [] }));
      }
      if (st && st.aid && (st.article_chars || 0) > 200) acts.push(enviar({ v: 2, kind: "article", clicked_at: new Date().toISOString(),
        id: "article:" + st.aid, url: u, article_id: st.aid, title: st.article_title || "",
        body: st.article_body || "", truncated: (st.article_chars || 0) >= 100000 }));
      await Promise.all(acts);
      out.sent = acts.length;
    } catch (e) { out.send_error = String((e && e.message) || e).slice(0, 120); }
    await auditar("fetch_page_done", u + " chars=" + ((st && st.article_chars) || 0), "agent");
    try {
      await enviar({ v: 2, kind: "diagnostico", clicked_at: new Date().toISOString(),
        id: "diag-" + Date.now().toString(36), url: u,
        traza: { at: new Date().toISOString(), version: ext.runtime.getManifest().version, url: u, fetch: out },
        text: JSON.stringify({ fetch_page: u, sent: out.sent || 0, article_chars: (st && st.article_chars) || 0, posts: ((st && st.posts) || []).length }).slice(0, 500) });
    } catch (e) {}
    return out;
  } catch (e) {
    await auditar("fetch_page_error", u + " " + String((e && e.message) || e).slice(0, 120), "agent");
    try {
      await enviar({ v: 2, kind: "diagnostico", clicked_at: new Date().toISOString(),
        id: "diag-" + Date.now().toString(36), url: u,
        traza: { at: new Date().toISOString(), version: ext.runtime.getManifest().version, url: u,
                 fetch: { ok: false, error: String((e && e.message) || e).slice(0, 160) } },
        text: JSON.stringify({ fetch_page: u, error: String((e && e.message) || e).slice(0, 120) }) });
    } catch (e2) {}
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  } finally {
    try { if (tab) await ext.tabs.remove(tab.id); } catch (e) {}
  }
}
async function autoPrueba(motivo) {
  const trace = { at: new Date().toISOString(), version: ext.runtime.getManifest().version, motivo };
  try { trace.ping = await pingDirecto(await cfgDirect()).then(() => true).catch((e) => String((e && e.message) || e).slice(0, 80)); }
  catch (e) { trace.ping = String((e && e.message) || e).slice(0, 80); }
  const s = await ext.storage.local.get({ pending_links: {}, truncated_recent: [] });
  trace.pendientes = Object.keys(s.pending_links || {}).length;
  trace.truncados = (s.truncated_recent || []).length;
  let resueltos = 0;
  for (const [aid, p] of Object.entries(s.pending_links || {})) {
    if (Date.now() - Date.parse(p.at || 0) > 7 * 864e5) { delete s.pending_links[aid]; continue; }
    resueltos++;
  }
  trace.pendientes_vivos = resueltos;
  await ext.storage.local.set({ pending_links: s.pending_links });
  const q = await ext.storage.local.get({ cola: [] });
  trace.cola = (q.cola || []).length;
  const item = { v: 2, kind: "selftest", clicked_at: trace.at, url: "selftest:" + motivo,
    id: "self-" + Date.now().toString(36), traza: trace, text: JSON.stringify(trace).slice(0, 2000) };
  const r = await enviar(item);
  return Object.assign({ uid: item.uid, trace }, r);
}

let puenteWS = null, puenteQuiere = false, puenteTimer = null;
async function puenteDebe() {
  try {
    const s = await ext.storage.local.get({ selftest: false, drive: false });
    return !!((s.selftest || s.drive) && (await syncOn()));
  } catch (e) { return false; }
}
async function conectarPuente() {
  if (puenteWS || !(await puenteDebe())) return;
  puenteQuiere = true;
  let ws = null;
  try {
    ws = new WebSocket("ws://127.0.0.1:8922");
  } catch (e) { return reintentarPuente(); }
  puenteWS = ws;
  try {
    ws.onopen = () => { try { ws.send(JSON.stringify({ hello: { version: ext.runtime.getManifest().version } })); } catch (e) {} };
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.cmd || !m.cmd.id) return;
      const vistos = new Set((await ext.storage.local.get({ cmd_vistos: [] })).cmd_vistos || []);
      const hechos = await ejecutarComando(m.cmd, vistos);
      await ext.storage.local.set({ cmd_vistos: [...vistos].slice(-50) });
      try { ws.send(JSON.stringify({ receipt: { id: m.cmd.id, ok: hechos > 0 } })); } catch (e) {}
    };
    ws.onclose = () => { if (puenteWS === ws) puenteWS = null; reintentarPuente(); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  } catch (e) { try { ws.close(); } catch (x) {} }
}
function reintentarPuente() {
  if (puenteWS) return;
  clearTimeout(puenteTimer);
  puenteTimer = setTimeout(() => { puenteTimer = null; conectarPuente().catch(() => {}); }, 5000);
}
function cerrarPuente() {
  puenteQuiere = false;
  clearTimeout(puenteTimer);
  try { if (puenteWS) puenteWS.close(); } catch (e) {}
  puenteWS = null;
}

async function urlPuente() {
  // Same host as the inbox (localhost or tailnet), bridge port, ws(s) matching http(s).
  const s = await ext.storage.local.get({ inbox_url: "" });
  try {
    const u = new URL((s.inbox_url || "").replace(/\/$/, ""));
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
    try {
      const ok = await new Promise((res) => {
        try {
          if (ext.permissions && ext.permissions.request) {
            const wsScheme = u.protocol === "https:" ? "wss://" : "ws://";
            ext.permissions.request({ origins: [u.protocol + "//" + u.host + "/*", wsScheme + u.host + "/*"] }, res);
          } else res(true);
        } catch (e) { res(true); }
      });
      if (ok === false) return null;
    } catch (e) {}
    return (u.protocol === "https:" ? "wss://" : "ws://") + u.host.replace(/:\d+$/, "") + ":8922";
  } catch (e) { return null; }
}

function hashJS(s) { let h = 5381; s = String(s || ""); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); }
async function ejecutarEnPestana(tabId, js, timeoutMs) {
  const r = await Promise.race([ext.tabs.sendMessage(tabId, { tipo: "ejecutar", js }), espera(timeoutMs || DIAG_MS)]);
  return r;
}
async function comandoEval(cmd) {
  const js = String(cmd.js || "").slice(0, 20000);
  if (!js.trim()) return { ok: false, error: "empty js" };
  let host = "";
  try {
    if (cmd.url) host = new URL(cmd.url).hostname.toLowerCase();
    else {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.url) host = new URL(tab.url).hostname.toLowerCase();
    }
  } catch (e) { return { ok: false, error: "bad url" }; }
  if (!(await puedeActuar(host))) { await auditar("rechazado", "eval " + host, "worker"); return { ok: false, error: "drive mode or domain not allowed" }; }
  await auditar("eval", host + " #" + hashJS(js), "agent");
  let tab = null, bg = false;
  try {
    if (cmd.url) {
      tab = await ext.tabs.create({ url: cmd.url, active: false });
      bg = true;
      await new Promise((ok, no) => {
        const f = (id, info) => { if (id === tab.id && info.status === "complete") { try { ext.tabs.onUpdated.removeListener(f); } catch (e) {} ok(); } };
        try { ext.tabs.onUpdated.addListener(f); } catch (e) { ok(); }
        setTimeout(() => no(new Error("load timeout")), 25000);
      });
      await new Promise((r) => setTimeout(r, 2500));
    } else {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
      if (!tab) return { ok: false, error: "no active tab" };
    }
    const r = await ejecutarEnPestana(tab.id, js, 20000);
    await auditar("eval_done", host + " ok=" + !!(r && r.ok), "agent");
    return { ok: !!(r && r.ok), result: r };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  } finally {
    try { if (bg && tab) await ext.tabs.remove(tab.id); } catch (e) {}
  }
}

if (typeof module !== "undefined") module.exports = { parseCodigo, INBOX_DEFAULT, INBOX_CANDIDATES, sondear, autoconectar };
