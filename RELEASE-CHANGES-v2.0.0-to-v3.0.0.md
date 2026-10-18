# Release-Wechsel-Dokumentation: Autocomplete Whisper v2.0.0 → v3.0.0

Zweck: Nachvollziehen, **was** gegenüber v2.0.0 geändert wurde und **warum** (Foundry VTT V14).

| | |
|---|---|
| Modul-ID | `autocomplete-whisper` |
| Alte Version | 2.0.0 (Foundry V13, `compatibility.minimum/verified = 13`) |
| Neue Version | 3.0.0 (Foundry V14, `minimum = 14`, `verified = 14.369`) |
| Geprüft gegen | Foundry VTT 14.369.0 (lokal installierter Client-Quellcode) |
| Breaking Change | Ja: läuft nicht mehr unter V13 (Chat-Eingabe ist dort ein anderes Element) |

---

## 1. Zusammenfassung

In V14 ist das Chat-Eingabefeld kein `<textarea>` mehr, sondern ein **ProseMirror-Editor** (`<prose-mirror id="chat-message">`). jQuery steht nicht mehr zur Verfügung. Der gesamte Code von v2.0.0 hing an beidem und wäre in V14 nicht lauffähig (`$ is not defined`; Textarea-Handler greifen nicht).
Deshalb wurde die Integration **neu geschrieben**, die fachliche Whisper-Logik (Regex, Filter, Klammer-Syntax) wurde übernommen.

---

## 2. Dateiübersicht

| Datei | Status | Inhalt der Änderung |
|---|---|---|
| `dist/scripts/autocomplete-whisper.js` | **entfernt** | Ersetzt durch die zwei `.mjs`-Dateien unten |
| `dist/scripts/autocomplete-whisper.mjs` | **neu** | Foundry-Integration: Einstellung, ProseMirror-Plugin, Menü, Ghost-Text |
| `dist/scripts/whisper-logic.mjs` | **neu** | Reine Logik ohne Foundry/DOM-Abhängigkeit (testbar) |
| `dist/styles/autocomplete-whisper.css` | **geändert** | Komplett neu (alter Inhalt war textarea-/Sidebar-spezifisch) |
| `dist/languages/en.json`, `de.json` | **neu** | Lokalisierung der Einstellung |
| `dist/module.json` | **geändert** | Siehe Abschnitt 3 |
| `package.json` | **geändert** | `version` 3.0.0, `main` → `.mjs` |
| `package-lock.json` | **geändert** | `version` 3.0.0 |
| `README.md` | **geändert** | Tippfehler „Pres TAB“ → „Press TAB“, Release-Notes v3.0.0 |
| `_backup/installed-2.0.0/` | **neu** | Sicherung der zuvor installierten v2.0.0 |
| `LICENSE`, `versionbump.js`, `playtest.py`, `.gitignore`, `demo/*` | unverändert | |

Hinweis: `.vscode/tasks.json` (7z-Task) ist unverändert und packt nur `scripts styles module.json`, **nicht** `languages`. Der Task ist veraltet; `versionbump.js` packt den ganzen `dist`-Ordner und ist davon nicht betroffen.

---

## 3. `module.json`

| Feld | v2.0.0 | v3.0.0 |
|---|---|---|
| `version` | `2.0.0` | `3.0.0` |
| `scripts` | `["scripts/autocomplete-whisper.js"]` | entfernt |
| `esmodules` | – | `["scripts/autocomplete-whisper.mjs"]` |
| `languages` | – | `en`, `de` |
| `manifest` / `download` | `.../v2.0.0/...` | `.../v3.0.0/...` |
| `compatibility` | `13` / `13` | `14` / `14.369` |

Achtung: Die `manifest`- und `download`-URLs zeigen auf ein GitHub-Release `v3.0.0` des ursprünglichen Autors. Dieses Release existiert erst, wenn es veröffentlicht wurde.

---

## 4. V14-Inkompatibilitäten und Ersatz

| # | v2.0.0 (alt) | Problem in V14 | v3.0.0 (neu) |
|---|---|---|---|
| 1 | `$`/jQuery überall (`$("body").on(...)`) | Kein jQuery-Global mehr | Natives DOM und ProseMirror-API |
| 2 | Chat-Feld `<textarea id="chat-message">`, `.val()` | Feld ist `<prose-mirror>` mit ProseMirror-Dokument | Plugin liest/schreibt per `EditorState`/Transaktion |
| 3 | `$("body").off("keydown", "#chat-message")` und Ersatz-Handler, der `ui.chat._onKeyDown(e)` aufruft | Handler existiert nicht mehr; Tastatur läuft über `ChatInputPlugin` | Kein Eingriff in Foundrys Tastatur-Handler mehr; eigenes Plugin ergänzt nur |
| 4 | Hooks `activateChatLog`, `deactivateChatLog` | In V14 nicht mehr vorhanden | Entfallen; stattdessen `renderChatInput` und `collapseSidebar` |
| 5 | Eigenes Menü (`#context-menu`, `<nav>`, Fokus-Handling, eigene Pfeiltasten-Logik) | Eigenbau nötig, brüchig | Natives `foundry.applications.ux.Autocomplete` (Pfeile, Enter, Tab, Esc inklusive) |
| 6 | Ghost-Text als zweites, deckungsgleiches `<textarea>` | Nicht über ProseMirror-Editor legbar | Absolut positioniertes `<span class="acw-ghost">` am Cursor (`coordsAtPos`) |
| 7 | Skript klassisch geladen (`scripts`) | – | ES-Modul (`esmodules`) |

**Einhängepunkt:** `Hooks.once("setup")` umhüllt `CONFIG.ui.chat.prototype._onConfigurePlugins` und fügt unser Plugin hinzu, wenn das Event vom `#chat-message` stammt. Die Methode ist `protected` (nicht öffentliche API) – bei künftigen Foundry-Updates zuerst hier prüfen.

---

## 5. Verhaltensänderungen

| Bereich | v2.0.0 | v3.0.0 |
|---|---|---|
| Menü-Optik | Eigenes Kontextmenü | Foundrys Autocomplete-Menü, öffnet **über** dem Eingabefeld (wenn Platz) |
| Menü-Einträge | HTML-String, Namen **unescaped** | DOM-Knoten (`textContent`), Icon + fett markierte Treffer |
| Tab | Vervollständigt nur bei eindeutigem Treffer | Gleich: Bei eindeutigem Präfix-Treffer wird der Eintrag vorgewählt, Tab/Enter vervollständigt |
| Schreibweise | Behielt getippte Groß/Kleinschreibung | Setzt den **Original-Namen** ein (`/w bo` → `/w Bob`) |
| `]` zum Schließen | Prüfte `which == 221` (nur US-Layout) | Prüft `event.key === "]"` (alle Layouts, z. B. Deutsch) |
| Geltungsbereich | Gesamter Text | Nur erster Absatz, nur Text **vor** dem Cursor; Text hinter dem Cursor bleibt erhalten |
| Fokus | Menü auch ohne Fokus möglich | Menü nur bei fokussiertem Editor; schließt bei Blur, Sidebar-Einklappen, Umhängen des Eingabefelds |
| Einstellung | Text fest auf Englisch | Lokalisiert (en, de) über `AUTOCOMPLETE_WHISPER.Settings.IncludeGMNames.*` |

Unverändert: Einstellungs-Schlüssel `includeGMNamesInList` (Welt-Einstellung, Standard `false`), Syntax `/w`, `/whisper`, `/w [a, b]`, Sonderziele `Players` und `GM`, Filter (Teilstring, Groß/Klein egal, bereits gewählte Ziele ausgeblendet, „Players“ blendet alle Spieler aus, „GM“ alle GMs).

---

## 6. Entfernte Funktionen

1. **Ghost-`[` bei gedrückter Shift-Taste** (Vorschau, dass Shift-Auswahl eine Liste beginnt). Die Shift-Auswahl selbst funktioniert weiter.
2. **Schließen der Liste per Klick außerhalb des Menüs** (fügte dabei automatisch `]` ein). Bewusst entfernt, da unerwartet.

---

## 7. Behobene Fehler

| Fehler in v2.0.0 | Fix |
|---|---|
| Shift-Auswahl eines Namens **mit Leerzeichen** erzeugte `[[` (z. B. `/w [[Bad Guy] `) | Ergibt `/w [Bad Guy, ` |
| Namen wurden unescaped als HTML ins Menü geschrieben | Aufbau über DOM-Knoten |
| `off("keydown.shiftupghost")` im Else-Zweig meldete das falsche Event ab (Tippfehler `keydown` statt `keyup`) | Mit der Funktion entfallen |
| `]` funktionierte nur auf Layouts mit Keycode 221 | siehe Abschnitt 5 |
| Doppelte Namen im Menü möglich | Entdoppelt |

---

## 8. Prüfung

**Durchgeführt (Node v24, Electron-Runtime der Foundry-Installation):**
- Syntaxprüfung beider `.mjs`-Dateien; JSON-Prüfung von `module.json`, `en.json`, `de.json`.
- 23 Tests: reine Logik (Filter, Klammer-Syntax, Shift, `]`) sowie das Plugin gegen **echtes** `prosemirror-state`/`-model` aus Foundry 14.369 (Einhängen, Menü öffnen/schließen, Auswahl, Cursorposition, Text hinter dem Cursor, zweiter Absatz, Aufräumen).
- API-Abgleich gegen den lokalen V14-Quellcode (`chat.mjs`, `chat-input-plugin.mjs`, `autocomplete.mjs`, `hooks.mjs`, `config.mjs`).

**Nicht geprüft:**
- Lauf in einem echten V14-Client (Foundry war nicht gestartet).
- Optik und Position von Menü und Ghost-Text (im Test nur gestubbt), UI-Skalierung, Chat-Popout.
- Zusammenspiel mit anderen Chat-Modulen.

**Manuelle Abnahme (Checkliste):**
- [ ] Modul in V14-Welt aktivierbar, keine Konsolenfehler
- [ ] `/w ` zeigt Menü; Pfeile, Enter, Esc funktionieren
- [ ] `/w al` zeigt Ghost-Text, Tab ergänzt `/w Alice `
- [ ] Name mit Leerzeichen → `/w [Bad Guy] `
- [ ] Shift-Klick → `/w [Alice, `, danach nächstes Ziel, `]` schließt
- [ ] Einstellung „Spielleiter auflisten“ wirkt, Text erscheint auf Deutsch
- [ ] Chat in Sidebar **und** als Benachrichtigungs-Eingabe sowie im Popout
- [ ] Nachricht senden funktioniert nach Auswahl (Enter sendet, wenn Menü zu)

---

## 9. Installation und Rollback

- Installiert nach: `~/Library/Application Support/FoundryVTT/Data/modules/autocomplete-whisper` (identisch zu `dist`, per `diff -r` geprüft).
- Rollback auf v2.0.0 (nur für V13): Inhalt von `_backup/installed-2.0.0/` zurück in den Modulordner kopieren.
- Ursprünglicher `dist`-Stand zusätzlich im Session-Scratchpad gesichert (flüchtig, nicht dauerhaft verlassen).

## 10. Risiken und offene Punkte

1. **Protected API:** `ChatLog#_onConfigurePlugins` ist nicht offiziell öffentlich; Änderungen in V14-Updates oder V15 können das Einhängen brechen.
2. **Native Autocomplete-Labels als DOM-Knoten:** Die Typdefinition nennt `string`; die aktuelle Implementierung nutzt `append`, das beides akzeptiert.
3. **Release-URLs** in `module.json` zeigen auf noch nicht vorhandene Release-Dateien.
4. **Ghost-Text-Position** bei ungewöhnlicher UI-Skalierung ist ungetestet.
