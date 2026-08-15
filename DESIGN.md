# DESIGN.md

**System name: Instrument.** Approved by the founder 5 Aug 2026 as direction A, a hybrid of sampler directions 1 (Aurora Glass) and 5 (Enterprise Premium).

## Visual theme

A warm, quiet instrument panel anchored by a deep navy structural band. The warm ground carries the calm; the navy is authority; Instrument Amber is the only thing that asks you to act.

**Colour strategy: Committed.** Navy carries the structure, the warm ground carries the calm, amber carries every action. Not restrained-neutral, not drenched. This superseded the 5 Aug cool-navy reading: the palette was regrounded to Instrument Amber under founder delegation on 8 Aug and applied to the site in Phase 2b (15 Aug). Oracle red is dropped entirely.

**Theme: light.** The scene: a DBA at a desk in an office at 10am, mid-morning, checking whether last night's batch held. Not an incident. Not 3am. Light is correct.

## Palette

Instrument Amber, applied 15 Aug 2026 (Phase 2b). Every value below is the shipped token in `src/styles/global.css`. The logo, the email design system and the pack HTML outputs carry the same palette.

| Role | Value | Use |
|---|---|---|
| Field | `#F7F5F1` | page ground, warm near-white |
| Surface | `#FFFFFF` | cards, panels |
| Field 2 (panel) | `#EFEAE2` | recessed ground: strips, table heads, code chips |
| Ink | `#1C1917` | headlines, primary text |
| Ink 2 | `#4A443D` | body |
| Ink 3 | `#6A6156` | captions, muted |
| Hairline | `#E0D9CD` | borders, rules |
| **Action (Instrument Amber)** | `#8A4B12` | buttons, eyebrows, wordmark accent, selected plan. 6.23:1 on Field, white-on-action 6.78:1 |
| Action hover | `#6E3B0E` | |
| Signal (gold), mark | `#E0A020` | marks only. 2.09:1 as text, so **never a word** |
| Signal (gold), text | `#7E5E08` | the legible variant, 5.52:1 on Field, for the rare signal-in-text |
| Deep (navy band) | `#0B1B34` to `#0E2A52` to `#0B4A6F` | the structural band, 158deg. **Unchanged: navy carries the structure** |
| On deep | `#9FB6D4` | every word on the navy band that is not a heading |
| Deep eyebrow | `#EBB84D` | the eyebrow on the navy band, amber-gold, 5.17:1 on the lightest band stop `#0B4A6F`. The coral it replaced was a tint of the dropped red |
| Quiet blue | `#1F5AA8` | the emphasised headline clause. Kept, navy family, 6.25:1 on Field |
| Signal OK, mark | `#2A9160` | the live dot, borders, fills. **Never a word.** |
| Signal OK, text | `#1F6B45` | the same signal written out: "read-only", "Clear". 5.94:1 on Field (ratified "done") |

There is no fourth ink. `--ink-4` existed at `#8592A8`, a near duplicate of Ink 3 that
measured 3.04:1 on the field while carrying price text; it now resolves to `--ink3` and
the name survives only for its remaining call sites.

Muted colours are sized against the **darkest ground they are ever painted on**, which is
`--field-2 #EFEAE2` in the footer and the marquee, not white. Measured on rendered pixels:
Ink 3 5.07:1, Signal OK text 5.40:1 on that ground. **Ink 3 is a web floor.** The cross-surface
email design system ratifies Ink 3 as `#787065`, which measures 4.07:1 on the warm panel and
fails the 4.5 web rule for 11px labels, so the website darkens it to `#6A6156`. The email value
is retained for email (its type sits larger); the divergence is a measured delta, not drift.

**Aurora: DELETED (Phase 2b, 8 Aug ruling).** The system previously carried three blurred blooms behind the hero, one of them Oracle red. It is gone entirely: the red bloom was a tint of the dropped colour, and its 28s drift dropped the hero eyebrow to 3.01:1. The hero now sits on the plain warm ground.

Never `#000` or `#fff` for text. No gradient text anywhere. No glass except the single hero artifact panel.

## Typography

- **Display: Sora** 700/800. Headlines, plan names, section heads. Tracking `-.038em` at large sizes.
- **Body: Archivo** 400/500/600. Chosen over Inter deliberately: Inter is the era's default interface font and costs distinctiveness. Archivo is a sturdier grotesque that reads as engineered rather than neutral.
- **Mono: JetBrains Mono** 500/600. Labels, metrics, eyebrows, anything that is data. Uppercase with `.12em` tracking for labels.

Scale is fluid `clamp()`, ratio at least 1.25. Body capped at 65 to 75ch. Light-on-navy text gets `+0.05` line-height.

**Headline line breaks are authored, never left to the browser.** Each sentence of the positioning line owns its own line. Ragged mid-sentence breaks are a defect.

## Layout

Left-aligned, asymmetric. Content max 1240px, generous 56px gutters on desktop, 24px on mobile. A faint 112px vertical grid overlay behind the hero, masked to fade downward, so the field reads as measured rather than empty.

The **navy band** uses `clip-path: polygon(0 6%, 100% 0, 100% 100%, 0 100%)` for a diagonal top edge, with the plan cards sitting over it. This is the structural signature of the system.

Cards only where they are the right affordance: plans and packs. Bordered white, never glass, never nested.

## Motion

Purposeful only. Everything below early-returns to its final state under `prefers-reduced-motion` or at `max-width: 767px`.

- **Hero entrance**: staggered reveal, 70ms apart, `cubic-bezier(.16,1,.3,1)` (ease-out-expo). Eyebrow, headline lines in sequence, lede, actions, meta strip.
- **The artifact panel**: enters last, lifts in, and its rows fill in sequence with the check count animating up. This dramatizes the product's actual output, which is the point.
- **Scroll reveals**: sections rise 18px and fade in via IntersectionObserver, once, never repeating.
- **Hover**: plan cards lift 3px with an amber border on the selected tier; buttons deepen and lift 1px.
- **The live dot** pulses at 2.4s.

Never animate layout properties. Transform and opacity only.

## Components

- **Eyebrow**: mono, uppercase, `.16em`, Instrument Amber.
- **Button primary**: amber, 9px radius, 15px Archivo 600, shadow `0 8px 22px rgba(138,75,18,.26)`.
- **Button secondary**: white, hairline border, same geometry.
- **Artifact panel**: the one glass surface. `rgba(255,255,255,.62)` + `blur(18px)`, 16px radius, showing a real report with the dual-output pair at its foot.
- **Meta strip**: mono labels above Archivo values, separated by a hairline.
- **Plan card**: white, hairline border, 13px radius; the selected tier takes a 1.5px amber border and an amber eyebrow.

## Accessibility

Every piece of text clears 4.5:1 against the ground it actually sits on, measured from the
rendered pixels rather than from the token's value on white, because the same token sits on
the field, on `--field-2` and on the glass panel and only the tightest of those counts.
Colour that is not text (the live dot, a border, a fill) carries no ratio requirement and
keeps its brightness. Focus states are visible on every interactive element. The live-state
colour is always paired with a word, never colour alone.

The two known exceptions were both Oracle red and are both **resolved by Phase 2b**:

- **The hero eyebrow on the aurora** measured 3.01:1 over the drifting blue bloom. The aurora
  is deleted, so the eyebrow now sits amber `#8A4B12` on the plain warm ground at 6.23:1.
- **Amber on the amber-tinted chips.** `#8A4B12` on `--red-faint` `rgba(138,75,18,.07)` over the
  warm ground measures **5.62:1**, up from 4.16:1 (`.ace-btn`) and 3.99:1 (`.ab-p`) in Oracle red.

## Superseded legacy classes

The Instrument primitives were added **beside** the legacy set, not in place of it, so both
ship. This is the retirement map: each legacy name below is now fully expressed by the
Instrument primitive beside it. Retiring them is a separate pass; nothing here is urgent,
and nothing here should be done piecemeal without re-measuring the page it touches.

### Cards, 12 implementations of one idea

`.i-card` (white, `--hair` border, `--r-card`, 3px hover lift) supersedes:

| Legacy | Where | Note |
|---|---|---|
| `.glass-card` | global.css | already de-glassed to a plain card |
| `.PC` | global.css | post card, adds a cover slot |
| `.promo-card` | global.css | adds `.promo-alt` on `--field-2` |
| `.svc-card` | global.css | |
| `.ai-tool-card` | global.css | |
| `.ai-chat-full` | global.css | |
| `.cmt-item` | global.css | |
| `.cmt-form` | global.css | |
| `.inst .plan` | instrument.astro | keeps the `.is-pick` red-border modifier |

Deliberately **not** cards, leave them: `.ai-result` (a scrolling output well),
`.cmt-reply-form` (an inset on `--field-2`), `.inst-pack` (a ledger row, hairline only).

### Buttons

`.i-btn` + `.i-btn-primary` supersedes `.BP`, `.svc-cta.primary`, `.cmt-submit`,
`.ai-tool-btn`, `.NB`. `.i-btn` + `.i-btn-ghost` supersedes `.BS`, `.svc-cta.secondary`.

### Eyebrows

`.i-eyebrow` (mono 11px 600, `.16em`, Instrument Amber) supersedes `.SK`, `.EBW span`, `.art-cat`,
`.CC`, `.promo-cta`, and the label half of `.inst-onward`.
`.i-eyebrow.i-eyebrow-deep` supersedes `.NK`.

### Mono labels

`.i-label` (mono 10.5px 600, `.12em`, `--ink3`) supersedes `.HSL`, `.auth-role`,
`.art-share-label`, `.FC h4`, `.cmt-date`, `.cmt-rating-row label`, `.ai-msg-role`,
`.plan-k`, and `.SRC` in a red variant.

### Meta strips

`.i-meta` supersedes `.art-meta`, `.CMT`, `.FB2`, and `.tools-facts` in a pill variant.

### The measure

`.i-shell` (1240px, 56px gutters) supersedes `.SW2` and `.more-posts` directly. `.HI`,
`.FI` and `.FB2` use a different 1360px/32px measure; reconcile the two numbers before
touching those, because that is a visual decision and not a cleanup.

### The radius ladder, two ladders on top of each other

| Legacy | Consumers | Instrument |
|---|---|---|
| `--r-sm` 7px | 14 | `--r-btn` 9px |
| `--r-md` 11px | 14 | `--r-card` 13px |
| `--r-lg` 13px | 1 | `--r-card` 13px, an exact duplicate value |
| `--r-pill` 999px | 5 | no equivalent, **keep** |

29 consumers sit on the three superseded steps. `--r-sm` to `--r-btn` and `--r-md` to
`--r-card` both change a real radius, so each is a look change, not a rename.
