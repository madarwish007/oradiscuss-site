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
| Ink 3 | `#7C879B` | captions, muted |
| Hairline | `#DFE5EE` | borders, rules |
| **Action (Oracle red)** | `#C74634` | buttons, eyebrows, wordmark accent, selected plan |
| Action hover | `#A83A2B` | |
| Deep (navy band) | `#0B1B34` to `#0E2A52` to `#0B4A6F` | the structural band, 158deg |
| Quiet blue | `#1F5AA8` | the emphasised headline clause |
| Signal OK | `#1FA37A` | live, healthy, read-only states |

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

Body text at least 4.5:1 on the field. Red on white passes for large text and UI; body copy never uses red. Focus states are visible on every interactive element. The live-state colour is always paired with a word, never colour alone.
