---
version: 2
name: acdemic-drawing
description: Create Excalidraw diagrams for academic research scenarios — paper structures, methodology flows, literature maps, and conceptual frameworks.
---

> Cloudflare runtime: use only the tools exposed by Lattiora. Read relative references with `read_document` under `.agents/skills/acdemic-drawing/`. No shell, local CLI, external agent process or script execution is available. Never claim an unavailable action succeeded.

# Academic Drawing Skill

Generate `.excalidraw` JSON files for **academic visual arguments** — diagrams that communicate research concepts, workflows, and relationships in scholarly contexts.

**Setup:** If the user asks you to set up this skill (renderer, dependencies, etc.), see `README.md` for instructions.

---

## Customization

**All colors and styles live in one file:** `references/color-palette.md`. Read it before generating any diagram.

To customize for your own research style, edit `color-palette.md`.

---

## Academic Core Philosophy

**Diagrams should ARGUE visually, not just display.**

A research diagram isn't formatted text — it's a visual argument showing relationships, causality, and flow that words alone can't express. The shape should BE the meaning.

**Isomorphism Test**: If you removed all text, would the structure alone communicate the research concept?

**Education Test**: Could someone learn something concrete from this diagram?

---

## Academic Diagram Types

### 1. Paper Structure Diagram
**Shows**: Overall organization of a research paper

Visual patterns:
- Top-down flow (IMRaD format: Introduction → Methods → Results → Discussion)
- Section boxes with connecting arrows showing logical flow
- Could use timeline or assembly line pattern

### 2. Research Methodology Flow
**Shows**: How research was conducted

Visual patterns:
- Multi-stage process (Design → Data Collection → Analysis → Findings)
- Use timeline or assembly line pattern
- Include decision points (diamond shapes) for methodological choices

### 3. Literature Review Map
**Shows**: Relationships between existing works

Visual patterns:
- Fan-out: central concept with related works radiating out
- Convergence: multiple approaches merging into a synthesis
- Network: interconnected nodes showing citation relationships
- Use lines + free-floating text, not boxes

### 4. Conceptual Framework
**Shows**: Theoretical underpinning of research

Visual patterns:
- Hierarchical tree showing constructs and relationships
- Cloud shapes for abstract theoretical concepts
- Arrows showing hypotheses or influences

### 5. Experimental Workflow
**Shows**: Step-by-step experimental procedure

Visual patterns:
- Timeline with markers and labels
- Decision diamonds for branching paths
- Phase boxes for major stages

### 6. Cross-Paper Comparison
**Shows**: Comparing findings or methods across studies

Visual patterns:
- Side-by-side comparison layout
- Table-like structure with aligned elements
- Use visual contrast to highlight differences

### 7. Data Analysis Pipeline
**Shows**: How raw data becomes conclusions

Visual patterns:
- Assembly line: Input → Processing → Output
- Convergence: multiple data sources merging
- Fan-out: one analysis branching to multiple findings

### 8. Theoretical Model
**Shows**: Abstract theoretical constructs and their relationships

Visual patterns:
- Tree for hierarchical constructs
- Arrows for hypothesized relationships
- Cloud shapes for latent variables

---

## Depth Assessment

### Simple/Conceptual
Use abstract shapes when:
- Explaining a theoretical framework
- The audience understands the domain
- The concept IS the abstraction

### Comprehensive/Technical
Use concrete examples when:
- Diagramming a specific methodology
- Teaching research methods
- Showing actual data formats or instruments

**For comprehensive diagrams, include evidence artifacts** (see below).

---

## Evidence Artifacts (For Technical Diagrams)

Evidence artifacts are concrete examples that prove accuracy and aid learning.

| Artifact Type | When to Use | How to Render |
|---------------|-------------|---------------|
| **Formula/Equation** | Statistical methods, models | Dark rectangle + formatted text |
| **Method names** | Specific analytical techniques | Highlighted text |
| **Data examples** | What the data looks like | Small table or structured text |
| **Citation** | Key references | Author-year in parentheses |
| **Variable names** | Operationalization | Monospace-style text |

---

## Multi-Zoom Architecture

Comprehensive academic diagrams operate at multiple levels:

### Level 1: Summary Flow
Overview of the research or argument structure.

### Level 2: Section Boundaries
Labeled regions grouping related components.

### Level 3: Detail
Evidence artifacts, examples, within each section.

---

## Visual Pattern Library (Academic)

### Fan-Out (One-to-Many)
Central theory/concept with related works radiating.
```
        ○ Theory
       ↗
  □ → ○
       ↘
        ○
```

### Convergence (Many-to-One)
Multiple studies/approaches merging into synthesis.
```
  ○ ↘
  ○ → □ Synthesis
  ○ ↗
```

### Tree (Hierarchy)
Theoretical constructs with sub-dimensions.
```
  Theoretical Construct
  ├── Dimension A
  │   ├── Indicator 1
  │   └── Indicator 2
  └── Dimension B
```

### Timeline (Process)
Sequential research stages or historical development.

### Cloud (Abstract Concept)
Overlapping theoretical constructs or related concepts.

### Assembly Line (Transformation)
Input (data) → Process (analysis) → Output (findings).

### Side-by-Side (Comparison)
Comparing methods, findings, or approaches across studies.

---

## Shape Meaning (Academic)

| Concept Type | Shape | Why |
|--------------|-------|-----|
| Theory, Framework | overlapping `ellipse` (cloud) | Abstract, conceptual |
| Research Stage | `rectangle` | Contained process |
| Decision Point | `diamond` | Methodological choice |
| Finding, Conclusion | `ellipse` | Outcome, destination |
| Variable, Construct | small `ellipse` or free-floating text | Building block |
| Relationship, Hypothesis | `arrow` | Directed influence |
| Citation/Reference | free-floating text | No container needed |

---

## Color as Meaning (Academic)

Colors from `references/color-palette.md` encode semantic purposes:
- **Theory/Framework**: Primary colors (blue tones)
- **Method/Process**: Secondary colors
- **Findings/Results**: Success colors (green tones)
- **Literature/Citations**: Neutral/slate tones
- **Decisions/Choices**: Warning colors (amber)

---

## Modern Aesthetics

### Roughness
- `roughness: 0` — Clean, professional. **Default for academic diagrams.**

### Stroke Width
- `strokeWidth: 1` — Thin lines, dividers
- `strokeWidth: 2` — Standard shapes and arrows
- `strokeWidth: 3` — Emphasis (main flow line)

### Opacity
**Always `opacity: 100`**. Use color and size for hierarchy.

### Small Markers
Use small dots (10-20px) as timeline markers, bullet points, connection nodes.

---

## Layout Principles

### Hierarchy Through Scale
- **Title**: 28-32px
- **Section Title**: 20-24px
- **Body/Label**: 16px
- **Detail/Annotation**: 14px

### Whitespace = Importance
Most important element gets most empty space (200px+ around it).

### Flow Direction
- Sequential processes: Left → Right or Top → Bottom
- Theoretical relationships: Bottom → Top (foundations influence outcomes)
- Literature maps: Radial or hierarchical

---

## Text Rules

**JSON `text` property contains ONLY readable words.**

```json
{
  "id": "myElement1",
  "text": "Introduction",
  "originalText": "Introduction"
}
```

Settings: `fontSize: 16`, `fontFamily: 3`, `textAlign: "center"`, `verticalAlign: "middle"`

---

## JSON Structure

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": 20
  },
  "files": {}
}
```

---

## Render & Validate (MANDATORY)

After generating the Excalidraw JSON, you MUST render it to PNG and visually inspect.

### How to Render

Open the generated `.excalidraw` file in Lattiora's canvas. Use its Export menu to render PNG/SVG. Ask the user to attach that rendered image for visual review; the built-in Agent cannot execute a renderer or inspect the canvas by itself. Never claim visual validation without seeing the rendered image.

### The Loop

1. **Render** — Open the canvas and export PNG through the browser.
2. **Audit** — Review the attached image for structure, hierarchy, readability.
3. **Fix** — Read and update JSON through `read_document` / `write_note`.
4. **Re-render** — Repeat using the canvas export.

### What to Check

- Text not clipped or overflowing
- Elements not overlapping
- Arrows connecting correctly
- Even spacing between elements
- Readable at export size
- Balanced composition

---

## Quality Checklist

### Academic Focus
1. **Purpose clear**: Does the diagram serve its academic purpose?
2. **Appropriate abstraction**: Conceptual for theory, concrete for methodology?
3. **Evidence artifacts present**: For technical diagrams, are there examples?

### Visual Design
4. **Isomorphism**: Does structure mirror concept?
5. **Argument**: Does diagram show something text alone couldn't?
6. **Variety**: Different visual patterns for different concepts?
7. **Minimal containers**: Could boxed elements be free-floating text?

### Technical
8. **Text clean**: Only readable words
9. **Font**: `fontFamily: 3`
10. **Roughness**: `roughness: 0`
11. **Opacity**: `opacity: 100`
12. **Colors**: From palette only

### Validation
13. **Rendered to PNG**: Visually inspected
14. **No text overflow**: All text fits
15. **No overlapping**: Elements don't collide
16. **Arrows correct**: Connect to intended elements
17. **Balanced**: No voids or overcrowding

---

## First-Time Setup

No local renderer or Python setup is required. Canvas rendering/export runs in the browser; automated headless rendering is not provided by the built-in Agent.

---

*Adapted from [excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) for academic research scenarios. no original license*
