# EchoLike inbox server — corre en TU pc

Tus likes van a tu máquina, no a la nube de nadie. Sin dependencias: solo Python 3.

## Arranca en 1 minuto

```bash
python3 server.py
```

La primera vez imprime tu **device token** (una sola vez) y lo guarda en
`~/.echolike-inbox/device_token.txt`. Pégalo en la extensión
(opciones → Inbox settings) junto con la URL.

## Desde el teléfono

- Misma máquina: `http://127.0.0.1:8911`
- Otro aparato (mismo wifi o Tailscale): arranca con
  `python3 server.py --host 0.0.0.0` y usa la IP de este pc,
  p. ej. `http://100.x:8911` (Tailscale) o `http://192.168.x.x:8911` (wifi).
  El token se pide igual: sin token no entra nada.

## Qué expone

- `POST /api/likes` — la extensión envía eventos cifrados (necesita token).
- `GET /api/inbox` — tus últimos eventos (necesita token).
- `GET /api/health` — liveness, sin auth.
- `GET /` — vista mínima de lo guardado.

Tope: 2000 eventos por aparato y día. Datos en `~/.echolike-inbox/inbox.db`
(SQLite, tuyos). Para parar: Ctrl+C. Nada sale a internet.
