# RingCX Desktop Ticker

Electron-Desktop-App, die Live-Queue-Performance und Live-Agentenstatus von RingCX als
scrollenden Börsenticker anzeigt. Portiert die Auth-/Datenlogik aus
[ringcx-wordpress-wallboard](https://github.com/PatrickHeller/ringcx-wordpress-wallboard) direkt
nach Node — kein WordPress/PHP-Server nötig, die App spricht selbst mit der RingCX-API.

## Datenquellen (RingCX Voice API)

- `{BASE_URL}/voice/api/v1/admin/accounts/{ACCOUNT_ID}/realTimeData/inbound` — Queue-Performance
- `{BASE_URL}/voice/api/v1/admin/accounts/{ACCOUNT_ID}/realTimeData/agent` — Live-Agentenstatus
- `{BASE_URL}/voice/api/v1/admin/accounts/{ACCOUNT_ID}/agentGroups/{AGENT_GROUP_ID}/agents` — Mitgliederliste,
  gemerged mit Live-Status (offline Agenten zeigen "NICHT ANGEMELDET")

**Auth (zweistufig):** JWT-Bearer-Login gegen `platform.ringcentral.com`, danach Token-Tausch gegen
`{BASE_URL}/api/auth/login/rc/accesstoken` für einen RingCX-eigenen Access-Token. Tokens werden
lokal in der Electron-`userData`-Config gecacht und automatisch per Refresh-Token erneuert.

## Setup

```bash
npm install
npm start
```

Beim ersten Start öffnet sich automatisch das Einstellungsfenster (auch später über das
Zahnrad-Icon erreichbar) zur Eingabe von `ACCOUNT_ID`, `AGENT_GROUP_ID`, `CLIENT_ID`,
`CLIENT_SECRET` und `JWT_ASSERTION`. Die Werte werden in
`<userData>/config.json` gespeichert (z. B. unter Linux `~/.config/ringcx-desktop-ticker/config.json`),
niemals im Repo committed.

## Build (Windows / macOS / Linux)

```bash
npm run dist
```

Erstellt über `electron-builder` Installer/Pakete für die aktuelle Plattform (NSIS für Windows,
DMG für macOS, AppImage + deb für Linux) im Ordner `dist/`.
