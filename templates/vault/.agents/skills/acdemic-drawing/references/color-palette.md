# Academic Color Palette (NeurIPS/ICML Style)

**Single source of truth for all colors and styles in academic diagrams.**
**Inspired by NeurIPS/ICML/ICLR publication figures — clean, professional, muted tones.**

---

## Shape Colors (Semantic)

Colors encode meaning, not decoration. Muted, academic tones inspired by conference figures.

| Semantic Purpose | Fill | Stroke | Use Case |
|------------------|------|--------|----------|
| Theory/Construct | `#e0e7ff` | `#4338ca` | Theoretical constructs, frameworks |
| Primary/Neutral | `#bfdbfe` | `#1d4ed8` | Default research elements, contributions |
| Secondary | `#ddd6fe` | `#7c3aed` | Supporting concepts, variations |
| Method/Process | `#d9f99d` | `#4d7c0f` | Methodology, procedures (muted green) |
| Literature/Background | `#f1f5f9` | `#64748b` | Prior work, baseline comparisons |
| Finding/Result (Positive) | `#bbf7d0` | `#15803d` | Conclusions, successful outcomes |
| Finding/Result (Negative) | `#fecaca` | `#b91c1c` | Limitations, negative results |
| Data/Evidence | `#fef08a` | `#a16207` | Data points, empirical evidence |
| Decision/Hypothesis | `#fed7aa` | `#c2410c` | Methodological choices, hypotheses |
| Gap/Future Work | `#fca5a5` | `#dc2626` | Research gaps, limitations |
| Comparison/Control | `#e5e7eb` | `#6b7280` | Baseline, control groups |

**Rule**: Always pair a darker stroke with a lighter fill for contrast.

---

## Text Colors (Hierarchy)

Use color on free-floating text to create visual hierarchy without boxes.

| Level | Color | Use For | Size |
|-------|-------|---------|------|
| Title | `#1e3a5f` | Diagram title, main heading | 28-32px |
| Section | `#312e81` | Section headings | 20-24px |
| Subtitle | `#4338ca` | Subheadings, key labels | 18px |
| Body | `#475569` | Descriptions, annotations | 16px |
| Detail/Citation | `#6b7280` | Metadata, citations, small labels | 12-14px |
| On light fills | `#1e293b` | Text inside light-colored shapes | — |
| On dark fills | `#ffffff` | Text inside dark-colored shapes | — |

---

## Evidence Artifact Colors

For formulas, data examples, and concrete evidence.

| Artifact | Background | Text Color |
|----------|-----------|------------|
| Formula/Equation | `#1e293b` | `#f8fafc` (white) |
| Data/Table | `#f8fafc` | `#1e293b` (dark) |
| Code/Algorithm | `#1e293b` | `#22c55e` (green) |
| Citation | `#f1f5f9` | `#64748b` (slate) |

---

## Default Stroke & Line Colors

| Element | Color |
|---------|-------|
| Arrows (relationships) | `#7c3aed` (purple) or `#1d4ed8` (blue) |
| Structural lines | `#94a3b8` (light slate) |
| Dividers | `#e5e7eb` (very light gray) |
| Marker dots | `#1d4ed8` (primary blue) |

---

## Background

| Property | Value |
|----------|-------|
| Canvas background | `#ffffff` |
| Section backgrounds | Use subtle fills only when grouping needed |

---

## AI Conference Style Guidance

### Color Philosophy
- **Muted, not saturated** — conference figures avoid bright, flashy colors
- **Professional, not playful** — clean lines, minimal decoration
- **Accessible contrast** — sufficient contrast for print and投影

### Specific Conference Notes

**NeurIPS Style**:
- Blues (#1d4ed8, #3b82f6), Purples (#7c3aed, #8b5cf6)
- Common: blue-purple gradient for "learning" or "neural" concepts
- Green for positive results, red/gray for limitations

**ICML Style**:
- More conservative, lots of grays
- Blue-green for methods, gray for background
- Minimal use of orange/red unless highlighting issues

**ICLR Style**:
- Similar to NeurIPS but slightly more colorful
- Purples and blues dominate
- Sometimes uses teals for "optimization" concepts

### For Literature Review Maps
- Use **slate/gray tones** for existing literature
- Highlight **your contribution** with primary blue
- Use **green** for confirmed/validated relationships
- Use **orange** for contested or debated points

### For Methodology Diagrams
- Use **blue/indigo** for the proposed method
- Use **gray** for established/traditional methods
- Use **orange** for decision points
- Use **green** for validation steps

### For Theoretical Frameworks
- Use **indigo/purple** for latent constructs
- Use **blue arrows** to show data flow
- Use **purple arrows** for hypothesized relationships
- Use **cloud shapes** for abstract concepts

### For Comparison Diagrams
- Use **consistent fills** for similar categories
- Use **color contrast** to highlight differences
- Use **gray** for baseline or control groups
