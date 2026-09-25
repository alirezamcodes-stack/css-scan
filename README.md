# StyleScan Ultra

Eine eigenständige und kostenlose Chrome-Erweiterung zum Untersuchen und Bearbeiten von CSS. Sie läuft auf der von Ihnen ausgewählten Seite, liest zugängliches CSS aus und zeigt die Ergebnisse direkt dort an.

## Installation in Chrome

1. Speichern Sie diesen Ordner auf Ihrem Computer.
2. Öffnen Sie in Chrome die Adresse `chrome://extensions`.
3. Aktivieren Sie den **Entwicklermodus**.
4. Klicken Sie auf **Entpackte Erweiterung laden** und wählen Sie diesen Ordner aus.
5. Öffnen Sie eine normale `http`- oder `https`-Seite, klicken Sie auf das Erweiterungssymbol und aktivieren Sie den Inspector.

Für die lokale Installation sind weder ein Konto noch ein Server oder der Kauf von CSS Scan erforderlich. Nach Änderungen an den Erweiterungsdateien klicken Sie unter `chrome://extensions` auf **Neu laden** und laden Sie anschließend auch die untersuchte Webseite neu.

## Verwendung

- Bewegen Sie den Mauszeiger über ein Element, um dessen Rahmen und CSS anzuzeigen; ein Klick fixiert das Element.
- Unter **Inspect** können Sie zwischen lesbaren Originalregeln und berechneten Werten wechseln. **Cascade diagnostics** zeigt Regelname, Quelle, Selector-Spezifität und den ungefähren Status jeder Deklaration. Sie können CSS, HTML oder eine HTML+CSS-Komponente kopieren.
- Unter **Visual** können Sie Eigenschaften ändern und das Ergebnis live sehen.
- Unter **DOM** können Sie zwischen Eltern-, Kind- und Geschwisterelementen navigieren.
- Unter **Tokens** sehen Sie Farben, Schriftarten, CSS-Variablen und Bilder innerhalb des Elements.
- Unter **Changes** können Sie Änderungen zurücksetzen oder CSS bzw. JSON exportieren.
- Tastenkürzel bei aktivem Werkzeug: `Space` zum Fixieren/Lösen, `P` zum Pausieren/Fortsetzen, Pfeiltasten zur DOM-Navigation bei fixiertem Element, `Esc` zum Schließen. `Alt+Shift+S` öffnet das Erweiterungsfenster.

## Genauigkeit und Einschränkungen

StyleScan Ultra liest originale CSS-Regeln über die CSSOM und behält geschriebene Werte bei, sofern sie zugänglich sind. Manche Stylesheets aus anderen Domains oder bestimmte Browserstrukturen erlauben keinen Zugriff auf Regeln; in diesem Fall zeigt die Erweiterung den berechneten Wert an und weist darauf hin. Beim Kopieren einer Komponente werden für Kind-Elemente berechnete Snapshots verwendet. Daher entspricht die Ausgabe nicht auf jeder Website exakt dem ursprünglichen Quellcode.

Der Status **candidate** in Cascade diagnostics bezeichnet lediglich die stärkste Deklaration unter den lesbaren Author-Regeln und garantiert nicht, dass dies tatsächlich der finale Browserwert ist. Wenn die Priorität nicht eindeutig bestimmt werden kann, etwa bei bestimmten Layers, Scopes, Container Queries oder Shorthands, wird der Status **unknown** angezeigt.

Chrome erlaubt die Ausführung der Erweiterung nicht auf internen Seiten wie `chrome://` oder im Chrome Web Store. Live-Änderungen bleiben nur bis zum Neuladen der Seite bestehen; verwenden Sie den Bereich **Changes**, um sie zu exportieren. Die Tailwind-Konvertierung ist eine grundlegende Umsetzung häufiger Eigenschaften und sollte anschließend überprüft werden.

## Datenschutz

Die Erweiterung wird erst nach dem Öffnen ihres Fensters und ausschließlich im aktiven Tab injiziert. Es werden keine Seiteninhalte, CSS-Daten oder sonstigen Informationen an einen Server gesendet. Einstellungen werden in `chrome.storage.sync` gespeichert. CodePen-Export und Cloud-Funktionen sind in der lokalen Version bewusst nicht enthalten.

## Projektstruktur

- `manifest.json`: Berechtigungen und Manifest-V3-Konfiguration
- `background.js`: injiziert die Erweiterung ausschließlich in den aktiven Tab
- `src/engine.js`: CSS-Extraktion, Pseudo-Elemente, Media Queries und sicheres HTML
- `src/content.js` und `src/overlay.css`: Werkzeuge auf der Seite
- `popup.*`: Schnellsteuerung der Erweiterung
- `options.*`: Einstellungen
- `icons/`: Erweiterungssymbole
- `PLAN.md`: Architektur und Entwicklungsplanung

## Überprüfung

Die Erweiterung selbst benötigt weder Node.js noch installierte Pakete zur Ausführung. Für Entwicklung und Tests installieren Sie Node.js 24 oder neuer und führen Sie `npm run check` sowie `npm test` aus.

Der Integrationstest wird ausschließlich mit **Google Chrome for Testing** ausgeführt: Hinterlegen Sie den Pfad zu `chrome.exe` in der Umgebungsvariable `STYLESCAN_CHROME` und starten Sie anschließend `npm run test:chrome`. Der Test verwendet ein temporäres Profil. Neuere Versionen von Google Chrome akzeptieren das Laden von Erweiterungen per Kommandozeilen-Flag nicht mehr; die manuelle Installation über **Entpackte Erweiterung laden** wird weiterhin unterstützt.

Falls Richtlinien auf dem Computer verhindern, dass Browser-Sandbox-Prozesse während des temporären Tests ausgeführt werden, kann ausschließlich für diesen Test `STYLESCAN_TEST_NO_SANDBOX=1` gesetzt werden. Diese Option wird beim normalen Betrieb der Erweiterung nicht verwendet.

Zum Paketieren erzeugen `npm run package:zip` oder `scripts/package.ps1` eine ZIP-Datei mit den benötigten Dateien. Für ein lokales Update ersetzen Sie die Dateien und laden die Erweiterung unter `chrome://extensions` neu. Änderungen jeder Version werden in `CHANGELOG.md` dokumentiert.
