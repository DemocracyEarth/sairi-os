import type { JSX } from 'react';
import { DESIGN, DESIGN_LENSES } from './design.js';
import { INCIDENT, INCIDENT_LENSES } from './incident.js';
import { RESEARCH, RESEARCH_LENSES } from './research.js';
import { TRAVEL, TRAVEL_LENSES } from './travel.js';
import { KIND_HUE, type LensKind, type Panel, type SairiContext } from '../state.js';

/**
 * The context registry.
 *
 * This is the seam that makes four workspaces look like four different pieces
 * of software rather than one grid with different labels: a context declares
 * which LENSES it uses, and each lens owns its interior completely — an SVG
 * knowledge graph, a log stream, a map, a spatial canvas. The shell knows
 * nothing about any of them beyond "render this panel's interior".
 *
 * It is also the seam a real deployment would replace. Today a keyword match
 * picks a template; with a model wired in, the model returns the objective, the
 * agent set and the panel list, and only this file changes.
 */

export type LensComponent = (props: { panel: Panel }) => JSX.Element;
export type LensSet = Partial<Record<LensKind, LensComponent>>;

export const CONTEXT_REGISTRY: Record<SairiContext['kind'], SairiContext> = {
  research: RESEARCH,
  incident: INCIDENT,
  travel: TRAVEL,
  design: DESIGN,
};

export const LENS_REGISTRY: Record<SairiContext['kind'], LensSet> = {
  research: RESEARCH_LENSES as LensSet,
  incident: INCIDENT_LENSES as LensSet,
  travel: TRAVEL_LENSES as LensSet,
  design: DESIGN_LENSES as LensSet,
};

/**
 * A context Sairi could not shape into anything it knows.
 *
 * Deliberately honest rather than a spinner: it says what it did not
 * understand. An operating system that pretends to have a workspace it does not
 * have is worse than one that admits the gap.
 */
export function blankContext(intention: string, kind: SairiContext['kind']): SairiContext {
  return {
    id: `ctx-${Date.now()}`,
    intention,
    objective: 'Sairi has not shaped a workspace for this intention yet.',
    kind,
    hue: KIND_HUE[kind],
    agents: [],
    panels: [],
    proposal: {
      title: 'Describe the outcome you want',
      detail:
        'Sairi builds a workspace around an objective. Say what a good result looks like and it will assemble the tools for it.',
      verb: 'Refine',
    },
    lastActive: 0,
  };
}
