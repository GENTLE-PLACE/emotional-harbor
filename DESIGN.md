---
name: Эмоциональная Гавань
description: A warm, handmade-feeling Notion mood-diary landing page — parchment paper, dashed twine borders, and stamped postcard shadows.
colors:
  beige:
    role: neutral background, page canvas
    value: "#f7efe0"
  brown-dark:
    role: primary text, headline color
    value: "#3a3228"
  brown-mid:
    role: secondary text, quote/note color
    value: "#7a5840"
  brown-light:
    role: tertiary text, trust markers, meta labels
    value: "#9a7050"
  gold:
    role: borders, dividers, dashed trim, price labels
    value: "#c9a97a"
  pink:
    role: primary accent, CTAs, emphasis
    value: "#e87a9c"
  pink-soft:
    role: module accent (mood diary, stats)
    value: "#F8B4C0"
  yellow:
    role: module accent (central hub, warmth jar)
    value: "#F7D08A"
  green:
    role: module accent (energy sources)
    value: "#b8e0d2"
  blue:
    role: module accent (cozy content), science-card tint
    value: "#A5C2F1"
  module-purple:
    role: module accent ("my supports")
    value: "#e0c8f0"
typography:
  display:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "clamp(44px, 6vw, 80px)"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-3px"
  headline:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "clamp(26px, 3.8vw, 40px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-1.5px"
  title:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.3px"
  body:
    fontFamily: "Jost, sans-serif"
    fontSize: "15px"
    fontWeight: 300
    lineHeight: 1.85
  quote:
    fontFamily: "Lora, serif"
    fontStyle: italic
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.65
  label:
    fontFamily: "Unbounded, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "1px"
rounded:
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "28px"
  pill: "30px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "36px"
  xl: "48px"
  section: "72px"
components:
  button-primary:
    backgroundColor: "{colors.brown-dark}"
    textColor: "{colors.beige}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "20px 36px"
  button-primary-hover:
    backgroundColor: "{colors.brown-dark}"
    textColor: "{colors.beige}"
  button-accent:
    backgroundColor: "{colors.pink}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "20px 36px"
  button-accent-hover:
    backgroundColor: "#d96a8c"
    textColor: "#ffffff"
  card-default:
    backgroundColor: "rgba(255,248,235,0.65)"
    rounded: "{rounded.lg}"
    padding: "36px 40px 32px"
---

# Design System: Эмоциональная Гавань

## Overview

**Creative North Star: "The Paper Harbor"**

This is a cozy, handmade journal-scrapbook, not a software product. Every surface reads like it was cut from warm cardstock and pinned to a corkboard: parchment backgrounds, a faint hand-ruled grid underneath everything, dashed gold trim standing in for twine, and flat "stamped" shadows that look pressed into paper rather than cast by light. The mood is cozy, warm, unhurried, and tactile-handmade — quietly confident rather than saccharine or twee. It explicitly rejects the glossy, hard-edged, corporate-blue vocabulary of productivity software: no crisp drop shadows, no cold neutrals, no aggressive contrast. Есения's world should always feel like something you could hold, not something you operate.

Interaction confirms the paper metaphor rather than a digital one: cards lift by translating upward on hover while their offset shadow grows longer, the way a paper cutout casts more shadow the further it's lifted off the table — never a blur-radius fade.

**Key Characteristics:**
- Parchment-and-ink palette: warm beige canvas, espresso-brown text, kraft-gold trim
- Flat, un-blurred "stamped" shadows that lengthen on hover instead of softening
- Generous, consistent rounding — nothing sharp anywhere on the page
- Dashed borders and ruled-paper textures used as literal stationery references
- One rationed accent (rosewater pink) reserved for action and emotional emphasis
- A five-color "module accent" family marks categories the way tabs or stickers would

## Colors

Warm and paper-toned throughout; color is used sparingly as emphasis, not as a background language — most surfaces stay in beige/parchment and let one accent per element carry meaning.

### Primary
- **Rosewater Pink** (`#e87a9c`): the only accent used for action — primary CTA buttons, active/open states (FAQ, timeline dots on hover), links inside headlines (`<span>` emphasis), and section-title highlight words. Its hover state deepens to `#d96a8c` with a soft glow, the one place in the system a blurred shadow is allowed.

### Secondary
- **Kraft Gold** (`#c9a97a`): structural, not decorative — dashed card borders, dividers, the background grid lines (at 7% opacity), timeline dots, and price labels. Reads as string/twine, not jewelry.

### Neutral
- **Warm Beige** (`#f7efe0`): the page canvas; also the sticky-header wash at 88% opacity with blur.
- **Espresso Brown** (`#3a3228`): primary text and headline color; the darkest value in the system, never pure black.
- **Mid Brown** (`#7a5840`): secondary text — subtitles, quote color, worlds-bridge copy.
- **Light Brown** (`#9a7050`): tertiary text — trust markers, meta labels, icon fills.

### Module Accents (fixed set)
A five-color family used exclusively as a **role**, not a free palette: each diary module, science-concept card, or future category gets exactly one of these as its identifying accent (top-edge bar, corner glow, or icon tint). Never mix two module accents on one card; never use them for body text or as a page background.
- **Soft Yellow** (`#F7D08A`) — central hub / warmth-jar family
- **Soft Pink** (`#F8B4C0`) — mood-diary / stats family
- **Soft Green** (`#b8e0d2`) — energy-sources family
- **Soft Blue** (`#A5C2F1`) — cozy-content family; also the tint for science/evidence cards
- **Soft Purple** (`#e0c8f0`) — "my supports" family

### Named Rules
**The One-Accent Rule.** Rosewater Pink is the only color allowed to mean "act here." If a screen needs a second call to action, it is visually subordinate (brown-dark button) — never a second saturated hue.

**The No-Blur Rule.** Resting shadows never use blur; only the hover-only pink CTA glow is allowed a soft blurred halo, because it signals "this is the one thing to press," not ambient depth.

## Typography

**Display Font:** Unbounded (with sans-serif fallback) — heavy, geometric, rounded-terminal weight used only for headlines and labels, never for reading text.
**Body Font:** Jost (with sans-serif fallback) — light, quiet, humanist sans for anything meant to be read at length.
**Accent Font:** Lora italic (with serif fallback) — reserved for Есения's voice: pull-quotes, italic emphasis phrases, and anywhere the copy turns personal or reflective.

**Character:** A confident geometric display face paired with a soft, low-weight body face and an italic serif "voice" layer — the pairing does the emotional work: Unbounded states things, Jost explains them gently, Lora italic feels like a hand-written aside.

### Hierarchy
- **Display** (900, `clamp(44px, 6vw, 80px)`, line-height 0.92, letter-spacing -3px): hero title only.
- **Headline** (700, `clamp(26px, 3.8vw, 40px)`, line-height 1.05, letter-spacing -1.5px): section titles.
- **Title** (700, 18px, uppercase for module cards, sentence-case for Есения card): card and module headings.
- **Body** (300, 15px, line-height 1.8–1.85): paragraph copy; kept light-weight throughout, never regular/400 for long text.
- **Quote/Voice** (Lora italic, 600, ~14.5–20px, line-height 1.65–1.7): pull-quotes and Есения's reflective asides; often carries a 3px solid pink or gold left-border like a margin note.
- **Label** (Unbounded 700, 10–13px, letter-spacing 0.5–2px, uppercase): eyebrows, pills, chip tags, button text, price labels.

### Named Rules
**The Light-Body Rule.** Body copy is set at font-weight 300, never 400+. Weight is reserved for display/label roles; long-form text stays visually quiet even when the point it's making is emotionally heavy.

## Layout

Single-column editorial layout, `max-width: 960px`, centered, with `padding: 0 48px 40px` on desktop collapsing to `0 24px 32px` at the ≤680px breakpoint. Sections are separated by a full-bleed hairline `.divider` (a soft gold gradient fading at both ends) with 72px of vertical breathing room above and below — the page's core rhythm unit.

Two-column grids (module cards, science cards, "two worlds" cards) collapse to a single stacked column on mobile; the primary responsive breakpoint is **680px**, with secondary adjustments at 720px, 768px, and 900px for header density and hero-art framing. A full-bleed "breather" band (`.breather`) periodically breaks the 960px column to full viewport width with a fixed-attachment paper-texture background — a deliberate rhythm change, used sparingly (once or twice per page) as a pacing beat, not a repeating pattern.

A subtle graph-paper grid (1px lines, 30px cells, kraft-gold at 7% opacity) sits fixed behind the entire page as texture, not a layout grid to design against.

## Elevation & Depth

Flat-by-default with a literal paper-stack model: nothing uses blurred ambient shadows at rest. Every card, button, and interactive surface instead uses a **flat offset shadow** (`Npx Mpx 0 rgba(...)`, zero blur) that reads as one paper layer stamped slightly behind another. On hover, elements translate upward (`translateY(-4px)` for cards, `translate(-2px,-3px)` for buttons) while the offset shadow grows — the visual logic of lifting a cutout further off the table, not a light source moving closer.

### Shadow Vocabulary
- **Card resting** (`box-shadow: 3px 4px 0 rgba(120,80,40,0.04)`): default state for module cards, world cards, science cards, Есения's card, timeline cards.
- **Card hover** (`box-shadow: 9px 12px 0 rgba(120,80,40,0.12)`): paired with `translateY(-4px)`.
- **Button resting (dark)** (`box-shadow: 5px 6px 0 rgba(58,50,40,0.2)`): brown-dark CTA buttons.
- **Button resting (pink)** (`box-shadow: 5px 6px 0 rgba(232,122,156,0.3)`): pink CTA buttons.
- **Button hover (pink)** (`box-shadow: 7px 8px 0 rgba(232,122,156,0.3), 0 0 24px 6px rgba(232,122,156,0.2)`): the one place a soft blurred glow is layered on top of the flat offset shadow — reserved for the primary action.
- **Final price / floating buy** (`box-shadow: 4px 5px 0 rgba(232,122,156,0.28), 0 8px 26px rgba(58,50,40,0.10)`): heavier double-shadow for the highest-stakes CTA on the page.

### Named Rules
**The Paper-Stack Rule.** Shadows never blur at rest; they only lengthen on hover. Depth means "how far this paper layer sits off the one beneath it," not "how close the light is."

## Shapes

Rounding is generous and consistent — there are no sharp corners anywhere in the system. Small controls (buttons, pills, chips) use 12–14px; standard cards use 16–20px; feature cards ("two worlds", final CTA block) use 24–30px; avatars, dots, and icon badges are always full circles (50%). Borders are typically 1–1.5px, kraft-gold at 30–45% opacity, and frequently **dashed** rather than solid on structural elements (timeline track, ruled "clean" notebook lines) to reinforce the stationery metaphor. Decorative circular gradient blooms (radial, low-opacity accent color) sit in card corners as a paper-stain/watercolor touch rather than a hard graphic.

### Named Rules
**The No Sharp Corner Rule.** Every rectangular surface rounds at minimum 12px. A sharp corner reads as "screen," which this system never wants to feel like.

## Components

Cards, buttons, and modules should all feel **tactile and handmade, like pressed paper** — nothing glossy, nothing flat-digital. Every interactive surface confirms this with the paper-stack shadow + lift behavior described above.

### Buttons
- **Shape:** 12px radius, generous padding (20px 36px for primary CTAs, tighter 11px 22px / 15px 24px for header and floating variants).
- **Primary (dark):** `--brown-dark` background, beige text, Unbounded 700 uppercase label, flat offset shadow, lifts + shadow-lengthens on hover.
- **Primary (pink/accent):** `--pink` background, white text; the only button variant permitted a blurred glow on hover, marking it as the page's single highest-priority action.
- **Hover / Focus:** all buttons translate `(-2px, -3px)` and lengthen their offset shadow on hover; focus-visible states (seen on the floating buy button) use a solid 3px `--brown-dark` outline with 3px offset — no glow-only focus indicators.

#### Conscious exception: white text on `--pink`

`#fff` on `#e87a9c` measures **2.73:1** — below WCAG AA's 4.5:1 for small text (`.sticky-header__cta` and `.floating-buy` both use it explicitly; `.cta-button.pink` inherits `--beige` at an even lower **2.39:1**). This was evaluated and kept deliberately, not overlooked:

- A saturated pink with a light text overlay reads as an *illuminated surface* — it carries volume and looks pressable. Dark text flattens the same surface into a printed label.
- The hover treatment darkens the fill (`#e87a9c` → `#d96a8c`) to read as "pressed in." Lightening it instead — the direction a higher-contrast-with-dark-text fix would require — collides with this product's own modal convention, where a *lighter* button already means *disabled*. A hover that lightens would misread as the button going inactive at the exact moment the user is about to act.

**Do not silently "fix" this contrast on a future pass.** If accessibility requirements ever force a change here, treat it as a deliberate trade-off to revisit with the product owner, not a leftover bug — and recheck every dependent value (all three CTA instances, plus any inherited/blended child text like `.floating-buy__price`) since they were tuned together.

### Chips / Pills
- **Filled:** soft-yellow tint background (`rgba(247,208,138,0.2)`), espresso text, thin gold border — used for factual/positive tags.
- **Outline:** transparent background, brown text, thin pink border — used for the "your version" / cleaner-slate tags.
- **Category pill:** fully rounded (30px), uppercase, letter-spacing 2px, tinted per world (`world-card-full__pill--demo` gold-family, `--clean` pink-family).

### Cards / Containers
- **Corner Style:** 16–20px standard, 28px for feature-level "two worlds" cards.
- **Background:** translucent warm-white (`rgba(255,248,235,0.65–0.88)`), sometimes with `backdrop-filter: blur(4px)` where it overlaps the fixed paper texture.
- **Shadow Strategy:** paper-stack resting/hover pair (see Elevation & Depth).
- **Border:** 1–1.5px kraft-gold at 30–40% opacity, occasionally dashed.
- **Internal Padding:** 24–40px depending on card size; module cards run largest (36px 40px 32px).
- **Signature detail:** a 4–6px colored top-edge bar (`::after`) in the card's module-accent color, thickening slightly on hover — the closest thing to a "sticker" identifier per category.

### Inputs / Fields
No form inputs exist in the current implementation (purchase happens on an external YooKassa page); none to document. If inputs are ever added, they should inherit the card language: parchment fill, dashed or thin gold border, pink focus treatment.

### Navigation
- **Sticky header:** appears only after scroll (`translateY(-100%)` → `0`), frosted beige (`rgba(247,239,224,0.88)` + 14px blur), 64px tall (56px on mobile), hairline gold bottom border. Nav links are Jost 14px/400 in light-brown, darkening on hover; the CTA is the pink pill button in miniature.
- **FAQ / accordion nav:** Unbounded 700 13px triggers, a 28px circular gold-bordered arrow toggle that fills pink and rotates 45° when open — content expands via `grid-template-rows` for a smooth height transition.

### Floating Buy Button (signature component)
A fixed-position pink pill (bottom-right) that fades and slides up into view once the user scrolls past the hero, pairing the CTA label with the live price. Uses the heaviest shadow treatment in the system (flat offset + soft ambient glow) since it is the page's persistent final call to action.

## Do's and Don'ts

### Do:
- **Do** keep every rectangular surface rounded at 12px minimum; there are no sharp corners in this system.
- **Do** use flat, un-blurred offset shadows at rest, and lengthen (never blur) them on hover to suggest a paper layer lifting.
- **Do** reserve Rosewater Pink for action and emotional emphasis only — CTAs, active states, highlighted words.
- **Do** assign each module/category exactly one color from the fixed five-color module-accent family, applied as a thin top-edge bar or corner glow, never as a full-card background.
- **Do** set body copy in Jost at font-weight 300; reserve heavier weights for Unbounded display/label roles.
- **Do** use Lora italic only when the copy is Есения's voice, a quote, or a reflective aside — never for structural UI text.

### Don't:
- **Don't** introduce a second saturated accent color competing with pink for "action" meaning.
- **Don't** use blurred ambient shadows at rest; the one exception is the pink CTA's hover-only glow.
- **Don't** use pure black or pure white for text/background — everything stays warm (espresso brown / warm beige), with one standing exception: white text on the pink CTA buttons (see Components → Buttons → *Conscious exception*).
- **Don't** flatten the module-accent system into a general-purpose color palette; it is a category-marking role, not decoration.
- **Don't** introduce corporate-SaaS visual signals (cool grays, hard-edged cards, glossy gradients) — they contradict the handmade-paper premise even if individually "clean."
