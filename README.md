# AI Engineer Case

**Timebox: 30–45 minutes / Minuten** · Deutsch zuerst, English below.

---

## 🇩🇪 Deutsch

Die **Falkenstein Maschinenbau GmbH** (fiktiv) baut Verpackungs- und Abfüllanlagen
für rund 800 Kunden. Im zentralen Service-Postfach landen täglich Dutzende E-Mails:
Rechnungsfragen, Lieferstatus von Ersatzteilen, technische Störungen — und dazwischen
die wirklich kritischen Fälle, etwa eine stehende Produktionslinie beim Kunden.
Bisher sortiert ein Mensch alles von Hand.

Du übernimmst ein kleines AI-Feature, das das automatisieren soll. Es liest jede
eingehende Nachricht und gibt drei Entscheidungen zurück:

```ts
{
  category: "technical" | "billing" | "delivery" | "other",
  priority: "normal" | "urgent",
  humanReview: boolean
}
```

- `category` — welches Team die Anfrage bekommt: Technik, Buchhaltung,
  Versand/Ersatzteile oder Rest.
- `priority` — `urgent` überspringt die Warteschlange und alarmiert den
  Bereitschaftsdienst.
- `humanReview` — `true` legt die Nachricht zusätzlich einem Menschen zur
  Kontrolle vor.

Beispiel: „Die Rechnung RE-2026-1187 enthält eine falsche Positionssumme" geht als
`billing / normal` in den normalen Buchhaltungs-Stapel. „Unsere komplette
Verpackungslinie steht seit heute Morgen" muss dagegen sofort beim
Bereitschaftsdienst landen.

Kontext aus dem Team:

- Eine falsche `category` verursacht manuelle Mehrarbeit, ist aber meist unkritisch.
- Eine wirklich dringende Anfrage als `normal` einzustufen heißt: ein Kunde bekommt
  zu spät Hilfe.
- `humanReview: true` ist sicher, kostet aber manuelle Arbeitszeit.
- Wenn fast alles an Menschen geht, hat das System keinen echten Automatisierungswert.

Die erste Version funktioniert ganz ordentlich, aber das Team traut ihr noch nicht
genug, um sich breiter darauf zu verlassen.

### Deine Aufgabe

Finde heraus, was schiefläuft, und verbessere das System.

Nutze die Zeit so, wie du sie für am sinnvollsten hältst. Ändern darfst du:

- den Prompt (`prompt.md`)
- Code
- Schema
- Auswertungslogik

Du musst keine neue Anwendung und keine neue Architektur bauen.

Nutze Claude Code, Cursor, Codex — oder womit du sonst normalerweise arbeitest.

### Setup

```
cp .env.example .env   # API-Key eintragen — den bekommst du von uns
npm install
npm run case
```

### Danach erklärst du uns

1. Wie du entschieden hast, ob das System gut oder schlecht ist
2. Was du gefunden hast
3. Was du geändert hast
4. Ob deine Änderung eine Verbesserung war
5. Was du als Nächstes tun würdest, bevor das in Produktion geht

Das war's. Wir suchen nicht die raffinierteste Lösung. Wir wollen verstehen, wie du
an die Frage herangehst: **Ist das gut genug, um sich darauf zu verlassen?**

---

## 🇬🇧 English

**Falkenstein Maschinenbau GmbH** (fictional) builds packaging and filling machinery
for around 800 customers. Dozens of emails land in the central service inbox every
day: invoice questions, spare-part delivery status, technical faults — and, in
between, the genuinely critical ones, such as a production line standing still at a
customer's plant. Until now, a human sorts all of it by hand.

You are taking over a small AI feature that is meant to automate this. It reads
every incoming message (in German) and returns three decisions:

```ts
{
  category: "technical" | "billing" | "delivery" | "other",
  priority: "normal" | "urgent",
  humanReview: boolean
}
```

- `category` — which team receives the request: technical service, accounting,
  shipping/spare parts, or everything else.
- `priority` — `urgent` skips the queue and alerts the on-call service team.
- `humanReview` — `true` additionally puts the message in front of a human for review.

Example: "Invoice RE-2026-1187 contains a wrong line-item total" goes into the
regular accounting pile as `billing / normal`. "Our entire packaging line has been down since this
morning" must reach the on-call team immediately.

Some context from the team:

- A wrong `category` causes extra manual work, but is usually not critical.
- A truly urgent request classified as `normal` means a customer gets help too late.
- `humanReview: true` is safe, but costs manual working time.
- If almost everything goes to human review, the system has no real automation value.

The first version works reasonably well, but the team is not confident enough to
rely on it more broadly.

### Your task

Figure out what is going wrong and improve the system.

Use the time however you think is most useful. You may change:

- the prompt (`prompt.md`)
- code
- schema
- evaluation logic

You do not need to build a new application or architecture.

Use Claude Code, Cursor, Codex or whatever tools you normally use.

### Setup

```
cp .env.example .env   # add the API key we provide to you
npm install
npm run case
```

### When you're done, be ready to explain

1. How you decided whether the system was good or bad
2. What you found
3. What you changed
4. Whether the change improved it
5. What you would do next before putting it into production

That's it. We're not looking for the most sophisticated solution. We want to
understand how you approach the question: **Is this good enough to rely on?**
