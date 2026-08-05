# DESIGN.md

**System name: Instrument.** Approved by the founder 5 Aug 2026 as direction A, a hybrid of sampler directions 1 (Aurora Glass) and 5 (Enterprise Premium).

## Visual theme

A pale, cool instrument panel lit by a slow aurora, anchored by a deep navy structural band. The light is atmosphere; the navy is authority; Oracle red is the only thing that asks you to act.

**Colour strategy: Committed.** Navy carries the structure, the aurora field carries the mood, red carries every action. Not restrained-neutral, not drenched.

**Theme: light.** The scene: a DBA at a desk in an office at 10am, mid-morning, checking whether last night's batch held. Not an incident. Not 3am. Light is correct.

## Palette

| Role | Value | Use |
|---|---|---|
| Field | `#FAFBFD` | page ground, cool near-white tinted toward navy |
| Surface | `#FFFFFF` | cards, panels |
| Ink | `#0B1B34` | headlines, primary text |
| Ink 2 | `#4D5A74` | body |
| Ink 3 | `#626C80` | captions, muted |
| Hairline | `#DFE5EE` | borders, rules |
| **Action (Oracle red)** | `#C74634` | buttons, eyebrows, wordmark accent, selected plan |
| Action hover | `#A83A2B` | |
| Deep (navy band) | `#0B1B34` to `#0E2A52` to `#0B4A6F` | the structural band, 158deg |
| On deep | `#9FB6D4` | every word on the navy band that is not a heading |
| Quiet blue | `#1F5AA8` | the emphasised headline clause |
| Signal OK, mark | `#1FA37A` | the live dot, borders, fills. **Never a word.** |
| Signal OK, text | `#17785A` | the same signal written out: "read-only", "Clear", the price lock |

There is no fourth ink. `--ink-4` existed at `#8592A8`, a near duplicate of Ink 3 that
measured 3.04:1 on the field while carrying price text; it now resolves to `--ink3` and
the name survives only for its remaining call sites.

Muted colours are sized against the **darkest ground they are ever painted on**, which is
`--field-2 #F1F4FA` in the footer and the marquee, not white. Measured on rendered pixels:
Ink 3 4.79:1, Signal OK text 4.80:1 on that ground.

**Aurora field**, three blooms at low opacity behind the hero, blurred 46px: navy `rgba(31,90,168,.42)` upper left, teal `rgba(31,163,122,.36)` upper right, Oracle red `rgba(199,70,52,.30)` centre. The red bloom is what stops this being the stock purple-orange SaaS aurora: the light belongs to this brand.

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

- **Aurora drift**: the field translates and scales very slowly, 28s, infinite alternate. Life without distraction.
- **Hero entrance**: staggered reveal, 70ms apart, `cubic-bezier(.16,1,.3,1)` (ease-out-expo). Eyebrow, headline lines in sequence, lede, actions, meta strip.
- **The artifact panel**: enters last, lifts in, and its rows fill in sequence with the check count animating up. This dramatizes the product's actual output, which is the point.
- **Scroll reveals**: sections rise 18px and fade in via IntersectionObserver, once, never repeating.
- **Hover**: plan cards lift 3px with a red border on the selected tier; buttons deepen and lift 1px.
- **The live dot** pulses at 2.4s.

Never animate layout properties. Transform and opacity only.

## Components

- **Eyebrow**: mono, uppercase, `.16em`, Oracle red.
- **Button primary**: red, 9px radius, 15px Archivo 600, shadow `0 8px 22px rgba(199,70,52,.26)`.
- **Button secondary**: white, hairline border, same geometry.
- **Artifact panel**: the one glass surface. `rgba(255,255,255,.62)` + `blur(18px)`, 16px radius, showing a real report with the dual-output pair at its foot.
- **Meta strip**: mono labels above Archivo values, separated by a hairline.
- **Plan card**: white, hairline border, 13px radius; the selected tier takes a 1.5px red border and a red eyebrow.

## Accessibility

Every piece of text clears 4.5:1 against the ground it actually sits on, measured from the
rendered pixels rather than from the token's value on white, because the same token sits on
the field, on `--field-2` and on the glass panel and only the tightest of those counts.
Colour that is not text (the live dot, a border, a fill) carries no ratio requirement and
keeps its brightness. Focus states are visible on every interactive element. The live-state
colour is always paired with a word, never colour alone.

Two known exceptions, both Oracle red, both predating the Instrument rebuild, neither one
resolvable without a founder decision:

- **The hero eyebrow on the aurora.** `#C74634` at 11px over the blue bloom measures
  **3.01:1 at its worst point in the 28s drift** (worst ground `#BCCEE5`). Clearing 4.5
  needs either the brand red darkened or the blue bloom's declared alpha cut from `.42` to
  about `.03`, which is the aurora deleted. Even `--act-2 #A83A2B` only reaches 4.01:1 there.
- **Red on the red-tinted chips.** `.ace-btn` label 4.16:1, `.ab-p` badge 3.99:1. Oracle red
  on `--red-faint`, a pairing the site has carried since before this system.

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

`.i-eyebrow` (mono 11px 600, `.16em`, Oracle red) supersedes `.SK`, `.EBW span`, `.art-cat`,
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
