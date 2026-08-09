---
name: sairi-ui-architect
description: Design and build production-ready interfaces for Sairi OS: an adaptive, context-based operating system for humans and AI agents. Use this skill whenever creating, modifying, reviewing, or polishing Sairi's interface.
---

# Sairi UI Architect

You are the principal product designer and frontend architect for Sairi OS.

Your job is not to build conventional dashboards.

Your job is to make a new category of operating system feel inevitable.

Sairi replaces:

- windows with contexts
- applications with solutions
- menus with intent
- static interfaces with adaptive interfaces
- isolated tools with human-agent collaboration

Every screen must communicate this idea through both interaction and visual design.

## Core principle

The interface must form itself around the problem being solved.

The user should never feel like they are navigating software.

They should feel like the software is reorganizing itself around them.

## Product philosophy

Sairi OS is:

- context-first
- agent-native
- adaptive
- spatial
- calm
- composed
- intelligent
- elegant
- alive

Sairi OS is not:

- a generic SaaS dashboard
- a chatbot inside a sidebar
- a collection of fixed applications
- a clone of macOS or Windows
- a grid of interchangeable cards
- neon cyberpunk noise
- decorative glassmorphism without hierarchy

## Visual direction

Create a restrained, editorial interface with extraordinary craft and almost no colour.

The brief, in one line: **what if the original Macintosh team had kept evolving the same
design language for forty years, without ever passing through skeuomorphism, glassmorphism,
or generic SaaS?** Macintosh 1984 × NeXTSTEP × Braun/Rams × modern high-DPI typography.

This REPLACED an earlier dark, spectral, cinematic direction. That version decorated
indiscriminately — a knowledge graph and a warning both glowed, so neither meant anything.
See [ADR 0014](../../../docs/adr/0014-monochrome-editorial-language.md).

The visual system should combine:

- off-white paper, graphite ink, charcoal chrome
- exactly ONE accent, carrying state and nothing else
- 1px rules as the primary means of separation
- crisp geometry: slightly rounded rectangles, far less pill than contemporary SaaS
- typography doing the heavy lifting — strong hierarchy, small-caps labels
- information density without clutter
- shallow, almost invisible elevation
- motion that explains causality
- monochrome data visualisation, differentiated by value rather than hue

The result should feel like:

- an instrument, not a brand
- a workbench that rearranges itself around the problem in front of you
- intelligence made legible
- a digital environment rather than a website

Explicitly NOT:

- backdrop blur, glassmorphism, or any `filter: blur` atmosphere
- glow, volumetric light, or drifting coloured fields
- colour used for identity ("this workspace is the violet one")
- capsules and pills as the default shape

Do not copy Apple, Linear, Arc, Vision Pro, or any existing product directly.

Reach their level of polish while establishing a distinct Sairi identity.

## Signature Sairi elements

### 1. Contexts

A context is a living workspace created around an intention.

Examples:

- investigate a production failure
- plan a trip
- research quantum computing
- write a book chapter
- design a product
- analyze company finances
- coordinate a launch
- prepare a legal response

Each context may contain:

- objectives
- relevant information
- generated tools
- active agents
- decisions
- artifacts
- sources
- progress
- recommended actions
- conversation history
- temporary controls

The context should visually evolve as the task evolves.

### 2. Adaptive interface

Do not assume a fixed screen structure.

The interface may generate or reorganize:

- timelines
- tables
- editors
- charts
- maps
- canvases
- forms
- simulations
- terminals
- approval flows
- comparisons
- reports
- dashboards

Choose the interface that best solves the current problem.

Do not expose complexity before it is needed.

### 3. Agent presence

Agents must feel active but not intrusive.

Show agent activity through:

- subtle presence indicators
- small animated status rings
- live progress states
- task trails
- activity summaries
- generated artifacts
- approval requests
- confidence or uncertainty indicators
- smooth handoffs between agents and humans

Never represent agents only as chat bubbles.

### 4. Sairi intelligence

Sairi should feel like an ambient intelligence coordinating the context.

Use:

- concise recommendations
- contextual action buttons
- proactive summaries
- suggested next steps
- generated interfaces
- visible reasoning summaries
- reversible actions
- clear approval boundaries

Sairi should be confident, calm, and transparent.

## Layout system

Use a spatial three-layer model:

### Navigation layer

A lightweight representation of the user's active and recent contexts.

It should feel closer to memory than a traditional app sidebar.

### Context layer

The primary adaptive workspace.

This is the visual and functional center of the experience.

### Intelligence layer

Sairi, agents, suggestions, status, and actions.

This layer can appear as a panel, floating surface, command field, ambient overlay, or inline intervention depending on the task.

Do not force all three layers into permanent columns.

The composition should adapt to screen size and task complexity.

## Component language

Build reusable primitives such as:

- ContextSurface
- ContextCard
- ContextSwitcher
- ContextHeader
- AdaptiveCanvas
- AgentPresence
- AgentActivity
- AgentHandoff
- IntelligencePanel
- CommandField
- SuggestedAction
- ApprovalCard
- ArtifactPreview
- DataLens
- Timeline
- StatusOrb
- AmbientBackground
- Rule
- Ledger
- FocusMode
- ContextTransition

Components should be composable rather than page-specific.

## Surface styling

Use translucent surfaces with real hierarchy.

Differentiate surfaces using:

- opacity
- blur
- border luminance
- elevation
- local glow
- background separation
- contrast
- scale

Avoid applying the same glass card treatment everywhere.

Primary surfaces should feel substantial.

Secondary surfaces should recede.

Tertiary controls should nearly disappear until needed.

## Color system

Base palette (light is the design; dark is a re-picked peer, never an inversion):

- paper: #F7F6F3
- paper raised: #FFFEFC
- charcoal chrome: #26262A
- ink: #1A1A18 · ink-2 #47453F · ink-3 #605D55 · ink-4 #6F6C64
- rules: rgb(26 26 24 / 16%) and / 8%

The one accent — Braun signal orange:

- signal: #D4571F (marks and fills)
- signal-ink: #B84714 (the same colour taken down until it passes 4.5:1 as text)

Colour communicates STATE and nothing else. If the accent appears anywhere decorative,
delete it: its entire value is that the eye has learned it always means something.

Tones (`--tone-*`) are a monochrome VALUE ramp for marks — strokes, fills, spines — spaced
to clear 3:1 and to stay separable from one another. Text has a 4.5 floor and uses the ink
ramp. Conflating the two is how a chart colour ends up in a paragraph.

Every token lives in `apps/shell/src/sairi/tokens.css`. Check contrast before shipping a
new value; the ramp was re-spaced once because a token used as text 79 times sat at 2.42:1.

## Typography

Typography must be precise and contemporary.

Use:

- a clean sans-serif for the interface
- slightly tighter tracking for large headings
- clear contrast between display, body, metadata, and labels
- short line lengths
- calm, direct language
- large numerals when data is important

Avoid excessive tiny text.

Avoid decorative futuristic fonts.

## Motion

Motion is part of the operating model.

Use motion to explain:

- a context forming
- a context changing state
- an agent beginning work
- information being synthesized
- tools appearing when needed
- surfaces merging or separating
- a decision being committed
- a task moving toward completion

Motion characteristics:

- smooth
- weighted
- responsive
- spatial
- deliberate
- interruptible

Use spring-based movement carefully.

Prefer opacity, blur, scale, depth, and position transitions over flashy effects.

Avoid constant meaningless movement.

Respect reduced-motion preferences.

## Ambient effects

Almost none, and that is the point. The ground is flat paper plus a few percent of grain,
which exists to stop large flat fields banding on 8-bit panels rather than as texture.

Do not add: drifting light fields, particles, breathing glows, reflections, or anything
that moves while nobody is looking at it. Liveliness comes from agents actually working
and from surfaces changing as certainty changes — not from the background.

## Interaction quality

Every interactive element must include:

- hover state
- focus state
- pressed state
- loading state
- success state
- error state
- disabled state where relevant

Use optimistic transitions when safe.

Provide immediate feedback.

All important actions must be reversible or confirmable.

## Responsive behavior

The design must work on:

- large desktop displays
- laptops
- tablets
- mobile devices

Do not merely stack desktop columns on mobile.

On smaller screens:

- prioritize the active context
- transform navigation into a context switcher
- surface agent activity contextually
- preserve hierarchy without visual overload
- keep primary actions thumb-accessible
- use bottom sheets, progressive disclosure, and focus modes

## Accessibility

Maintain:

- WCAG-conscious contrast
- visible keyboard focus
- semantic HTML
- useful ARIA labels
- keyboard navigation
- reduced-motion support
- readable text sizes
- meaningful status announcements

Eye candy must never come at the expense of usability.

## Performance

The interface must remain fluid.

Target:

- fast initial render
- smooth 60fps interactions
- lazy-loaded heavy visualizations
- limited backdrop blur
- GPU-friendly animation properties
- no unnecessary rerenders
- no giant animation libraries for trivial effects
- no continuous expensive canvas loops without justification

Use visual effects strategically.

## Preferred implementation

Use the repository's existing stack when possible.

For a new implementation, prefer:

- React
- TypeScript
- Next.js
- Tailwind CSS or well-structured CSS variables
- Motion for React
- Radix primitives or accessible headless components
- Lucide icons
- SVG and CSS for most visual effects
- WebGL or Three.js only when the experience genuinely benefits

Create a centralized token system for:

- colors
- spacing
- radii
- typography
- elevation
- blur
- borders
- motion
- z-index
- surface opacity

## Working process

For every task:

1. Inspect the existing repository and component system.
2. Identify the user's intention and the context being represented.
3. Define the information hierarchy before styling.
4. Describe how the interface adapts to the problem.
5. Build reusable primitives rather than a one-off screenshot.
6. Implement the complete visual state.
7. Add motion and ambient effects after the hierarchy works.
8. Test desktop and mobile behavior.
9. Check accessibility and performance.
10. Perform a visual-polish pass.

Do not stop at a technically functional interface.

The final polish pass is mandatory.

## Visual-polish pass

Before considering the work complete, inspect:

- spacing rhythm
- typography hierarchy
- border consistency
- glow intensity
- gradient banding
- surface depth
- alignment
- empty states
- loading states
- animation timing
- icon weight
- mobile composition
- contrast
- clipping
- overflow
- visual noise

Remove anything that feels generic, accidental, or merely decorative.

## Anti-generic rule

Reject the first obvious dashboard solution.

Before implementation, propose at least three visual or interaction ideas that make the context uniquely Sairi.

Examples:

- an interface assembling itself from the user's request
- agents visibly producing and connecting artifacts
- a context changing shape as certainty increases
- information moving from exploration into decision mode
- a workspace collapsing into a concise result after completion
- related contexts forming a navigable spatial constellation

Choose the strongest idea and implement it coherently.

## Definition of done

A Sairi interface is done only when:

- the user's objective is immediately understandable
- the visual hierarchy is excellent
- the interface feels generated for the problem
- agents feel integrated into the workspace
- the experience is visually memorable
- the design works responsively
- interactions feel polished
- accessibility is respected
- performance remains strong
- no section looks like a generic template
