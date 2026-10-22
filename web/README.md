# Clearstream for phone, computer and LG TV

The same Clearstream, as a web app: the same strictly filtered free channel list, the same automatic
reconnect and switch to backup streams, favourites, search, and your own paid service. One page that
adapts to a **phone** (touch, portrait and landscape), a **computer** (mouse and keyboard) and an
**LG TV** (remote control, including the Magic Remote pointer). It's in Swedish or English, following
the device's language (you can change it in Settings).

Nothing to install on a phone or computer: it runs in the browser and can be added to the home screen
like an app. On an LG TV you can open it in the TV's browser, or install it as a TV app.

---

## 1. Put it online (once)

The page is published on GitHub Pages by the workflow in `.github/workflows/web.yml`.

1. On GitHub, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge to `main` (or run the **Web app** workflow by hand under **Actions**).
3. The page is then at **`https://<your-github-name>.github.io/clearstream/`**.

Any other static web host works too: upload the contents of the `web` folder. It needs https for
"Add to home screen" and offline start, but nothing else: there is no server part.

To try it on your own computer: `python -m http.server 8000 -d web`, then open
<http://localhost:8000>.

## 2. Watch on a phone or computer

Open the address. Pick a group (Football, Tennis, Cricket, News, Sports…), then a channel.

- **iPhone / iPad:** Safari → **Share → Add to Home Screen**.
- **Android:** Chrome → **⋮ → Install app** (or **Add to Home screen**).
- **Windows / Mac:** Chrome or Edge → the **Install** icon at the right of the address bar.

| To… | Do this |
|---|---|
| Watch a channel | Pick a group, then tap/click the channel |
| Find a channel | Type in **Search** (searches every channel), or press **/** |
| Show one country | The **All countries** box above the list |
| Add / remove a favourite | The **☆** next to a channel, or the star under the picture |
| Full screen | The full-screen button, **F**, or double-click the picture. On a phone, just turn it sideways |
| Previous / next channel | The ⏮ ⏭ buttons, or **Page Up / Page Down** |
| Picture squashed or with black bars | The **Picture** button: Auto, Whole picture, Fill screen or Stretch. Remembered per channel |
| Quality | The **Quality** button (when the channel offers several) |
| Smoother playback on poor internet | **Settings → Buffer: Long** |
| More (or fewer) countries | **Settings → Countries for free channels** (the number shows how many channels each has) |
| Re-check which channels work | **Check** above the list |

The status line and the **● Live / Offline** marks work as in the Windows app: Clearstream checks
which free channels are working when it starts, and working ones move to the top of each list.

## 3. Watch on an LG TV

LG TVs with **webOS 5 or newer** (2020 models onwards).

### Option A: in the TV's web browser (no installation)

Open the **Web Browser** app on the TV, go to the address from step 1, and bookmark it. The page
recognises the TV and switches to the TV layout.

### Option B: as an app on the TV (Developer Mode)

This gives a Clearstream icon on the TV's home screen and the best remote-control handling. LG only
allows apps outside its store through Developer Mode:

1. Create a free account at <https://webostv.developer.lge.com> (sign in, accept the terms).
2. On the TV, install **Developer Mode** from the LG Content Store, sign in with that account, and
   switch **Dev Mode Status** on. The TV restarts. Note the TV's IP address shown in the app.
3. On a computer with Node.js: `npm install -g @webos-tools/cli`
4. Register the TV: `ares-setup-device` → **add**, enter a name (e.g. `tv`) and the TV's IP address.
   Then `ares-novacom --device tv --getkey` and type the passphrase shown in the Developer Mode app.
5. Get the app file, either:
   - from GitHub: **Actions → Web app → latest run → `clearstream-lg-webos`** (unzip it), or
   - or build it yourself in the repository folder: `ares-package web -o dist`
6. Install and start it: `ares-install --device tv dist/io.github.halilbalr.clearstream_1.0.0_all.ipk`,
   then `ares-launch --device tv io.github.halilbalr.clearstream`

Developer Mode runs for a limited time, shown in the Developer Mode app; extend it there now and
then, or the TV removes apps installed this way.

### The remote control

| Button | What it does |
|---|---|
| Arrows and **OK** | Move around and choose. The Magic Remote pointer works too |
| Choosing a channel | Shows it full screen |
| **▲ ▼** or **CH + / CH −** (full screen) | Previous / next channel |
| **OK** (full screen) | Shows the controls: favourite, picture, quality… |
| **Back** | Full screen → list; closes a dialog; on the main screen, leaves the app |
| **Red** | Add or remove a favourite |
| **Green** | Full screen |
| **Yellow** | Search |
| **Blue** | Settings |
| **▶ ⏸ ■** | Play / pause / stop |

## 4. Paid services

**Settings → My sources** takes the same three kinds of source as the Windows app: an M3U web
address, an M3U file (not on the TV) or an Xtream login. Only add a service you actually pay for.

What a web browser allows is narrower than a Windows program, so a provider that works in the
Windows app may not work here:

- **The provider must let browsers read its list.** Many don't (the browser calls this CORS). The
  message then says so; adding the playlist as a **file** usually gets round it for the list itself.
- **Plain http is blocked on an https page.** The published page is https, so a provider without
  https only works in the **LG TV app** (Option B), which isn't on https.
- **MPEG-TS links** (`.ts`) only play in the LG TV app; elsewhere Clearstream uses the provider's
  `.m3u8` links.
- Your link, username and password are kept **only in this browser on this device**, and only ever
  sent to your provider. Unlike the Windows app they are not encrypted, so only add a paid service on
  your own device.

## 5. How it differs from the Windows app

- **Playback engine:** the browser's own player on iPhone, iPad, Mac Safari and LG TVs; everywhere
  else [hls.js](https://github.com/video-dev/hls.js) (Chrome, Edge, Firefox, Android). The reconnect
  rules are the same as in `clearstream/player.py`: retries after 2, 5 and 10 seconds, backup streams
  in turn, and up to 3 minutes of trying once a channel has played.
- **"Offline" can mean "not playable here".** hls.js may only play a stream whose server allows web
  pages to read it; the check tests exactly that, so a channel that is Offline in Chrome can still
  play on an iPhone or the TV. Each device keeps its own check results.
- A few free channels need the player to identify itself in a particular way, which browsers don't
  allow, so they don't play here.
- **No programme guide (Now / Next) yet.** The free list rarely has one anyway.

## 6. Safety

- The free list goes through **the same filter** as the Windows app: `js/sources.js` is a line-by-line
  port of `clearstream/sources.py` (the tests in `tests/web/` hold it to the Python results; on the
  iptv-org list of 22 October 2026 both give exactly the same 444 channels for the default countries).
- **No ads, no tracking, no accounts, no telemetry, no server of our own.** The app only connects to
  iptv-org's list (`iptv-org.github.io`, or the same files on `raw.githubusercontent.com` if that's
  unreachable, once a day), the streams you watch or that the check tests, the channel logos iptv-org
  lists (**Settings → Show channel logos** turns them off), and the services you add.
- **One third-party file:** hls.js 1.7.3 (Apache-2.0, licence in `vendor/hls.js/`), unmodified; the
  workflow checks its SHA-256 (`a12e7ee1…374423e`). No other libraries, no build step, no CDN.
- A Content-Security-Policy lets the page run only its own scripts. Playlists are read as text; only
  names, a few labels and http(s) addresses are used.
- Everything it remembers (settings, favourites, check results, the channel-list cache) stays in this
  browser on this device. Clearing the site's data removes it.

## 7. Files

| File | What it is |
|---|---|
| `index.html`, `app.css` | The page and its layouts (phone, tablet, computer, TV) |
| `js/sources.js` | Free list and paid sources (port of `sources.py`) |
| `js/health.js` | The "is this channel working?" check (port of `health.py`) |
| `js/player.js` | Playback, reconnect and backup streams (port of `player.py`) |
| `js/nav.js` | Arrow-key / remote-control navigation |
| `js/app.js` | Everything on screen |
| `js/i18n.js` | Swedish and English texts |
| `js/store.js` | What the app remembers on this device |
| `appinfo.json`, `icons/webos-*.png` | The LG webOS app description and icons |
| `manifest.webmanifest`, `sw.js` | "Add to home screen" and quick start |
