# Extensión EchoLike

Gratis y de código abierto (MIT). Sin tienda: Chrome pide **Modo desarrollador** y puede mostrar el aviso *"Desactivar extensiones en modo desarrollador"*; es normal para cualquier extensión instalada así, no es una alerta de virus. Puedes leer todo el código aquí. Descarga: https://github.com/g8d3/echolike-extension/releases/latest/download/echolike-extension.zip

# EchoLike v2.6 — instalación (Chrome / Edge / Brave)

1. Descarga `extension_echolike.zip` y descomprímelo en una carpeta que no vayas a borrar.
2. Abre `chrome://extensions` (en Edge: `edge://extensions`).
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta.
5. Abre el popup de la extensión (clic en su icono), haz clic en tu código para copiarlo y envíalo al bot con `/par EL2|…` (https://t.me/nova_radar_99_bot). Tras tu primer like el popup dirá "✓ Conectado".
6. Abre x.com (recarga la pestaña si ya estaba abierta). Dale like o guardar a cualquier post: llega al bot en segundos.
7. Nota de voz: junto al corazón aparece 🎙. Clic para grabar (la primera vez acepta el micrófono para x.com), clic otra vez para parar (máx. 60 s).
8. Nota escrita (2.2+): **mantén pulsado el corazón ~medio segundo** → da like y abre una cajita bajo el post. Enter guarda, Shift+Enter salto de línea, Esc cancela. También: tras cualquier like pulsa **N** (en 5 s), o el **✎** que aparece junto al corazón al pasar el ratón. En la caja trae 🎤 para cambiar a voz.
9. Atajo B (2.6.2+): con un post enfocado pulsa **B** para guardarlo en marcadores (X no trae atajo para eso: su B bloqueaba; ahora B guarda y para bloquear usa el menú).

**Firefox (escritorio, 121+):** `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal* → elige `manifest.json` (se borra al cerrar Firefox; para dejarlo fijo hay que firmarlo en addons.mozilla.org).
**Android (Quetta, el único con extensiones actualizado tras la muerte de Kiwi):** descarga `echolike.crx` (https://echolike.app/extension_echolike.crx) y ábrelo con Quetta para instalarlo. Al ir como paquete con `update_url`, el botón **Update** de su página de extensiones consulta https://echolike.app/extension_update.json y te instala la versión nueva sin tocar carpetas. Si prefieres el zip, Quetta también lo instala, pero entonces Update solo releerá archivos locales. Si el navegador dice `Package is invalid: CRX_REQUIRED_PROOF_MISSING`, ya no acepta paquetes fuera del Chrome Web Store: instala por zip (pasos 1-4) y actualiza repitiendo esos pasos con el zip nuevo. Otros: **Edge Canary**, **Lemur** o **Firefox Nightly** (colección personalizada). Funciona igual en la versión móvil de x.com en el navegador, no en la app de X.

Privacidad: cada evento va cifrado con AES-GCM a un tópico secreto de ntfy.sh (gratis). ntfy solo ve texto ilegible; sin el código nadie puede leerlo ni falsificarlo.

## Actualizar desde una versión anterior
1. Reemplaza los archivos de la carpeta por los del zip nuevo.
2. En `chrome://extensions`, pulsa ↻ (recargar) en EchoLike. Debe decir la última versión publicada.
3. La conexión se conserva (vive en el navegador, no en el zip). Si es una instalación nueva, repite el paso 5 (código + /par al bot).
4. Recarga las pestañas de x.com. Cada like muestra abajo "EchoLike ✓ enviado" y luego "✓ recibido". Si sale en rojo, el mensaje dice el motivo.
