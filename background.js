// EchoLike v2.2 — background: cola persistente, cifra (AES-GCM), publica en ntfy.sh, lee acuses del receptor.
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
async function cfg() {
  let c = await ext.storage.local.get({ codigo: "" });
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
  if (estado === "en cola" && (item.kind === "like" || item.kind === "bookmark")) { // contador «hoy» (fecha local)
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
let vaciando = null;
async function vaciar() {
  if (vaciando) return vaciando;
  vaciando = (async () => {
    const c = await cfg(); const { cola, ntfy429hasta } = await ext.storage.local.get({ cola: [], ntfy429hasta: 0 }); let res = { ok: true };
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
    await ext.storage.local.set({ cola }); return res;
  })();
  try { return await vaciando; } finally { vaciando = null; }
}
async function enviar(item) {
  item.uid = item.uid || crypto.randomUUID(); await anotar(item, "en cola"); await encolar(item);
  const r = await vaciar(); return Object.assign({ uid: item.uid }, r);
}
async function acuses() {
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
    : m && m.tipo === "prueba" ? enviar({ v: 2, kind: "ping", prueba: true, clicked_at: new Date().toISOString() })
    : m && m.tipo === "acuses" ? acuses()
    : m && m.tipo === "validar" ? Promise.resolve(parseCodigo(m.codigo)) : null;
  if (!p) return;
  p.then(responder, (e) => responder({ ok: false, error: String(e && e.message || e) })); return true;
});
function alarmas() { ext.alarms.create("latido", { periodInMinutes: 30 }); ext.alarms.create("reintento", { periodInMinutes: 1 }); }
alarmas();
ext.alarms.onAlarm.addListener((a) => {
  if (a.name === "latido") enviar({ v: 2, kind: "ping", clicked_at: new Date().toISOString() });
  if (a.name === "reintento") vaciar();
});
// Al instalar/actualizar: inyectar en pestañas de X ya abiertas (si no, no detecta nada hasta recargar).
ext.runtime.onInstalled.addListener(async () => {
  alarmas();
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
    const v = parseCodigo(m.codigo);
    if (v.error) return { ok: false, error: v.error };
    await ext.storage.local.set({ codigo: String(m.codigo).replace(/\s+/g, "") });
    const r = await enviar({ v: 2, kind: "ping", prueba: true, clicked_at: new Date().toISOString() });
    return { ok: !!r.ok, version: ext.runtime.getManifest().version, error: r.error || null };
  })().then(responder, (e) => responder({ ok: false, error: String(e && e.message || e) }));
  return true;
});
if (typeof module !== "undefined") module.exports = { parseCodigo };
