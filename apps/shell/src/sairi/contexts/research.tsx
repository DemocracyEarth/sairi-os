import type { CSSProperties, JSX } from 'react';
import { Forming, GlowDivider, Metric, StatusOrb, Tag, hue, useCountUp } from '../primitives.js';
import type { LensKind, Panel, SairiContext, Spectral } from '../state.js';
import './research.css';

/**
 * RESEARCH — "analysing recent quantum-computing breakthroughs".
 *
 * The convergence journey this workspace is built to show: four architecture
 * verdicts have hardened into narrow, luminous panels, and one claim has not.
 * The Majorana/topological question is the widest, dimmest, dashed thing on the
 * screen — not because it is unimportant, but because the layout is the honest
 * report of what is still unknown. Nothing downstream of it can resolve until
 * a human approves the two acquisitions the Adversary is waiting on.
 */

/* ------------------------------------------------------------------------ *
 * Panel payloads
 *
 * `Panel.data` is `unknown` by design, so every lens narrows it itself. These
 * payloads are literals authored in this file, so `payload()` is a cast of our
 * own data — not a trust decision. Anything arriving from a model or the
 * network would have to pass a validator instead, per SECURITY.md.
 * ------------------------------------------------------------------------ */

function payload<T>(panel: Panel): T {
  return panel.data as T;
}

/**
 * The registry types a lens as `(panel: Panel) => JSX.Element`, but the shell
 * renders it as a component — `<Lens panel={panel} />`. Those are the same call
 * with a different wrapper, so every lens below normalises its argument and
 * survives either. Cheaper than coupling this file to the shell's choice.
 */
type LensInput = Panel | { panel: Panel };

function asPanel(input: LensInput): Panel {
  return 'panel' in input ? input.panel : input;
}

type SourceTier = 'peer-reviewed' | 'peer-review-file' | 'preprint' | 'vendor' | 'talk';

interface ResearchSource {
  id: string;
  title: string;
  venue: string;
  date: string;
  /** How recent, 0..1. Precomputed so the lens has no clock and stays deterministic. */
  recency: number;
  credibility: number;
  tier: SourceTier;
  /** Which agent pulled it — the provenance thread runs through here. */
  agent: string;
  note: string;
  /** Present only in the contradiction panel, where the list splits in two. */
  stance?: 'supports' | 'contradicts';
  /** Citations, downloads, whatever this source is measured by. */
  measure?: string;
  contested?: boolean;
}

interface SourcesData {
  summary: string;
  scanned: number;
  kept: number;
  sources: ResearchSource[];
  /** Renders the list as claim vs counter-claim rather than a ranking. */
  split?: boolean;
  question?: string;
  settleWith?: string;
  pending?: string;
}

type Relation = 'supports' | 'contradicts' | 'extends';

interface MapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  accent: Spectral;
  state: 'settled' | 'open' | 'disputed';
}

interface MapEdge {
  from: string;
  to: string;
  relation: Relation;
  note: string;
}

interface KnowledgeMapData {
  nodes: MapNode[];
  edges: MapEdge[];
  caption: string;
}

interface CompareColumn {
  id: string;
  name: string;
  sub: string;
  accent: Spectral;
  verdict?: string;
}

interface CompareCell {
  value: string;
  /** 0..1, drives the bar. Omitted where a bar would imply a ranking that does not exist. */
  strength?: number;
  /** Vendor-reported or otherwise unreplicated. */
  caveat?: boolean;
}

interface CompareRow {
  metric: string;
  cells: CompareCell[];
  flag?: 'match' | 'overstated' | 'unsupported';
}

interface ComparisonData {
  columns: CompareColumn[];
  rows: CompareRow[];
  footnote: string;
  /** Drops the bars and tightens the grid, for the narrow resolved panel. */
  compact?: boolean;
}

interface Milestone {
  id: string;
  label: string;
  date: string;
  /** Marker position on the axis, 0..1. */
  t: number;
  /** Evidence window: first public artefact → peer-reviewed publication. */
  t0: number;
  t1: number;
  /** Strength of evidence, 0..1. Independent of the date, and shown separately. */
  confidence: number;
  accent: Spectral;
  forecast?: boolean;
}

interface TimelineData {
  ticks: { label: string; t: number }[];
  now: number;
  nowLabel: string;
  milestones: Milestone[];
  legend: string;
}

/* ------------------------------------------------------------------------ *
 * The context
 * ------------------------------------------------------------------------ */

const ANCHORS: SourcesData = {
  summary: '5 of 41 cleared tier 1 — peer-reviewed, primary data released, replicated elsewhere.',
  scanned: 41,
  kept: 5,
  sources: [
    {
      id: 'src-willow',
      title: 'Quantum error correction below the surface code threshold',
      venue: 'Nature 638, 920–926 · Google Quantum AI',
      date: '12 Feb 2025',
      recency: 0.74,
      credibility: 0.97,
      tier: 'peer-reviewed',
      agent: 'Librarian',
      note: 'Data and analysis code released. The d = 3 → 5 → 7 scaling has been re-derived by two groups outside Google.',
      measure: '1 284 citations',
    },
    {
      id: 'src-aurora',
      title: 'Scaling and networking a modular photonic quantum computer',
      venue: 'Nature 638, 912–919 · Xanadu',
      date: '22 Jan 2025',
      recency: 0.72,
      credibility: 0.91,
      tier: 'peer-reviewed',
      agent: 'Librarian',
      note: 'Small machine, honest loss budget: 35 chips over 13 km of fibre, every dB accounted for in the supplement.',
      measure: '402 citations',
    },
    {
      id: 'src-bluvstein',
      title: 'Logical quantum processor based on reconfigurable atom arrays',
      venue: 'Nature 626, 58–65 · Harvard / MIT / QuEra',
      date: '6 Dec 2023',
      recency: 0.31,
      credibility: 0.94,
      tier: 'peer-reviewed',
      agent: 'Chronologist',
      note: 'Predates the window, kept as the baseline: 48 logical qubits with transversal gates is still the number to beat.',
      measure: '2 010 citations',
    },
    {
      id: 'src-gidney',
      title: 'How to factor 2048-bit RSA integers with less than a million noisy qubits',
      venue: 'arXiv:2505.15917 · C. Gidney',
      date: '21 May 2025',
      recency: 0.83,
      credibility: 0.88,
      tier: 'preprint',
      agent: 'Adversary',
      note: 'A resource estimate, not an implementation — but every assumption is listed, and it cuts the 2019 figure by 20×.',
      measure: 'no journal version yet',
    },
    {
      id: 'src-zuchongzhi',
      title: 'Establishing a new benchmark in quantum computational advantage',
      venue: 'Phys. Rev. Lett. 134, 090601 · USTC',
      date: '3 Mar 2025',
      recency: 0.76,
      credibility: 0.62,
      tier: 'peer-reviewed',
      agent: 'Adversary',
      note: 'Peer-reviewed, but the margin depends entirely on which classical baseline you allow. Tensor-network spoofing has since closed most of it.',
      measure: 'contested margin',
      contested: true,
    },
    {
      id: 'src-msblog',
      title: 'Majorana 1: the world’s first topological qubit',
      venue: 'Microsoft Azure Quantum — company blog',
      date: '19 Feb 2025',
      recency: 0.75,
      credibility: 0.24,
      tier: 'vendor',
      agent: 'Adversary',
      note: 'Demoted to tier 3. The Nature paper it links to does not itself claim a topological qubit — see the open contradiction.',
      measure: 'no primary data',
      contested: true,
    },
  ],
};

const ARCHITECTURES: ComparisonData = {
  columns: [
    {
      id: 'sc',
      name: 'Superconducting',
      sub: 'Willow · IBM Heron R2',
      accent: 'cyan',
      verdict: 'ahead on error correction',
    },
    {
      id: 'ti',
      name: 'Trapped ion',
      sub: 'Quantinuum H2 · Helios',
      accent: 'mint',
      verdict: 'ahead on fidelity',
    },
    {
      id: 'ph',
      name: 'Photonic',
      sub: 'Xanadu Aurora · PsiQuantum Omega',
      accent: 'blue',
      verdict: 'ahead on manufacturability',
    },
    {
      id: 'tp',
      name: 'Topological',
      sub: 'Microsoft Majorana 1',
      accent: 'magenta',
      verdict: 'claim unverified',
    },
  ],
  rows: [
    {
      metric: 'Physical qubits, best public device',
      cells: [
        { value: '105 (Willow) · 156 (Heron R2)', strength: 0.82 },
        { value: '56 (H2) · 98 (Helios)', strength: 0.5 },
        { value: '12 networked modes (Aurora)', strength: 0.24 },
        { value: '8 claimed, 0 verified', strength: 0.08, caveat: true },
      ],
    },
    {
      metric: 'Two-qubit error, median',
      cells: [
        { value: '3.3 × 10⁻³', strength: 0.72 },
        { value: '7.9 × 10⁻⁴', strength: 1 },
        { value: '≈ 5 × 10⁻³ (fusion)', strength: 0.48, caveat: true },
        { value: 'not published', strength: 0, caveat: true },
      ],
    },
    {
      metric: 'Two-qubit gate time',
      cells: [
        { value: '28 ns', strength: 1 },
        { value: '30–100 µs', strength: 0.14 },
        { value: '≈ 1 ns, heralded', strength: 0.62, caveat: true },
        { value: 'µs, predicted', strength: 0.2, caveat: true },
      ],
    },
    {
      metric: 'Connectivity',
      cells: [
        { value: 'nearest neighbour, degree 4', strength: 0.3 },
        { value: 'all-to-all across 56 ions', strength: 1 },
        { value: 'reconfigurable over fibre', strength: 0.8 },
        { value: 'nearest neighbour (design)', strength: 0.3, caveat: true },
      ],
    },
    {
      metric: 'Coherence / memory',
      cells: [
        { value: '98 µs T₁', strength: 0.28 },
        { value: '> 10 min (¹³³Ba⁺ hyperfine)', strength: 1 },
        { value: 'no decoherence; 0.2 dB/km loss', strength: 0.7 },
        { value: 'protected in principle', strength: 0.12, caveat: true },
      ],
    },
    {
      metric: 'Operating conditions',
      cells: [
        { value: '15 mK dilution fridge', strength: 0.2 },
        { value: '300 K trap, laser cooled', strength: 0.9 },
        { value: '300 K chip · 2 K detectors', strength: 0.78 },
        { value: '20 mK + 1 T in-plane field', strength: 0.14 },
      ],
    },
    {
      metric: 'Error correction demonstrated',
      cells: [
        { value: 'd = 7 surface code, Λ = 2.14', strength: 1 },
        { value: '12 logical @ 800× physical', strength: 0.8 },
        { value: 'fusion-based EC on paper only', strength: 0.2, caveat: true },
        { value: 'none', strength: 0, caveat: true },
      ],
    },
    {
      metric: 'Named obstacle to 10⁶ qubits',
      cells: [
        { value: 'fridge I/O — ≈ 200 lines per module', strength: 0.44 },
        { value: 'ion transport and laser count', strength: 0.36 },
        { value: '300 mm CMOS line already qualified', strength: 0.9 },
        { value: 'materials yield, unquantified', strength: 0.1, caveat: true },
      ],
    },
    {
      metric: 'Independently replicated',
      cells: [
        { value: 'yes — 4 groups', strength: 1 },
        { value: 'yes — 3 groups', strength: 0.85 },
        { value: 'partial — 2 groups', strength: 0.5 },
        { value: 'no', strength: 0 },
      ],
    },
    {
      metric: 'Strongest artefact',
      cells: [
        { value: 'Nature 638, 920 (2025)' },
        { value: 'arXiv:2404.02280 + APS B51' },
        { value: 'Nature 638, 912 (2025)' },
        { value: 'Nature 638, 651 (2025) †', caveat: true },
      ],
    },
  ],
  footnote:
    'Best publicly documented values as of 3 Aug 2026. Where a vendor published a best-pair figure and a median, the median is used. † the referee file attached to this paper dissents from the headline — see the open contradiction.',
};

const REMEASURE: ComparisonData = {
  compact: true,
  columns: [
    { id: 'vendor', name: 'Vendor figure', sub: 'as published', accent: 'amber' },
    { id: 'indep', name: 'Independent re-measure', sub: 'Metrologist', accent: 'mint' },
  ],
  rows: [
    {
      metric: 'Heron R2 two-qubit error',
      cells: [{ value: '1.8 × 10⁻³ best pair' }, { value: '3.3 × 10⁻³ median, 148 pairs' }],
      flag: 'overstated',
    },
    {
      metric: 'Willow RCS runtime gap',
      cells: [{ value: '5 min vs 10²⁵ yr' }, { value: '≈ 4.1 h on 2 048 GPUs' }],
      flag: 'overstated',
    },
    {
      metric: 'Helios two-qubit fidelity',
      cells: [{ value: '99.921 %' }, { value: '99.90 %, 20 k shots' }],
      flag: 'match',
    },
    {
      metric: 'Aurora fibre loss',
      cells: [{ value: '0.2 dB/km over 13 km' }, { value: '0.21 dB/km measured' }],
      flag: 'match',
    },
    {
      metric: 'Majorana 1 topological qubits',
      cells: [{ value: '8' }, { value: '0 confirmed' }],
      flag: 'unsupported',
    },
  ],
  footnote: 'Five claims re-run against primary data. Two survive unchanged.',
};

const CONCEPT_MAP: KnowledgeMapData = {
  caption:
    'Fourteen concepts, fourteen relations. Two of them are contradictions, and both sit on the right-hand side of the graph.',
  nodes: [
    { id: 'spoof', label: 'Tensor spoofing', x: 62, y: 44, r: 5, accent: 'coral', state: 'open' },
    { id: 'surface', label: 'Surface code', x: 72, y: 112, r: 7, accent: 'mint', state: 'settled' },
    {
      id: 'willow',
      label: 'Willow · 105 q',
      x: 66,
      y: 190,
      r: 8,
      accent: 'cyan',
      state: 'settled',
    },
    { id: 'lambda', label: 'Λ 2.14 / step', x: 158, y: 48, r: 6, accent: 'mint', state: 'settled' },
    {
      id: 'threshold',
      label: 'Below-threshold EC',
      x: 168,
      y: 126,
      r: 12,
      accent: 'mint',
      state: 'settled',
    },
    { id: 'ions', label: 'Trapped ions', x: 100, y: 252, r: 8, accent: 'mint', state: 'settled' },
    {
      id: 'alltoall',
      label: 'All-to-all coupling',
      x: 210,
      y: 206,
      r: 7,
      accent: 'mint',
      state: 'settled',
    },
    {
      id: 'magic',
      label: 'Magic-state cost',
      x: 272,
      y: 46,
      r: 7,
      accent: 'violet',
      state: 'open',
    },
    {
      id: 'logical',
      label: 'Logical qubit',
      x: 280,
      y: 140,
      r: 13,
      accent: 'violet',
      state: 'open',
    },
    { id: 'atoms', label: 'Neutral atoms', x: 318, y: 240, r: 7, accent: 'blue', state: 'settled' },
    { id: 'gap', label: 'Gap protocol', x: 356, y: 84, r: 6, accent: 'magenta', state: 'open' },
    {
      id: 'majorana',
      label: 'Majorana mode',
      x: 396,
      y: 42,
      r: 6,
      accent: 'magenta',
      state: 'disputed',
    },
    {
      id: 'topo',
      label: 'Topological qubit',
      x: 396,
      y: 150,
      r: 8,
      accent: 'magenta',
      state: 'disputed',
    },
    { id: 'photonic', label: 'Photonic mesh', x: 392, y: 216, r: 7, accent: 'blue', state: 'open' },
  ],
  edges: [
    {
      from: 'spoof',
      to: 'willow',
      relation: 'contradicts',
      note: 'Tensor-network spoofing cuts the classical baseline from 10²⁵ years to about four hours.',
    },
    {
      from: 'surface',
      to: 'threshold',
      relation: 'supports',
      note: 'Growing the patch from d = 3 to 5 to 7 halves the logical error at each step.',
    },
    {
      from: 'lambda',
      to: 'threshold',
      relation: 'supports',
      note: 'Λ = 2.14 ± 0.02 is the measured suppression factor per code-distance step.',
    },
    {
      from: 'willow',
      to: 'threshold',
      relation: 'supports',
      note: '105 physical qubits, 101 of them inside the d = 7 patch.',
    },
    {
      from: 'threshold',
      to: 'logical',
      relation: 'extends',
      note: 'A logical qubit now costs roughly 1 500 physical qubits rather than 10⁴.',
    },
    {
      from: 'threshold',
      to: 'magic',
      relation: 'extends',
      note: 'Once the code is below threshold, distillation rather than the code dominates the cost.',
    },
    {
      from: 'magic',
      to: 'logical',
      relation: 'extends',
      note: 'Magic states gate every non-Clifford operation, so they set the real gate budget.',
    },
    {
      from: 'ions',
      to: 'alltoall',
      relation: 'supports',
      note: 'Fifty-six ions in one trap, any pair addressable without routing.',
    },
    {
      from: 'alltoall',
      to: 'logical',
      relation: 'extends',
      note: 'All-to-all coupling removes the routing overhead the surface code has to pay.',
    },
    {
      from: 'atoms',
      to: 'logical',
      relation: 'extends',
      note: 'Forty-eight logical qubits with transversal gates, on reconfigurable atom arrays.',
    },
    {
      from: 'photonic',
      to: 'logical',
      relation: 'extends',
      note: 'Fusion-based correction replaces the code cycle with measurement on manufactured chips.',
    },
    {
      from: 'majorana',
      to: 'topo',
      relation: 'supports',
      note: 'A parity-protected qubit requires the zero mode to exist in the first place.',
    },
    {
      from: 'gap',
      to: 'majorana',
      relation: 'contradicts',
      note: 'The topological gap protocol admits false positives from disorder alone.',
    },
    {
      from: 'topo',
      to: 'logical',
      relation: 'extends',
      note: 'Would cut physical overhead by about three orders of magnitude — if it exists.',
    },
  ],
};

const MILESTONES: TimelineData = {
  legend:
    'Bar = evidence window, from first public artefact to peer-reviewed publication. Fill = strength of evidence. The two dim bars to the right of the marker are targets, not results.',
  now: 0.74,
  nowLabel: 'today',
  ticks: [
    { label: '2024', t: 0 },
    { label: '2025', t: 0.286 },
    { label: '2026', t: 0.571 },
    { label: '2027', t: 0.857 },
  ],
  milestones: [
    {
      id: 'ms-logical12',
      label: '12 logical qubits at 800× physical',
      date: '3 Apr 2024 · Microsoft + Quantinuum',
      t: 0.073,
      t0: 0.062,
      t1: 0.086,
      confidence: 0.78,
      accent: 'mint',
    },
    {
      id: 'ms-willow',
      label: 'Below-threshold surface code, Λ = 2.14',
      date: 'arXiv 27 Aug 2024 → Nature 12 Feb 2025',
      t: 0.319,
      t0: 0.187,
      t1: 0.319,
      confidence: 0.96,
      accent: 'mint',
    },
    {
      id: 'ms-aurora',
      label: 'Aurora — 35 chips, 13 km of fibre',
      date: '22 Jan 2025 · Xanadu',
      t: 0.303,
      t0: 0.28,
      t1: 0.303,
      confidence: 0.87,
      accent: 'blue',
    },
    {
      id: 'ms-majorana',
      label: 'Majorana 1 announced',
      date: '19 Feb 2025 · Microsoft',
      t: 0.324,
      t0: 0.318,
      t1: 0.33,
      confidence: 0.24,
      accent: 'magenta',
    },
    {
      id: 'ms-zuchongzhi',
      label: 'Zuchongzhi 3.0 — 105 qubit RCS',
      date: 'arXiv 16 Dec 2024 → PRL 3 Mar 2025',
      t: 0.334,
      t0: 0.274,
      t1: 0.334,
      confidence: 0.55,
      accent: 'amber',
    },
    {
      id: 'ms-rsa',
      label: 'RSA-2048 estimate falls below 10⁶ qubits',
      date: '21 May 2025 · Gidney, preprint only',
      t: 0.396,
      t0: 0.39,
      t1: 0.402,
      confidence: 0.72,
      accent: 'violet',
    },
    {
      id: 'ms-caltech',
      label: '6 100-atom neutral-atom array',
      date: '24 Sep 2025 · Caltech',
      t: 0.494,
      t0: 0.47,
      t1: 0.494,
      confidence: 0.81,
      accent: 'blue',
    },
    {
      id: 'ms-helios',
      label: 'Helios — 48 logical qubits, 99.921 % 2Q',
      date: '5 Nov 2025 · Quantinuum',
      t: 0.529,
      t0: 0.512,
      t1: 0.529,
      confidence: 0.68,
      accent: 'mint',
    },
    {
      id: 'ms-nighthawk',
      label: 'Nighthawk — 5 000 two-qubit gates',
      date: 'target, end 2026 · IBM roadmap',
      t: 0.843,
      t0: 0.743,
      t1: 0.943,
      confidence: 0.45,
      accent: 'amber',
      forecast: true,
    },
    {
      id: 'ms-kookaburra',
      label: 'Kookaburra — 1 386 q, modular',
      date: 'target, 2027 · IBM roadmap',
      t: 0.95,
      t0: 0.857,
      t1: 1,
      confidence: 0.32,
      accent: 'amber',
      forecast: true,
    },
  ],
};

const CONTRADICTION: SourcesData = {
  split: true,
  summary: 'One device. Two peer-reviewed artefacts. Readings that cannot both be right.',
  scanned: 9,
  kept: 6,
  question:
    'Does the Majorana 1 device demonstrate a topological qubit, or a parity measurement on a device that may hold no zero modes at all?',
  settleWith:
    'One lab that did not tune the device, one parity measurement that survives a fridge cycle, and the four raw traces Delft has not released.',
  pending: 'Delft raw traces — blocked on your approval',
  sources: [
    {
      id: 'con-nature',
      title: 'Interferometric single-shot parity measurement in InAs–Al hybrid devices',
      venue: 'Nature 638, 651–655 · Microsoft Azure Quantum',
      date: '19 Feb 2025',
      recency: 0.75,
      credibility: 0.55,
      tier: 'peer-reviewed',
      agent: 'Librarian',
      note: 'Reports single-shot parity readout at 1 µs with 99 % assignment fidelity. The word "qubit" does not appear in the claim it actually tests.',
      stance: 'supports',
      measure: 'primary device data',
    },
    {
      id: 'con-roadmap',
      title: 'Roadmap to fault-tolerant quantum computation using topological qubit arrays',
      venue: 'arXiv:2502.12252 · Microsoft',
      date: '19 Feb 2025',
      recency: 0.75,
      credibility: 0.42,
      tier: 'preprint',
      agent: 'Adversary',
      note: 'Describes a tetron array and a 4 × 2 device. The topological claim here is architectural, not measured.',
      stance: 'supports',
      measure: 'no peer review',
    },
    {
      id: 'con-aps',
      title: '2e-periodic gap in a hybrid nanowire — session B51',
      venue: 'APS March Meeting 2025, slides only',
      date: '18 Mar 2025',
      recency: 0.76,
      credibility: 0.3,
      tier: 'talk',
      agent: 'Adversary',
      note: 'No data release. Two attendees recorded contradictory answers to the same question about the disorder control.',
      stance: 'supports',
      measure: 'unciteable',
      contested: true,
    },
    {
      id: 'con-referee',
      title: 'Peer-review file published alongside Nature 638, 651',
      venue: 'Nature — referee reports 1–3',
      date: '19 Feb 2025',
      recency: 0.75,
      credibility: 0.93,
      tier: 'peer-review-file',
      agent: 'Adversary',
      note: 'Referee 3: the data do not establish the presence of Majorana zero modes. The editors accepted it as a measurement technique.',
      stance: 'contradicts',
      measure: 'primary, on the record',
    },
    {
      id: 'con-legg',
      title: 'Comment on the topological gap protocol',
      venue: 'Phys. Rev. B 111, 045423 · H. F. Legg',
      date: '15 Jan 2025',
      recency: 0.73,
      credibility: 0.86,
      tier: 'peer-reviewed',
      agent: 'Adversary',
      note: 'Shows the protocol admits false positives: trivial Andreev states under disorder reproduce the same signature.',
      stance: 'contradicts',
      measure: 'replicated numerically',
    },
    {
      id: 'con-delft',
      title: 'Reproduction attempt across four tetron devices',
      venue: 'Delft — preprint, raw traces withheld',
      date: '11 Apr 2026',
      recency: 0.94,
      credibility: 0.71,
      tier: 'preprint',
      agent: 'Adversary',
      note: 'No 2e-periodic signature outside the tuned parameter window. The traces that would settle it are the ones we are waiting on approval to request.',
      stance: 'contradicts',
      measure: 'awaiting raw data',
    },
  ],
};

export const RESEARCH: SairiContext = {
  id: 'ctx-research-quantum',
  intention: 'what actually happened in quantum computing since Willow — and what is just press?',
  objective:
    'Rank every claimed 2024–2026 quantum-computing result by strength of evidence, separate demonstrated error correction from architecture marketing, and isolate the claims no independent group has reproduced.',
  kind: 'research',
  hue: 'violet',
  lastActive: 2,
  agents: [
    {
      id: 'agent-librarian',
      role: 'Source librarian',
      task: 'Ranking 41 sources by venue, independence and whether primary data was released',
      status: 'working',
      progress: 0.72,
      hue: 'violet',
      output:
        'Promoted Nature 638:920 to tier 1. Held three vendor blogs at tier 3 until a primary artefact appears.',
      produced: ['res-anchors'],
    },
    {
      id: 'agent-metrologist',
      role: 'Metrologist',
      task: 'Normalising fidelity claims onto randomised-benchmarking equivalents',
      status: 'working',
      progress: 0.44,
      hue: 'cyan',
      output:
        'Heron R2: vendor quotes 1.8 × 10⁻³ for its best pair; the median over 148 pairs is 3.3 × 10⁻³. Using the median.',
      produced: ['res-architectures', 'res-remeasure'],
    },
    {
      id: 'agent-chronologist',
      role: 'Chronologist',
      task: 'Dating each milestone to its first public artefact rather than its press release',
      status: 'done',
      progress: 1,
      hue: 'mint',
      output:
        'Willow moved back to 27 Aug 2024 (arXiv:2408.13687); the Nature date is now the edge of the band, not the point.',
      produced: ['res-timeline'],
    },
    {
      id: 'agent-synthesist',
      role: 'Synthesist',
      task: 'Wiring concepts into a relation graph and typing every edge',
      status: 'working',
      progress: 0.58,
      hue: 'blue',
      output:
        'Fourteen relations typed. Two contradictions survive; both terminate on the topological branch.',
      produced: ['res-map'],
    },
    {
      id: 'agent-adversary',
      role: 'Adversary',
      task: 'Trying to break the topological-qubit claim using the published referee file',
      status: 'awaiting-approval',
      progress: 0.63,
      hue: 'magenta',
      output:
        'Blocked on two permissions: $32 to Springer for the Nature peer-review file, and one email to the Delft group requesting four withheld device traces.',
      produced: ['res-contradiction'],
    },
  ],
  panels: [
    {
      id: 'res-anchors',
      title: 'Anchor evidence',
      lens: 'sources',
      certainty: 'resolved',
      span: 4,
      author: 'Librarian',
      data: ANCHORS,
    },
    {
      id: 'res-architectures',
      title: 'Four architectures, measured',
      lens: 'comparison',
      certainty: 'forming',
      span: 8,
      author: 'Metrologist',
      data: ARCHITECTURES,
    },
    {
      id: 'res-map',
      title: 'Concept graph',
      lens: 'knowledge-map',
      certainty: 'forming',
      span: 7,
      author: 'Synthesist',
      data: CONCEPT_MAP,
    },
    {
      id: 'res-remeasure',
      title: 'Vendor claim vs re-measure',
      lens: 'comparison',
      certainty: 'resolved',
      span: 5,
      author: 'Metrologist',
      data: REMEASURE,
    },
    {
      id: 'res-timeline',
      title: 'Breakthroughs, dated to first artefact',
      lens: 'timeline',
      certainty: 'forming',
      span: 12,
      author: 'Chronologist',
      data: MILESTONES,
    },
    {
      id: 'res-contradiction',
      title: 'Open — is Majorana 1 a topological qubit?',
      lens: 'sources',
      certainty: 'provisional',
      span: 12,
      author: 'Adversary',
      data: CONTRADICTION,
    },
  ],
  proposal: {
    title: 'Settle the topological claim before anything downstream of it',
    detail:
      'Three of the four architecture verdicts are stable. The fourth is holding up the summary: one supporting device, three contradicting readings, and the data that would decide it sitting behind a paywall and an unanswered email. I can buy the peer-review file and ask Delft for the four raw traces, then re-run Legg’s false-positive test against them.',
    verb: 'Request the traces',
  },
};

/* ------------------------------------------------------------------------ *
 * sources — a ranked list, or a claim/counter-claim split
 * ------------------------------------------------------------------------ */

const TIER_ACCENT: Record<SourceTier, Spectral> = {
  'peer-reviewed': 'mint',
  'peer-review-file': 'mint',
  preprint: 'blue',
  vendor: 'amber',
  talk: 'violet',
};

const TIER_LABEL: Record<SourceTier, string> = {
  'peer-reviewed': 'peer reviewed',
  'peer-review-file': 'referee file',
  preprint: 'preprint',
  vendor: 'vendor',
  talk: 'talk',
};

/** Own component so `useCountUp`'s hook state belongs to it, not to whatever renders the lens. */
function SourceTally({ scanned, kept }: { scanned: number; kept: number }): JSX.Element {
  const n = useCountUp(scanned, 900);
  return (
    <Metric accent="violet" label={`sources scanned · ${kept} kept`} value={`${Math.round(n)}`} />
  );
}

function SourceRow({ source, rank }: { source: ResearchSource; rank?: number }): JSX.Element {
  const pips = Math.max(1, Math.round(source.recency * 4));
  return (
    <li
      className={`s-res-src__row${rank === undefined ? ' s-res-src__row--norank' : ''}${
        source.contested ? ' s-res-src__row--contested' : ''
      }`}
    >
      {rank !== undefined && <span className="s-res-src__rank">{rank}</span>}
      <div className="s-res-src__main">
        <p className="s-res-src__title">{source.title}</p>
        <p className="s-res-src__venue">{source.venue}</p>
        <p className="s-res-src__note">{source.note}</p>
        <div className="s-res-src__meta">
          <Tag accent={source.contested ? 'magenta' : TIER_ACCENT[source.tier]}>
            {source.contested ? 'contested' : TIER_LABEL[source.tier]}
          </Tag>
          <span className="s-res-src__date">{source.date}</span>
          <span
            aria-label={`recency ${pips} of 4`}
            className="s-res-src__pips"
            role="img"
            style={{ '--accent': hue('violet') } as CSSProperties}
          >
            {[0, 1, 2, 3].map((i) => (
              <span className={`s-res-src__pip${i < pips ? ' is-on' : ''}`} key={i} />
            ))}
          </span>
          {source.measure && <span className="s-res-src__measure">{source.measure}</span>}
          <span className="s-res-src__agent">
            <StatusOrb hue="violet" size={5} /> {source.agent}
          </span>
        </div>
      </div>
      <div className="s-res-src__cred">
        <span className="s-res-src__credval">{Math.round(source.credibility * 100)}</span>
        <span
          aria-label={`credibility ${Math.round(source.credibility * 100)} of 100`}
          className="s-res-src__credbar"
          role="img"
          style={
            {
              '--v': source.credibility,
              '--accent': hue(source.credibility < 0.4 ? 'magenta' : 'mint'),
            } as CSSProperties
          }
        >
          <span className="s-res-src__credfill" />
        </span>
      </div>
    </li>
  );
}

function SourcesLens(input: LensInput): JSX.Element {
  const data = payload<SourcesData>(asPanel(input));

  if (data.split) {
    const supports = data.sources.filter((s) => s.stance === 'supports');
    const contradicts = data.sources.filter((s) => s.stance === 'contradicts');
    return (
      <div className="s-res-src s-res-src--split">
        <p className="s-res-src__question">{data.question}</p>
        <div className="s-res-split">
          <section className="s-res-split__col">
            <h4 className="s-res-split__head">
              <StatusOrb hue="mint" size={6} /> claims it does — {supports.length}
            </h4>
            <ol className="s-res-src__list">
              {supports.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ol>
          </section>
          <span aria-hidden="true" className="s-res-split__spine" />
          <section className="s-res-split__col">
            <h4 className="s-res-split__head">
              <StatusOrb hue="magenta" pulse size={6} /> says it does not — {contradicts.length}
            </h4>
            <ol className="s-res-src__list">
              {contradicts.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ol>
          </section>
        </div>
        <GlowDivider accent="magenta" />
        <div className="s-res-open">
          <div>
            <h4 className="s-res-open__head">What would settle it</h4>
            <p className="s-res-open__text">{data.settleWith}</p>
          </div>
          <div className="s-res-open__pending">
            <span className="s-res-open__pendinglabel">{data.pending}</span>
            <Forming rows={2} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="s-res-src">
      <div className="s-res-src__summary">
        <SourceTally kept={data.kept} scanned={data.scanned} />
        <p className="s-res-src__summarytext">{data.summary}</p>
      </div>
      <ol className="s-res-src__list">
        {data.sources.map((s, i) => (
          <SourceRow key={s.id} rank={i + 1} source={s} />
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * knowledge-map — a hand-built SVG relation graph
 *
 * Positions are authored, not simulated. A force layout would need a physics
 * loop the performance budget forbids, and would move the graph between renders
 * — which for a knowledge map is a lie: the reader would read motion as new
 * information. Fixed coordinates mean the same evidence always draws the same
 * picture, and the edge TYPE carries the meaning instead.
 * ------------------------------------------------------------------------ */

const RELATION_LABEL: Record<Relation, string> = {
  supports: 'supports',
  contradicts: 'contradicts',
  extends: 'extends',
};

function edgePath(a: MapNode, b: MapNode): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Stop short of both rims so the arrowhead lands on the circle, not under it.
  const x1 = a.x + ux * (a.r + 2);
  const y1 = a.y + uy * (a.r + 2);
  const x2 = b.x - ux * (b.r + 8);
  const y2 = b.y - uy * (b.r + 8);
  const bow = 0.08;
  const cx = (x1 + x2) / 2 - (y2 - y1) * bow;
  const cy = (y1 + y2) / 2 + (x2 - x1) * bow;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function KnowledgeMapLens(input: LensInput): JSX.Element {
  const panel = asPanel(input);
  const data = payload<KnowledgeMapData>(panel);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const titleId = `${panel.id}-map-title`;
  const descId = `${panel.id}-map-desc`;

  const drawn = data.edges
    .map((e) => {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      return from && to ? { edge: e, from, to } : null;
    })
    .filter((x): x is { edge: MapEdge; from: MapNode; to: MapNode } => x !== null);

  return (
    <figure className="s-res-map">
      <svg
        aria-describedby={descId}
        aria-labelledby={titleId}
        className="s-res-map__svg"
        role="img"
        viewBox="0 0 460 292"
      >
        <title id={titleId}>Concept graph of quantum-computing findings</title>
        <desc id={descId}>
          {data.nodes.length} concepts joined by {data.edges.length} typed relations. The full
          relation list is written out below the graph.
        </desc>
        <defs>
          {(['supports', 'contradicts', 'extends'] as Relation[]).map((r) => (
            <marker
              id={`${panel.id}-arrow-${r}`}
              key={r}
              markerHeight="6"
              markerWidth="6"
              orient="auto"
              refX="5"
              refY="3"
              viewBox="0 0 6 6"
            >
              <path className={`s-res-map__arrow s-res-map__arrow--${r}`} d="M 0 0 L 6 3 L 0 6 z" />
            </marker>
          ))}
        </defs>

        <g>
          {drawn.map(({ edge, from, to }) => (
            <path
              className={`s-res-map__edge s-res-map__edge--${edge.relation}`}
              d={edgePath(from, to)}
              key={`${edge.from}-${edge.to}`}
              markerEnd={`url(#${panel.id}-arrow-${edge.relation})`}
            />
          ))}
        </g>

        <g>
          {data.nodes.map((n) => (
            <g className="s-res-map__node" key={n.id} style={{ color: hue(n.accent) }}>
              <circle
                className={`s-res-map__disc s-res-map__disc--${n.state}`}
                cx={n.x}
                cy={n.y}
                r={n.r}
              />
              <text className="s-res-map__label" textAnchor="middle" x={n.x} y={n.y + n.r + 11}>
                {n.label}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <ul className="s-res-map__legend">
        <li>
          <span className="s-res-map__key s-res-map__key--supports" /> supports
        </li>
        <li>
          <span className="s-res-map__key s-res-map__key--contradicts" /> contradicts
        </li>
        <li>
          <span className="s-res-map__key s-res-map__key--extends" /> extends
        </li>
        <li className="s-res-map__legendnote">dashed disc = disputed concept</li>
      </ul>

      <figcaption className="s-res-map__caption">{data.caption}</figcaption>

      {/* The graph is the fast read; this is the complete one, and the only one a
          screen reader or a printed page can use. */}
      <details className="s-res-map__alt">
        <summary>Read the {data.edges.length} relations as text</summary>
        <ul>
          {drawn.map(({ edge, from, to }) => (
            <li key={`alt-${edge.from}-${edge.to}`}>
              <b>{from.label}</b> {RELATION_LABEL[edge.relation]} <b>{to.label}</b> — {edge.note}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------ *
 * comparison — a dense table, and a compact re-measure variant
 * ------------------------------------------------------------------------ */

const FLAG_ACCENT: Record<NonNullable<CompareRow['flag']>, Spectral> = {
  match: 'mint',
  overstated: 'amber',
  unsupported: 'magenta',
};

function ComparisonLens(input: LensInput): JSX.Element {
  const panel = asPanel(input);
  const data = payload<ComparisonData>(panel);
  return (
    <div className={`s-res-cmp${data.compact ? ' s-res-cmp--compact' : ''}`}>
      {/* Wide tables scroll inside the panel rather than widening it: the panel's
          width means something here, so it must not be set by its contents. */}
      <div className="s-res-cmp__wrap" tabIndex={0}>
        <table className="s-res-cmp__table">
          <caption className="s-res-sr">{panel.title}</caption>
          <thead>
            <tr>
              <th className="s-res-cmp__corner" scope="col">
                <span className="s-res-sr">Metric</span>
              </th>
              {data.columns.map((c) => (
                <th
                  className="s-res-cmp__colhead"
                  key={c.id}
                  scope="col"
                  style={{ '--accent': hue(c.accent) } as CSSProperties}
                >
                  <span className="s-res-cmp__name">{c.name}</span>
                  <span className="s-res-cmp__sub">{c.sub}</span>
                  {c.verdict && (
                    <span className="s-res-cmp__verdict">
                      <Tag accent={c.accent}>{c.verdict}</Tag>
                    </span>
                  )}
                </th>
              ))}
              {data.compact && (
                <th className="s-res-cmp__colhead" scope="col">
                  <span className="s-res-cmp__name">Verdict</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.metric}>
                <th className="s-res-cmp__metric" scope="row">
                  {row.metric}
                </th>
                {row.cells.map((cell, i) => {
                  const col = data.columns[i];
                  return (
                    <td
                      className={`s-res-cmp__cell${cell.caveat ? ' s-res-cmp__cell--caveat' : ''}`}
                      key={`${row.metric}-${col?.id ?? i}`}
                      style={{ '--accent': hue(col?.accent ?? 'blue') } as CSSProperties}
                    >
                      <span className="s-res-cmp__val">
                        {cell.value}
                        {cell.caveat && (
                          <abbr
                            className="s-res-cmp__caveat"
                            title="Vendor-reported, not independently replicated"
                          >
                            †
                          </abbr>
                        )}
                      </span>
                      {cell.strength !== undefined && (
                        <span
                          aria-hidden="true"
                          className="s-res-cmp__bar"
                          style={{ '--v': cell.strength } as CSSProperties}
                        >
                          <span className="s-res-cmp__barfill" />
                        </span>
                      )}
                    </td>
                  );
                })}
                {data.compact && (
                  <td className="s-res-cmp__cell s-res-cmp__cell--flag">
                    {row.flag && <Tag accent={FLAG_ACCENT[row.flag]}>{row.flag}</Tag>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s-res-cmp__foot">{data.footnote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * timeline — breakthroughs on a time axis, with confidence bands
 *
 * Two independent uncertainties, deliberately given two independent channels:
 * the bar's WIDTH is how long the evidence took to become citable, and its FILL
 * is how strongly anyone believes it. A wide dim bar and a narrow dim bar mean
 * very different things, and a viewer can tell them apart at a glance.
 * ------------------------------------------------------------------------ */

function TimelineLens(input: LensInput): JSX.Element {
  const data = payload<TimelineData>(asPanel(input));
  return (
    <div className="s-res-tl" style={{ '--now': data.now } as CSSProperties}>
      <div className="s-res-tl__scale">
        <span className="s-res-tl__meta" />
        <span className="s-res-tl__ticks">
          {data.ticks.map((t) => (
            <span className="s-res-tl__tick" key={t.label} style={{ '--t': t.t } as CSSProperties}>
              {t.label}
            </span>
          ))}
          <span className="s-res-tl__tick s-res-tl__tick--now">{data.nowLabel}</span>
        </span>
        <span className="s-res-tl__confhead">conf.</span>
      </div>

      <ol className="s-res-tl__list">
        {data.milestones.map((m) => (
          <li
            className={`s-res-tl__row${m.forecast ? ' s-res-tl__row--forecast' : ''}`}
            key={m.id}
            style={
              {
                '--t': m.t,
                '--t0': m.t0,
                '--t1': m.t1,
                '--k': m.confidence,
                '--accent': hue(m.accent),
              } as CSSProperties
            }
          >
            <span className="s-res-tl__meta">
              <span className="s-res-tl__label">{m.label}</span>
              <span className="s-res-tl__date">{m.date}</span>
            </span>
            <span aria-hidden="true" className="s-res-tl__track">
              <span className="s-res-tl__band" />
              <span className="s-res-tl__dot" />
              <span className="s-res-tl__now" />
            </span>
            <span className="s-res-tl__conf">{Math.round(m.confidence * 100)}%</span>
          </li>
        ))}
      </ol>

      <p className="s-res-tl__legend">{data.legend}</p>
    </div>
  );
}

export const RESEARCH_LENSES: Partial<Record<LensKind, (panel: Panel) => JSX.Element>> = {
  sources: SourcesLens,
  'knowledge-map': KnowledgeMapLens,
  comparison: ComparisonLens,
  timeline: TimelineLens,
};
