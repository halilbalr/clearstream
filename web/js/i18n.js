/* Every word the app shows, in Swedish and English. The device's language picks one unless you
 * choose in Settings. */
(function (root) {
  'use strict';
  var CS = root.CS = root.CS || {};

  var en = {
    'app.search': 'Search channels',
    'app.clearSearch': 'Clear search',
    'app.settings': 'Settings',
    'app.groups': 'Channel groups',
    'app.check': 'Check list',
    'app.checkLabel': 'Check which channels in this list are working',

    'group.Favourites': 'Favourites',
    'group.Football': 'Football',
    'group.Tennis': 'Tennis',
    'group.Cricket': 'Cricket',
    'group.News': 'News',
    'group.Sports': 'Sports',
    'group.Other': 'Other',
    'group.All': 'All channels',

    'list.allCountries': 'All countries',
    'list.searchTitle': 'Search: “{q}”',
    'list.count': '{n} channels',

    'badge.live': 'Live',
    'badge.dead': 'Offline',
    'badge.playing': 'Playing',

    'fav.add': 'Add to favourites',
    'fav.remove': 'Remove from favourites',
    'fav.added': '{name} added to favourites',
    'fav.removed': '{name} removed from favourites',

    'empty.loading': 'Loading the channel list…',
    'empty.error': 'Couldn’t load the free channel list. Check your internet connection and try again.',
    'empty.search': 'No channels match “{q}”.',
    'empty.favourites': 'No favourites yet. Press the star next to a channel to keep it here.',
    'empty.country': 'No channels from this country in this group. Choose “All countries”.',
    'empty.group': 'No channels in this group.',

    'status.loading': 'Loading channel lists…',
    'status.freeLoaded': '{n} free channels loaded.',
    'status.freeStale': 'Couldn’t refresh the free channel list; showing the one from earlier.',
    'status.freeFailed': 'Couldn’t load the free channel list. Check your internet connection.',
    'status.sourceFailed': 'Couldn’t load “{name}”. See Settings → My sources.',
    'status.checking': 'Checking which channels work: {done} of {total}',
    'status.checkDone': 'Check finished: {live} channels live, {dead} offline (offline ones are at the bottom of each list).',

    'check.already': 'A channel check is already running.',
    'check.paidTitle': 'Check paid channels?',
    'check.paidText': 'This list has {n} channels from your paid service. Many services only allow one or two connections at a time, so they’ll be checked slowly, one at a time. Continue?',
    'check.paidOk': 'Check them',

    'idle.title': 'Pick a channel to start watching',
    'idle.titleTv': 'Choose a channel with the arrows and press OK',
    'idle.checking': 'Checking which channels are working: {done} of {total}. Working channels move to the top of the list. You can start watching now.',
    'idle.continue': 'Continue watching {name}',

    'np.nothing': 'Nothing playing',
    'np.stopped': 'Playback stopped',

    'play.opening': 'Connecting…',
    'play.playing': 'Playing',
    'play.streamOf': ' (stream {i} of {n})',
    'play.lost': 'Connection lost ({reason}). Retrying in {delay} s…',
    'play.cantStart': 'Couldn’t start ({reason}). Retrying in {delay} s…',
    'play.still': 'Still trying to reconnect…',
    'play.switching': 'Switching to backup stream {i} of {n}…',
    'play.failed': 'This channel isn’t working right now (every stream failed). It has been marked offline; try again later.',
    'play.unsupported': 'This channel can’t be played on this device. Try the LG TV app, an iPhone or iPad, or the Windows app.',
    'play.noStreams': 'This channel has no streams.',
    'play.gaveUp': 'The connection has been down for 3 minutes, so playback stopped. Check your internet, then choose the channel again.',

    'reason.error': 'playback error',
    'reason.network': 'network error',
    'reason.froze': 'the picture froze',
    'reason.slow': 'it took too long to start',
    'reason.stopped': 'the stream stopped',
    'reason.unsupported': 'format not supported here',

    'ctl.play': 'Play',
    'ctl.pause': 'Pause',
    'ctl.prev': 'Previous channel',
    'ctl.next': 'Next channel',
    'ctl.fit': 'Picture',
    'ctl.quality': 'Quality',
    'ctl.mute': 'Sound on/off',
    'ctl.volume': 'Volume',
    'ctl.full': 'Full screen',
    'ctl.stop': 'Stop',
    'ctl.tap': 'Tap to play',
    'osd.hint': '▲▼ change channel · OK menu · Back to the list',

    'fit.title': 'Picture shape',
    'fit.auto': 'Auto',
    'fit.contain': 'Whole picture',
    'fit.cover': 'Fill screen (crop edges)',
    'fit.fill': 'Stretch to fit (fixes squashed pictures)',
    'fit.set': 'Picture: {fit}. Remembered for this channel.',

    'quality.title': 'Quality',
    'quality.auto': 'Automatic (best for your connection)',

    'set.title': 'Settings',
    'set.general': 'General',
    'set.language': 'Language',
    'set.langAuto': 'Same as this device',
    'set.theme': 'Appearance',
    'set.themeDark': 'Dark',
    'set.themeLight': 'Light',
    'set.themeSystem': 'Same as this device',
    'set.buffer': 'Buffer',
    'set.bufferShort': 'Short – less delay behind live',
    'set.bufferNormal': 'Normal – recommended',
    'set.bufferLong': 'Long – for slow or unsteady internet',
    'set.bufferNext': 'The new buffer is used from the next channel you start.',
    'set.bufferNative': 'This device’s own player manages its buffer itself.',
    'set.logos': 'Show channel logos',
    'set.countries': 'Countries for free channels',
    'set.countriesHint': 'The number is how many free channels each country has.',
    'set.countryFilter': 'Find a country',
    'set.sources': 'My sources (paid services)',
    'set.sourcesHint': 'Only add a service you actually pay for. Its channels appear in the same groups.',
    'set.noSources': 'You haven’t added any yet.',
    'set.channels': 'Channels',
    'set.checkNow': 'Check channels in this list now',
    'set.reloadLists': 'Refresh all channel lists',
    'set.help': 'Help',
    'set.about': 'About and safety',

    'source.loading': 'Loading…',
    'source.ok': '{n} channels',
    'source.secure': 'encrypted connection (https)',
    'source.insecure': 'NOT encrypted – your provider doesn’t offer https',
    'source.type.m3u_url': 'M3U playlist (web address)',
    'source.type.m3u_file': 'M3U playlist (file)',
    'source.type.xtream': 'Xtream login',
    'source.addUrl': 'M3U web address',
    'source.addFile': 'M3U file',
    'source.addXtream': 'Xtream login',
    'source.addTitle.m3u_url': 'Add a paid playlist (web address)',
    'source.addTitle.m3u_file': 'Add a paid playlist (file)',
    'source.addTitle.xtream': 'Add a paid service (Xtream login)',
    'source.added': '“{name}” added. Its channels appear in a few seconds.',
    'source.removeTitle': 'Remove this source?',
    'source.removeText': 'Remove “{name}” and its channels from this device?',
    'source.err.http_blocked': 'Your provider only offers unencrypted http, which browsers block on a secure (https) page. Use the LG TV app or the Windows app, or ask your provider for an https address.',
    'source.err.unreachable': 'Couldn’t reach your provider from this browser. Either the address is wrong, or the provider doesn’t allow web browsers to read the list (CORS). Try downloading the playlist file and adding it as a file, or use the Windows app.',
    'source.err.download_failed': 'Couldn’t download the playlist ({detail}).',
    'source.err.login_rejected': 'The provider rejected the username or password.',
    'source.err.login_failed': 'Couldn’t log in to the service ({detail}).',
    'source.err.bad_address': 'The server address doesn’t look right.',
    'source.err.unknown_type': 'Unknown kind of source.',

    'form.intro.m3u_url': 'Your provider gives you a long link, often ending in .m3u or containing get.php.',
    'form.intro.m3u_file': 'A playlist file you downloaded from your provider’s own website.',
    'form.intro.xtream': 'Your provider gives you a server address, a username and a password.',
    'form.name': 'Name (anything you like)',
    'form.url': 'Playlist address',
    'form.urlHint': 'Starts with https:// or http://',
    'form.server': 'Server address',
    'form.serverHint': 'For example http://example.com:8080',
    'form.username': 'Username',
    'form.password': 'Password',
    'form.file': 'Playlist file',
    'form.privacy': 'Stored only on this device and only ever sent to your provider.',
    'form.missing': 'Please fill in every box.',
    'form.badUrl': 'That isn’t a web address (it must start with https:// or http://).',

    'action.retry': 'Try again',
    'action.close': 'Close',
    'action.cancel': 'Cancel',
    'action.save': 'Save',
    'action.reload': 'Reload',
    'action.remove': 'Remove',

    'help.keys': 'Watch a channel: pick a group, then click the channel\n' +
                 'Search: type in the search box, or press /\n' +
                 'Favourite: the star next to a channel, or while watching\n' +
                 'Full screen: F, the full-screen button or double-click the picture; Esc to leave\n' +
                 'Previous / next channel: Page Up / Page Down\n' +
                 'Pause: Space · Sound on/off: M\n' +
                 'Squashed picture or black bars: the Picture button',
    'help.tv': 'Arrows and OK: move around and choose\n' +
               'Choosing a channel shows it full screen; Back returns to the list\n' +
               'Full screen: ▲ ▼ or CH +/- change channel, OK shows the controls\n' +
               'Red button: add or remove a favourite\n' +
               'Green button: full screen · Yellow: search · Blue: settings\n' +
               'The Magic Remote pointer works everywhere too',

    'about.text': 'Clearstream shows legitimate free channels from the public iptv-org list, strictly filtered (no pirate copies of pay channels), plus any paid service you add. No ads, no tracking, no accounts. It only connects to iptv-org (the channel list, once a day), the channels’ own streams and logos, and the services you add.',
    'about.free': 'Free, legal news coverage is excellent. Live top-level football, tennis and cricket are sold to pay services, so the free choice there is thin: mostly classics, magazine shows and smaller events.',
    'about.version': 'Clearstream web app {v}',

    'info.title': 'About this channel',
    'info.titleIdle': 'Good to know',
    'info.country': 'Country',
    'info.groups': 'Group',
    'info.source': 'Source',
    'info.free': 'Free channel (iptv-org)',
    'info.streams': 'Streams',
    'info.streamsOne': '1 stream',
    'info.streamsMany': '{n} streams – switches to a backup by itself if one stops',
    'info.keys': 'Shortcuts: F full screen · M sound · Page Up/Down change channel · / search · Space pause',
    'info.keysTv': 'Remote: red = favourite · green = full screen · yellow = search · blue = settings · CH +/- change channel'
  };

  var sv = {
    'app.search': 'Sök kanal',
    'app.clearSearch': 'Rensa sökningen',
    'app.settings': 'Inställningar',
    'app.groups': 'Kanalgrupper',
    'app.check': 'Kontrollera',
    'app.checkLabel': 'Kontrollera vilka kanaler i listan som fungerar',

    'group.Favourites': 'Favoriter',
    'group.Football': 'Fotboll',
    'group.Tennis': 'Tennis',
    'group.Cricket': 'Cricket',
    'group.News': 'Nyheter',
    'group.Sports': 'Sport',
    'group.Other': 'Övrigt',
    'group.All': 'Alla kanaler',

    'list.allCountries': 'Alla länder',
    'list.searchTitle': 'Sökning: ”{q}”',
    'list.count': '{n} kanaler',

    'badge.live': 'Live',
    'badge.dead': 'Offline',
    'badge.playing': 'Spelas',

    'fav.add': 'Lägg till i favoriter',
    'fav.remove': 'Ta bort från favoriter',
    'fav.added': '{name} har lagts till i favoriter',
    'fav.removed': '{name} har tagits bort från favoriter',

    'empty.loading': 'Hämtar kanallistan…',
    'empty.error': 'Det gick inte att hämta listan med gratiskanaler. Kontrollera internetanslutningen och försök igen.',
    'empty.search': 'Inga kanaler matchar ”{q}”.',
    'empty.favourites': 'Inga favoriter ännu. Tryck på stjärnan vid en kanal för att spara den här.',
    'empty.country': 'Inga kanaler från det här landet i gruppen. Välj ”Alla länder”.',
    'empty.group': 'Inga kanaler i den här gruppen.',

    'status.loading': 'Hämtar kanallistor…',
    'status.freeLoaded': '{n} gratiskanaler hämtade.',
    'status.freeStale': 'Det gick inte att uppdatera listan med gratiskanaler; visar den tidigare.',
    'status.freeFailed': 'Det gick inte att hämta listan med gratiskanaler. Kontrollera internetanslutningen.',
    'status.sourceFailed': 'Det gick inte att hämta ”{name}”. Se Inställningar → Mina källor.',
    'status.checking': 'Kontrollerar vilka kanaler som fungerar: {done} av {total}',
    'status.checkDone': 'Kontrollen är klar: {live} kanaler fungerar, {dead} offline (de ligger sist i varje lista).',

    'check.already': 'En kanalkontroll pågår redan.',
    'check.paidTitle': 'Kontrollera betalkanaler?',
    'check.paidText': 'Listan har {n} kanaler från din betaltjänst. Många tjänster tillåter bara en eller två anslutningar samtidigt, så de kontrolleras långsamt, en i taget. Fortsätta?',
    'check.paidOk': 'Kontrollera',

    'idle.title': 'Välj en kanal för att börja titta',
    'idle.titleTv': 'Välj en kanal med pilarna och tryck OK',
    'idle.checking': 'Kontrollerar vilka kanaler som fungerar: {done} av {total}. Fungerande kanaler flyttas upp i listan. Du kan börja titta redan nu.',
    'idle.continue': 'Fortsätt titta på {name}',

    'np.nothing': 'Inget spelas',
    'np.stopped': 'Uppspelningen stoppades',

    'play.opening': 'Ansluter…',
    'play.playing': 'Spelar',
    'play.streamOf': ' (ström {i} av {n})',
    'play.lost': 'Anslutningen bröts ({reason}). Försöker igen om {delay} s…',
    'play.cantStart': 'Kunde inte starta ({reason}). Försöker igen om {delay} s…',
    'play.still': 'Försöker fortfarande återansluta…',
    'play.switching': 'Byter till reservström {i} av {n}…',
    'play.failed': 'Kanalen fungerar inte just nu (alla strömmar misslyckades). Den har markerats som offline; försök igen senare.',
    'play.unsupported': 'Kanalen kan inte spelas på den här enheten. Prova LG-TV-appen, en iPhone eller iPad, eller Windows-appen.',
    'play.noStreams': 'Kanalen har inga strömmar.',
    'play.gaveUp': 'Anslutningen har varit nere i 3 minuter, så uppspelningen stoppades. Kontrollera internet och välj kanalen igen.',

    'reason.error': 'uppspelningsfel',
    'reason.network': 'nätverksfel',
    'reason.froze': 'bilden frös',
    'reason.slow': 'det tog för lång tid att starta',
    'reason.stopped': 'strömmen avbröts',
    'reason.unsupported': 'formatet stöds inte här',

    'ctl.play': 'Spela',
    'ctl.pause': 'Pausa',
    'ctl.prev': 'Föregående kanal',
    'ctl.next': 'Nästa kanal',
    'ctl.fit': 'Bild',
    'ctl.quality': 'Kvalitet',
    'ctl.mute': 'Ljud av/på',
    'ctl.volume': 'Volym',
    'ctl.full': 'Helskärm',
    'ctl.stop': 'Stoppa',
    'ctl.tap': 'Tryck för att spela',
    'osd.hint': '▲▼ byt kanal · OK meny · Tillbaka till listan',

    'fit.title': 'Bildformat',
    'fit.auto': 'Automatiskt',
    'fit.contain': 'Hela bilden',
    'fit.cover': 'Fyll skärmen (beskär kanterna)',
    'fit.fill': 'Sträck ut (rättar till hoptryckt bild)',
    'fit.set': 'Bild: {fit}. Sparas för den här kanalen.',

    'quality.title': 'Kvalitet',
    'quality.auto': 'Automatiskt (bäst för din anslutning)',

    'set.title': 'Inställningar',
    'set.general': 'Allmänt',
    'set.language': 'Språk',
    'set.langAuto': 'Samma som enheten',
    'set.theme': 'Utseende',
    'set.themeDark': 'Mörkt',
    'set.themeLight': 'Ljust',
    'set.themeSystem': 'Samma som enheten',
    'set.buffer': 'Buffert',
    'set.bufferShort': 'Kort – mindre fördröjning',
    'set.bufferNormal': 'Normal – rekommenderas',
    'set.bufferLong': 'Lång – för långsamt eller ostadigt internet',
    'set.bufferNext': 'Den nya bufferten används från nästa kanal du startar.',
    'set.bufferNative': 'Den här enhetens egen spelare sköter bufferten själv.',
    'set.logos': 'Visa kanallogotyper',
    'set.countries': 'Länder för gratiskanaler',
    'set.countriesHint': 'Siffran visar hur många gratiskanaler landet har.',
    'set.countryFilter': 'Hitta ett land',
    'set.sources': 'Mina källor (betaltjänster)',
    'set.sourcesHint': 'Lägg bara till en tjänst som du faktiskt betalar för. Dess kanaler hamnar i samma grupper.',
    'set.noSources': 'Du har inte lagt till några ännu.',
    'set.channels': 'Kanaler',
    'set.checkNow': 'Kontrollera kanalerna i listan nu',
    'set.reloadLists': 'Hämta alla kanallistor på nytt',
    'set.help': 'Hjälp',
    'set.about': 'Om appen och säkerhet',

    'source.loading': 'Hämtar…',
    'source.ok': '{n} kanaler',
    'source.secure': 'krypterad anslutning (https)',
    'source.insecure': 'INTE krypterad – leverantören erbjuder inte https',
    'source.type.m3u_url': 'M3U-spellista (webbadress)',
    'source.type.m3u_file': 'M3U-spellista (fil)',
    'source.type.xtream': 'Xtream-inloggning',
    'source.addUrl': 'M3U-webbadress',
    'source.addFile': 'M3U-fil',
    'source.addXtream': 'Xtream-inloggning',
    'source.addTitle.m3u_url': 'Lägg till en betald spellista (webbadress)',
    'source.addTitle.m3u_file': 'Lägg till en betald spellista (fil)',
    'source.addTitle.xtream': 'Lägg till en betaltjänst (Xtream-inloggning)',
    'source.added': '”{name}” har lagts till. Kanalerna dyker upp om några sekunder.',
    'source.removeTitle': 'Ta bort källan?',
    'source.removeText': 'Ta bort ”{name}” och dess kanaler från den här enheten?',
    'source.err.http_blocked': 'Leverantören erbjuder bara okrypterad http, som webbläsare blockerar på en säker (https) sida. Använd LG-TV-appen eller Windows-appen, eller be leverantören om en https-adress.',
    'source.err.unreachable': 'Det gick inte att nå leverantören från webbläsaren. Antingen är adressen fel, eller så tillåter leverantören inte att webbläsare läser listan (CORS). Prova att ladda ner spellistan som fil och lägga till filen, eller använd Windows-appen.',
    'source.err.download_failed': 'Det gick inte att hämta spellistan ({detail}).',
    'source.err.login_rejected': 'Leverantören godkände inte användarnamnet eller lösenordet.',
    'source.err.login_failed': 'Det gick inte att logga in hos tjänsten ({detail}).',
    'source.err.bad_address': 'Serveradressen ser inte rätt ut.',
    'source.err.unknown_type': 'Okänd typ av källa.',

    'form.intro.m3u_url': 'Leverantören ger dig en lång länk, ofta slutar den på .m3u eller innehåller get.php.',
    'form.intro.m3u_file': 'En spellistefil som du laddat ner från leverantörens egen webbplats.',
    'form.intro.xtream': 'Leverantören ger dig en serveradress, ett användarnamn och ett lösenord.',
    'form.name': 'Namn (valfritt namn)',
    'form.url': 'Spellistans adress',
    'form.urlHint': 'Börjar med https:// eller http://',
    'form.server': 'Serveradress',
    'form.serverHint': 'Till exempel http://example.com:8080',
    'form.username': 'Användarnamn',
    'form.password': 'Lösenord',
    'form.file': 'Spellistefil',
    'form.privacy': 'Sparas bara på den här enheten och skickas aldrig någon annanstans än till din leverantör.',
    'form.missing': 'Fyll i alla rutor.',
    'form.badUrl': 'Det är ingen webbadress (den måste börja med https:// eller http://).',

    'action.retry': 'Försök igen',
    'action.close': 'Stäng',
    'action.cancel': 'Avbryt',
    'action.save': 'Spara',
    'action.reload': 'Hämta igen',
    'action.remove': 'Ta bort',

    'help.keys': 'Titta på en kanal: välj en grupp och klicka på kanalen\n' +
                 'Sök: skriv i sökrutan, eller tryck /\n' +
                 'Favorit: stjärnan vid kanalen, eller medan du tittar\n' +
                 'Helskärm: F, helskärmsknappen eller dubbelklicka på bilden; Esc för att lämna\n' +
                 'Föregående/nästa kanal: Page Up/Page Down\n' +
                 'Paus: mellanslag · Ljud av/på: M\n' +
                 'Hoptryckt bild eller svarta kanter: knappen Bild',
    'help.tv': 'Pilar och OK: flytta och välj\n' +
               'När du väljer en kanal visas den i helskärm; Tillbaka går till listan\n' +
               'I helskärm: ▲ ▼ eller CH +/- byter kanal, OK visar knapparna\n' +
               'Röd knapp: lägg till eller ta bort favorit\n' +
               'Grön knapp: helskärm · Gul: sök · Blå: inställningar\n' +
               'Magic Remote-pekaren fungerar också överallt',

    'about.text': 'Clearstream visar lagliga gratiskanaler från den offentliga listan iptv-org, strikt filtrerad (inga piratkopior av betalkanaler), plus betaltjänster som du själv lägger till. Ingen reklam, ingen spårning, inga konton. Appen ansluter bara till iptv-org (kanallistan, en gång per dygn), kanalernas egna strömmar och logotyper, och de tjänster du själv lägger till.',
    'about.free': 'Gratis och lagliga nyheter finns det gott om. Live-sändningar av stor fotboll, tennis och cricket säljs till betaltjänster, så gratisutbudet där är tunt: mest klassiska matcher, magasin och mindre evenemang.',
    'about.version': 'Clearstream webbapp {v}',

    'info.title': 'Om kanalen',
    'info.titleIdle': 'Bra att veta',
    'info.country': 'Land',
    'info.groups': 'Grupp',
    'info.source': 'Källa',
    'info.free': 'Gratiskanal (iptv-org)',
    'info.streams': 'Strömmar',
    'info.streamsOne': '1 ström',
    'info.streamsMany': '{n} strömmar – byter själv till en reserv om en slutar fungera',
    'info.keys': 'Kortkommandon: F helskärm · M ljud · Page Up/Down byt kanal · / sök · mellanslag paus',
    'info.keysTv': 'Fjärrkontroll: röd = favorit · grön = helskärm · gul = sök · blå = inställningar · CH +/- byt kanal'
  };

  var DICTS = { en: en, sv: sv };
  var current = 'en';

  function deviceLang() {
    var langs = (root.navigator && (root.navigator.languages || [root.navigator.language])) || [];
    for (var i = 0; i < langs.length; i++) {
      var code = String(langs[i] || '').slice(0, 2).toLowerCase();
      if (DICTS[code]) return code;
    }
    return 'en';
  }

  function setLang(choice) {
    current = DICTS[choice] ? choice : deviceLang();
  }

  /** The text for `key` with {placeholders} filled in; the key itself if there's no such text. */
  function t(key, params) {
    var text = DICTS[current][key];
    if (text === undefined) text = en[key];
    if (text === undefined) return key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m; });
    }
    return text;
  }

  CS.i18n = { t: t, setLang: setLang, lang: function () { return current; }, DICTS: DICTS };
})(this);
