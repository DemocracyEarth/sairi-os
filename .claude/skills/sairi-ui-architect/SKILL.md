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
- cinematic
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

Create a premium, cinematic interface with extraordinary eye candy and disciplined restraint.

The visual system should combine:

- deep midnight navy and near-black backgrounds
- subtle spatial gradients
- translucent layered surfaces
- delicate spectral borders
- blue, cyan, violet, magenta, coral, amber, and mint light
- soft volumetric illumination
- crisp typography
- generous spacing
- shallow depth and atmospheric perspective
- responsive motion
- luminous data visualization
- ambient animated backgrounds
- carefully controlled reflections and highlights

The result should feel like:

- a world-class operating system from the near future
- a premium cinematic product demonstration
- intelligence made visible
- a digital environment rather than a website

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
- SpectralBorder
- GlowDivider
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

Base palette:

- void: #050816
- midnight: #080D22
- deep blue: #0C1533
- frost: rgba(255,255,255,0.72)
- muted frost: rgba(255,255,255,0.48)

Spectral accents:

- electric blue
- cyan
- violet
- magenta
- coral
- amber
- mint

Use gradients as light, not as paint.

Gradients should suggest:

- intelligence
- activity
- focus
- state transitions
- relationships between information

Do not fill every object with rainbow gradients.

Reserve strong spectral color for focal points and active intelligence.

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

Use subtle ambient effects to make the interface feel alive:

- slow gradient drift
- faint particles
- moving light fields
- soft reflections
- restrained noise textures
- localized glows
- gentle agent activity pulses

Ambient effects must never reduce readability or performance.

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
- preserve cinematic depth without visual overload
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
