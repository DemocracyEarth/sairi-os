import { useState, type CSSProperties, type JSX } from 'react';
import { Empty, GlowDivider, Metric, StatusOrb, Tag, hue, useCountUp } from '../primitives.js';
import type { LensKind, Panel, SairiContext, Spectral } from '../state.js';
import './design.css';

/**
 * DESIGN — "Bellwether, March launch".
 *
 * The early-convergence context, and deliberately the loosest workspace in the
 * system. Where the incident context tightens around one failing thing, this one
 * is still holding four possible products at once: one resolved artifact, and
 * everything else wide, dashed and cool.
 *
 * Read the panel spans as an argument. The only narrow surface here is the
 * positioning statement, because it is the only thing anybody has actually
 * decided; the board that contains every open question is full width. Nothing
 * enforces that — a lens cannot see layout — but it is the reason the spans are
 * what they are, and changing one changes the claim the screen is making.
 *
 * All content is authored here and offline. No fetch, no timer, no model.
 */

/* ------------------------------------------------------------------------ *
 * Lens payloads
 *
 * Panel.data is `unknown` by contract: the lens is the narrowing point. These
 * shapes are declared and instantiated in this file, so the cast at the bottom
 * is a local type assertion and not a trust decision — nothing here crosses a
 * boundary that needs validating.
 * ------------------------------------------------------------------------ */

type NoteKind = 'seed' | 'evidence' | 'question' | 'constraint' | 'decision';

interface CanvasNote {
  id: string;
  kind: NoteKind;
  text: string;
  /** Board position, percent of the canvas box. Placed by hand, not laid out. */
  x: number;
  y: number;
  w: number;
  /** Degrees. Nothing on a real board is square to anything else. */
  tilt: number;
  cluster?: string;
  meta?: string;
}

interface CanvasCluster {
  id: string;
  label: string;
  note: string;
  accent: Spectral;
  x: number;
  y: number;
  w: number;
  h: number;
}

type LinkKind = 'supports' | 'tension' | 'derives';

interface CanvasLink {
  id: string;
  kind: LinkKind;
  from: string;
  to: string;
  /**
   * Endpoints are authored rather than derived from the notes they join.
   * A note's height depends on where its text wraps, so a computed endpoint
   * moves every time the panel resizes — and a connector that re-aims itself
   * reads as a generated diagram. These were drawn once, like the board.
   */
  a: [number, number];
  b: [number, number];
  /** Perpendicular bow, in board units. Sign picks the side it arcs to. */
  bow: number;
}

interface CanvasBoard {
  clusters: CanvasCluster[];
  notes: CanvasNote[];
  links: CanvasLink[];
  footer: string;
}

interface Quote {
  text: string;
  who: string;
  where: string;
  ref: string;
}

interface InsightTheme {
  id: string;
  label: string;
  accent: Spectral;
  count: number;
  strength: 'weak' | 'holding' | 'strong';
  reading: string;
  unanswered?: boolean;
  quotes: Quote[];
}

interface InsightBoard {
  n: number;
  source: string;
  metrics: { value: string; label: string }[];
  themes: InsightTheme[];
}

interface Concept {
  id: string;
  mark: string;
  codename: string;
  frame: string;
  line: string;
  evidence: string;
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
  leading?: boolean;
}

interface ConceptSet {
  decidesBy: string;
  concepts: Concept[];
}

interface ArtifactDoc {
  kind: string;
  version: string;
  producedAt: string;
  provenance: string[];
  statement: { lead: string; body: string; proof: string; unlike: string };
  changed: string;
  sequence: { day: string; beat: string; detail: string; locked: boolean }[];
  approve: { label: string; hint: string; unblocks: string; approved: string };
}

/* ------------------------------------------------------------------------ *
 * canvas — the divergent board
 *
 * The one lens in the system with no layout algorithm at all. Notes sit where
 * someone put them, clusters are soft regions rather than containers, and a
 * note is allowed to break out of its cluster because on a real board they do.
 * ------------------------------------------------------------------------ */

const NOTE_ACCENT: Record<NoteKind, Spectral> = {
  seed: 'blue',
  evidence: 'mint',
  question: 'magenta',
  constraint: 'coral',
  decision: 'amber',
};

const NOTE_LABEL: Record<NoteKind, string> = {
  seed: 'starting point',
  evidence: 'evidence',
  question: 'open question',
  constraint: 'constraint',
  decision: 'decision',
};

const LINK_WORD: Record<LinkKind, string> = {
  supports: 'supports',
  tension: 'is in tension with',
  derives: 'leads to',
};

/**
 * Quadratic connector through a point offset perpendicular to the chord.
 * A straight line between two notes reads as a wire; a slight bow reads as
 * something a person drew, which is the whole register of this panel.
 */
function connector(a: [number, number], b: [number, number], bow: number): string {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (ax + bx) / 2 + (-dy / len) * bow;
  const cy = (ay + by) / 2 + (dx / len) * bow;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

function CanvasLens({ board }: { board: CanvasBoard }): JSX.Element {
  // Focus dims everything outside one cluster instead of hiding it: on a
  // divergent board the things you are not looking at are still the argument.
  const [focus, setFocus] = useState<string | null>(null);
  const byId = new Map(board.notes.map((n) => [n.id, n] as const));
  const inFocus = (cluster: string | undefined): boolean => focus === null || cluster === focus;

  return (
    <div className="s-dsn-canvas">
      <div className="s-dsn-canvas__bar">
        <div className="s-dsn-focus" role="group" aria-label="Focus a cluster">
          <button
            aria-pressed={focus === null}
            className="s-dsn-chip"
            onClick={() => setFocus(null)}
            type="button"
          >
            Whole board
          </button>
          {board.clusters.map((c) => (
            <button
              aria-pressed={focus === c.id}
              className="s-dsn-chip"
              key={c.id}
              onClick={() => setFocus(focus === c.id ? null : c.id)}
              style={{ '--accent': hue(c.accent) } as CSSProperties}
              type="button"
            >
              {c.label}
            </button>
          ))}
        </div>
        <ul className="s-dsn-legend">
          {(Object.keys(NOTE_ACCENT) as NoteKind[]).map((k) => (
            <li key={k} style={{ '--accent': hue(NOTE_ACCENT[k]) } as CSSProperties}>
              <span aria-hidden="true" className="s-dsn-legend__swatch" />
              {NOTE_LABEL[k]}
            </li>
          ))}
        </ul>
      </div>

      {/* Focusable because it is a scroll container at narrow widths, and a
          scroll region a pointer can reach has to be reachable by a key too. */}
      <div
        aria-label="Divergent board — scrollable"
        className="s-dsn-board-wrap"
        role="group"
        tabIndex={0}
      >
        <div className="s-dsn-board">
          {board.clusters.map((c) => (
            <div
              className="s-dsn-hull"
              data-dim={inFocus(c.id) ? undefined : 'true'}
              key={c.id}
              style={
                {
                  '--accent': hue(c.accent),
                  left: `${c.x}%`,
                  top: `${c.y}%`,
                  width: `${c.w}%`,
                  height: `${c.h}%`,
                } as CSSProperties
              }
            >
              <span className="s-dsn-hull__label">{c.label}</span>
              <span className="s-dsn-hull__note">{c.note}</span>
            </div>
          ))}

          {/*
            preserveAspectRatio="none" lets the board keep a fluid height while
            SVG percentages stay aligned to the notes' percentages. The
            distortion that introduces is cancelled for strokes by
            non-scaling-stroke, and nothing here is a closed shape.
          */}
          <svg
            aria-hidden="true"
            className="s-dsn-wires"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            {board.links.map((l) => {
              const lit = inFocus(byId.get(l.from)?.cluster) || inFocus(byId.get(l.to)?.cluster);
              return (
                <path
                  className={`s-dsn-wire s-dsn-wire--${l.kind}`}
                  d={connector(l.a, l.b, l.bow)}
                  data-dim={lit ? undefined : 'true'}
                  key={l.id}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {board.notes.map((n, i) => (
            <article
              className={`s-dsn-note s-dsn-note--${n.kind}`}
              data-dim={inFocus(n.cluster) ? undefined : 'true'}
              key={n.id}
              style={
                {
                  '--accent': hue(NOTE_ACCENT[n.kind]),
                  '--tilt': `${n.tilt}deg`,
                  '--i': i,
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  width: `${n.w}%`,
                } as CSSProperties
              }
            >
              <span className="s-dsn-note__kind">{NOTE_LABEL[n.kind]}</span>
              <p className="s-dsn-note__text">{n.text}</p>
              {n.meta && <span className="s-dsn-note__meta">{n.meta}</span>}
            </article>
          ))}
        </div>
      </div>

      {/* The connectors carry meaning, so they get a text equivalent rather
          than an aria-label summarising a picture nobody can read. */}
      <h4 className="s-dsn-sr">Connections drawn on the board</h4>
      <ul className="s-dsn-sr">
        {board.links.map((l) => (
          <li key={l.id}>
            {byId.get(l.from)?.text} {LINK_WORD[l.kind]} {byId.get(l.to)?.text}
          </li>
        ))}
      </ul>

      <p className="s-dsn-foot">{board.footer}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * insights — evidence, not findings
 *
 * A theme is only ever a container for verbatims. The count and the source are
 * always next to the quote, because the difference between research and
 * decoration is whether you can get back to who said it.
 * ------------------------------------------------------------------------ */

const STRENGTH_ACCENT: Record<InsightTheme['strength'], Spectral> = {
  weak: 'coral',
  holding: 'cyan',
  strong: 'mint',
};

function Verbatim({ quote }: { quote: Quote }): JSX.Element {
  return (
    <figure className="s-dsn-quote">
      <blockquote className="s-dsn-quote__text">{quote.text}</blockquote>
      <figcaption className="s-dsn-quote__src">
        <span className="s-dsn-quote__who">{quote.who}</span>
        <span className="s-dsn-quote__where">{quote.where}</span>
        <span className="s-dsn-quote__ref">{quote.ref}</span>
      </figcaption>
    </figure>
  );
}

function InsightsLens({ board }: { board: InsightBoard }): JSX.Element {
  const n = Math.round(useCountUp(board.n, 900));

  return (
    <div className="s-dsn-insights">
      <div className="s-dsn-insights__head">
        <Metric accent="amber" label="interviews coded" value={String(n)} />
        {board.metrics.map((m) => (
          <Metric key={m.label} label={m.label} value={m.value} />
        ))}
      </div>
      <p className="s-dsn-insights__source">{board.source}</p>

      {board.themes.map((theme) => {
        const pct = Math.round((theme.count / board.n) * 100);
        const [first, second, ...rest] = theme.quotes;
        return (
          <section
            className="s-dsn-theme"
            key={theme.id}
            style={{ '--accent': hue(theme.accent) } as CSSProperties}
          >
            <header className="s-dsn-theme__head">
              <h4 className="s-dsn-theme__label">{theme.label}</h4>
              <span className="s-dsn-theme__tags">
                {theme.unanswered && <Tag accent="amber">unanswered</Tag>}
                <Tag accent={STRENGTH_ACCENT[theme.strength]} solid={theme.strength === 'strong'}>
                  {theme.strength}
                </Tag>
              </span>
            </header>

            <div
              aria-label={`${theme.count} of ${board.n} interviews, ${pct} percent`}
              className="s-dsn-freq"
              role="img"
            >
              <span className="s-dsn-freq__rail">
                <span className="s-dsn-freq__fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="s-dsn-freq__count">
                {theme.count}
                <span className="s-dsn-freq__of">/{board.n}</span>
              </span>
            </div>

            <p className="s-dsn-theme__reading">{theme.reading}</p>

            {theme.quotes.length === 0 ? (
              <Empty>
                No verbatim yet. Two Rotterdam support tickets and one returns form imply this; the
                synthesist will not promote it until somebody actually says it.
              </Empty>
            ) : (
              <>
                {first && <Verbatim quote={first} />}
                {second && <Verbatim quote={second} />}
                {rest.length > 0 && (
                  <details className="s-dsn-more">
                    <summary>{rest.length} more in this theme</summary>
                    {rest.map((q) => (
                      <Verbatim key={q.ref} quote={q} />
                    ))}
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * concepts — three ways to say what this is
 *
 * The leading concept is not marked with a badge and left the same size. It is
 * given the accent, the elevation and the only solid edge in the panel, so the
 * ranking is legible before any of the text is read.
 * ------------------------------------------------------------------------ */

const RISK_ACCENT: Record<Concept['riskLevel'], Spectral> = {
  low: 'mint',
  medium: 'amber',
  high: 'coral',
};

function ConceptsLens({ set }: { set: ConceptSet }): JSX.Element {
  const spread = set.concepts.map((c) => `${c.mark} at ${Math.round(c.confidence * 100)} percent`);

  return (
    <div className="s-dsn-concepts">
      <div className="s-dsn-spread">
        <svg
          aria-label={`Confidence spread: ${spread.join(', ')}`}
          className="s-dsn-spread__svg"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 16"
        >
          <line
            className="s-dsn-spread__axis"
            vectorEffect="non-scaling-stroke"
            x1="0"
            x2="100"
            y1="12"
            y2="12"
          />
          {set.concepts.map((c) => (
            <line
              className={`s-dsn-spread__tick${c.leading ? ' is-leading' : ''}`}
              key={c.id}
              vectorEffect="non-scaling-stroke"
              x1={c.confidence * 100}
              x2={c.confidence * 100}
              y1="2"
              y2="12"
            />
          ))}
        </svg>
        <div className="s-dsn-spread__scale" aria-hidden="true">
          <span>no support</span>
          <span>evidence behind it</span>
        </div>
      </div>

      {set.concepts.map((c) => (
        <article
          className={`s-dsn-concept${c.leading ? ' is-leading' : ''}`}
          key={c.id}
          style={{ '--accent': hue(c.leading ? 'amber' : 'blue') } as CSSProperties}
        >
          <div className="s-dsn-concept__mark" aria-hidden="true">
            {c.mark}
          </div>

          <div className="s-dsn-concept__main">
            <header className="s-dsn-concept__head">
              <span className="s-dsn-concept__frame">{c.frame}</span>
              {c.leading && (
                <span className="s-dsn-concept__lead">
                  <StatusOrb hue="amber" pulse size={6} /> leading
                </span>
              )}
            </header>
            <h4 className="s-dsn-concept__line">
              {c.codename} — “{c.line}”
            </h4>
            <p className="s-dsn-concept__evidence">{c.evidence}</p>
            <p
              className="s-dsn-concept__risk"
              style={{ '--risk': hue(RISK_ACCENT[c.riskLevel]) } as CSSProperties}
            >
              <span className="s-dsn-concept__risklabel">{c.riskLevel} risk</span>
              {c.risk}
            </p>
          </div>

          <div className="s-dsn-conf">
            <span className="s-dsn-conf__num">{Math.round(c.confidence * 100)}%</span>
            <span
              aria-label={`Confidence ${Math.round(c.confidence * 100)} percent`}
              className="s-dsn-conf__rail"
              role="img"
            >
              <span className="s-dsn-conf__fill" style={{ height: `${c.confidence * 100}%` }} />
            </span>
            <span className="s-dsn-conf__cap">confidence</span>
          </div>
        </article>
      ))}

      <p className="s-dsn-foot">{set.decidesBy}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * artifact — the one thing that actually exists
 *
 * A produced object with its provenance attached, not a summary of one. The
 * approve control is the moment a human decision enters the context, which is
 * why it is the only solid-filled button in the whole workspace.
 * ------------------------------------------------------------------------ */

function ArtifactLens({ doc }: { doc: ArtifactDoc }): JSX.Element {
  // Local to this panel by design. Nothing is persisted, published or sent —
  // the launch sequencer unblocking is the visible consequence, and it is the
  // only one, so the state cannot claim more than happened.
  const [approved, setApproved] = useState(false);

  return (
    <div className="s-dsn-artifact">
      <div className="s-dsn-stamp">
        <Tag accent="amber" solid>
          {doc.version}
        </Tag>
        <span className="s-dsn-stamp__kind">{doc.kind}</span>
        <span className="s-dsn-stamp__at">{doc.producedAt}</span>
      </div>

      <div className="s-dsn-doc">
        <p className="s-dsn-doc__lead">{doc.statement.lead}</p>
        <p className="s-dsn-doc__body">{doc.statement.body}</p>
        <p className="s-dsn-doc__proof">{doc.statement.proof}</p>
        <p className="s-dsn-doc__unlike">{doc.statement.unlike}</p>
      </div>

      <p className="s-dsn-changed">{doc.changed}</p>

      <GlowDivider accent="amber" />

      <h4 className="s-dsn-subhead">Sequence this unlocks</h4>
      <ol className="s-dsn-seq">
        {doc.sequence.map((s) => (
          <li className={`s-dsn-beat${s.locked ? ' is-locked' : ''}`} key={s.day}>
            <span className="s-dsn-beat__day">{s.day}</span>
            <span className="s-dsn-beat__body">
              <span className="s-dsn-beat__name">{s.beat}</span>
              <span className="s-dsn-beat__detail">{s.detail}</span>
            </span>
            <span className="s-dsn-beat__state">{s.locked ? 'committed' : 'depends on v4'}</span>
          </li>
        ))}
      </ol>

      <GlowDivider accent="amber" />

      <h4 className="s-dsn-subhead">Provenance</h4>
      <ol className="s-dsn-prov">
        {doc.provenance.map((step) => (
          <li className="s-dsn-prov__step" key={step}>
            {step}
          </li>
        ))}
      </ol>

      <div className="s-dsn-decide">
        {approved ? (
          <p className="s-dsn-decided">
            <StatusOrb hue="mint" size={7} label="Approved" />
            {doc.approve.approved}
          </p>
        ) : (
          <>
            <p className="s-dsn-decide__hint">{doc.approve.hint}</p>
            <div className="s-dsn-decide__row">
              <button className="s-dsn-approve" onClick={() => setApproved(true)} type="button">
                {doc.approve.label}
              </button>
              <button className="s-dsn-return" type="button">
                Send back with a note
              </button>
            </div>
            <p className="s-dsn-decide__blocks">
              <StatusOrb hue="coral" size={6} label="Blocked" />
              {doc.approve.unblocks}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------------ */

const BOARD: CanvasBoard = {
  footer: '15 notes · 4 clusters · nothing merged, nothing thrown away',
  clusters: [
    {
      id: 'c-who',
      label: 'who this is for',
      note: '3 audiences, 1 object',
      accent: 'violet',
      x: 1.5,
      y: 9,
      w: 30,
      h: 46,
    },
    {
      id: 'c-claim',
      label: 'the claim',
      note: 'legal sits inside this one',
      accent: 'amber',
      x: 35,
      y: 5,
      w: 31,
      h: 58,
    },
    {
      id: 'c-march',
      label: 'March mechanics',
      note: 'dates that cannot move',
      accent: 'cyan',
      x: 70,
      y: 10,
      w: 28.5,
      h: 46,
    },
    {
      id: 'c-open',
      label: 'nothing behind these yet',
      note: 'instinct only — flagged, not deleted',
      accent: 'magenta',
      x: 8,
      y: 66,
      w: 52,
      h: 27,
    },
  ],
  notes: [
    {
      id: 'n-tenant',
      kind: 'seed',
      text: 'Tenants who need a landlord to act.',
      x: 3,
      y: 14,
      w: 25,
      tilt: -0.8,
      cluster: 'c-who',
    },
    {
      id: 'n-third',
      kind: 'evidence',
      text: '71 of 214 showed a reading to a third party. Nobody asked them to.',
      x: 4,
      y: 28,
      w: 26,
      tilt: 0.6,
      cluster: 'c-who',
      meta: 'INT-084, INT-131, INT-046',
    },
    {
      id: 'n-same',
      kind: 'question',
      text: 'Do parents, tenants and cyclists want the same object?',
      x: 2.5,
      y: 42,
      w: 26,
      tilt: -0.4,
      cluster: 'c-who',
    },
    {
      id: 'n-claim',
      kind: 'seed',
      text: 'The claim is the whole launch. Everything else is scheduling.',
      x: 37,
      y: 9,
      w: 27,
      tilt: 0.5,
      cluster: 'c-claim',
    },
    {
      id: 'n-legal',
      kind: 'constraint',
      text: 'Legal, 19 Feb: no health claim without an MDR file.',
      x: 38,
      y: 23,
      w: 26,
      tilt: -0.7,
      cluster: 'c-claim',
      meta: 'blocks Concept A outright',
    },
    {
      id: 'n-nine',
      kind: 'evidence',
      text: 'Only 9 of 214 reached for health language unprompted.',
      x: 36.5,
      y: 37,
      w: 26,
      tilt: 0.4,
      cluster: 'c-claim',
    },
    {
      id: 'n-conc',
      kind: 'decision',
      text: 'Concept C leads — air you can hand to someone.',
      x: 37.5,
      y: 50,
      w: 27,
      tilt: -0.3,
      cluster: 'c-claim',
    },
    {
      id: 'n-milan',
      kind: 'constraint',
      text: 'Milan buy closes 6 March — €8,200 of the €12,400.',
      x: 72,
      y: 15,
      w: 24,
      tilt: 0.7,
      cluster: 'c-march',
    },
    {
      id: 'n-rott',
      kind: 'seed',
      text: 'Rotterdam first: 41% of beta, and tenant law is on our side.',
      x: 71,
      y: 28,
      w: 25,
      tilt: -0.5,
      cluster: 'c-march',
    },
    {
      id: 'n-map',
      kind: 'question',
      text: 'Ship the neighbourhood map in March, or hold it to April?',
      x: 72.5,
      y: 41,
      w: 24,
      tilt: 0.35,
      cluster: 'c-march',
    },
    {
      id: 'n-week4',
      kind: 'question',
      text: '39 of 214 stopped looking by week three. What is week four for?',
      x: 10,
      y: 70,
      w: 26,
      tilt: -0.6,
      cluster: 'c-open',
    },
    {
      id: 'n-sub',
      kind: 'question',
      text: 'Is a subscription a betrayal of “evidence”?',
      x: 38,
      y: 72,
      w: 22,
      tilt: 0.5,
      cluster: 'c-open',
    },
    {
      id: 'n-second',
      kind: 'question',
      text: 'Who is the second party — landlord, school, or employer?',
      x: 2,
      y: 58,
      w: 25,
      tilt: 1,
    },
    {
      id: 'n-ritual',
      kind: 'seed',
      text: 'Name the thing they already do: screenshot, then send.',
      x: 63,
      y: 62,
      w: 24,
      tilt: 0.9,
    },
    {
      id: 'n-ikea',
      kind: 'evidence',
      text: 'Vindstyrka is €59.90 and it is already in the kitchen.',
      x: 64,
      y: 78,
      w: 25,
      tilt: -1.1,
      meta: 'the page we lose, not View Plus',
    },
  ],
  links: [
    {
      id: 'l1',
      kind: 'supports',
      from: 'n-third',
      to: 'n-conc',
      a: [30.5, 36],
      b: [43, 56],
      bow: 5,
    },
    {
      id: 'l2',
      kind: 'tension',
      from: 'n-nine',
      to: 'n-claim',
      a: [48, 41],
      b: [46.5, 20],
      bow: -12,
    },
    {
      id: 'l3',
      kind: 'derives',
      from: 'n-legal',
      to: 'n-conc',
      a: [58.5, 33],
      b: [58, 55],
      bow: 8,
    },
    {
      id: 'l4',
      kind: 'derives',
      from: 'n-tenant',
      to: 'n-second',
      a: [13.5, 26],
      b: [13, 60],
      bow: -8,
    },
    { id: 'l5', kind: 'derives', from: 'n-conc', to: 'n-rott', a: [64.5, 57], b: [71, 37], bow: 6 },
    {
      id: 'l6',
      kind: 'supports',
      from: 'n-ritual',
      to: 'n-conc',
      a: [66.5, 69],
      b: [59, 62],
      bow: -3,
    },
    { id: 'l7', kind: 'tension', from: 'n-week4', to: 'n-conc', a: [31, 75], b: [45, 63], bow: -6 },
    {
      id: 'l8',
      kind: 'tension',
      from: 'n-ikea',
      to: 'n-sub',
      a: [65.5, 84],
      b: [57.5, 80],
      bow: -3,
    },
  ],
};

const VOICES: InsightBoard = {
  n: 214,
  source:
    'Beta cohort, 4 Nov – 22 Jan. Rotterdam 88, Milan 51, Kraków 44, Porto 31. Coded twice; ' +
    'disagreements resolved against the recording, not the notes.',
  metrics: [
    { value: '4', label: 'cities' },
    { value: '11', label: 'weeks in field' },
    { value: '0.81', label: 'coder agreement' },
  ],
  themes: [
    {
      id: 't-proof',
      label: 'Proof for someone else',
      accent: 'mint',
      count: 71,
      strength: 'strong',
      reading:
        'The largest theme, and it appears in no requirement document we wrote. People buy the ' +
        'monitor to change somebody else’s behaviour, not their own.',
      quotes: [
        {
          text: 'I didn’t buy it for me. I bought it so I had something to put in front of the housing association.',
          who: 'Marieke D.',
          where: 'Rotterdam · tenant, 1930s terrace',
          ref: 'INT-084',
        },
        {
          text: 'The school kept telling me the classroom was fine. Now I bring a number with me.',
          who: 'Paweł R.',
          where: 'Kraków · parent',
          ref: 'INT-131',
        },
        {
          text: 'I screenshot it and drop it in the building group chat. That is the whole ritual, honestly.',
          who: 'Sofia L.',
          where: 'Milan · Isola, shared block',
          ref: 'INT-046',
        },
        {
          text: 'My employer said the meeting room was ventilated. It reads 1,680 by eleven o’clock.',
          who: 'Bart K.',
          where: 'Rotterdam · office tenant',
          ref: 'INT-167',
        },
      ],
    },
    {
      id: 't-number',
      label: 'The number alone means nothing',
      accent: 'cyan',
      count: 58,
      strength: 'holding',
      reading:
        'Everybody learned the thresholds somewhere other than us. Three named a Reddit thread; ' +
        'two named a YouTube video; nobody named the box.',
      quotes: [
        {
          text: '412 is fine and 1,300 is bad, and I learned that from a Reddit comment, not from you.',
          who: 'Tomás A.',
          where: 'Porto · flat, no mechanical vent',
          ref: 'INT-012',
        },
        {
          text: 'I want it to say “open a window”, not “CO₂ 1,412 ppm”. I know what a window is.',
          who: 'Hanne V.',
          where: 'Rotterdam · retired teacher',
          ref: 'INT-159',
        },
        {
          text: 'The PM2.5 one I still do not understand and I have had it eleven weeks.',
          who: 'Giulia P.',
          where: 'Milan',
          ref: 'INT-073',
        },
      ],
    },
    {
      id: 't-week',
      label: 'Bought during one specific bad week',
      accent: 'violet',
      count: 44,
      strength: 'holding',
      reading:
        'Purchase is event-driven — smoke, damp, a newborn, a diagnosis. That makes March timing ' +
        'a weather question as much as a media question.',
      quotes: [
        {
          text: 'Wildfire smoke in June. I ordered two that night, and one for my mother.',
          who: 'Giulia P.',
          where: 'Milan',
          ref: 'INT-073b',
        },
        {
          text: 'Damp patch behind the bedroom wall. The landlord said condensation. I said prove it.',
          who: 'Alan McF.',
          where: 'Glasgow · beta spillover',
          ref: 'INT-118',
        },
      ],
    },
    {
      id: 't-drop',
      label: 'Nobody looks at it after week three',
      accent: 'coral',
      count: 39,
      strength: 'strong',
      reading:
        'The clearest negative signal in the set, and it is not a churn problem — it is a ' +
        'question about what the object is for once the argument is won.',
      quotes: [
        {
          text: 'Week one I checked it eleven times a day. Week five, zero. It is a nice object on a shelf now.',
          who: 'Sofia L.',
          where: 'Milan',
          ref: 'INT-046b',
        },
        {
          text: 'I only look when something smells. Which is exactly when I do not need it to tell me.',
          who: 'Nils B.',
          where: 'Rotterdam',
          ref: 'INT-097',
        },
      ],
    },
  ],
};

const OBJECTIONS: InsightBoard = {
  n: 214,
  source: 'Same cohort, objection pass. Four of these have no answer in any concept yet.',
  metrics: [
    { value: '4', label: 'unanswered' },
    { value: '19 Feb', label: 'legal note' },
  ],
  themes: [
    {
      id: 'o-ikea',
      label: 'Why not the €59 one',
      accent: 'coral',
      count: 27,
      strength: 'strong',
      unanswered: true,
      reading:
        'Nothing in any of the three concepts answers this. A spec argument loses it; only a ' +
        'different job survives it.',
      quotes: [
        {
          text: 'Vindstyrka is sixty euros and it is already in the same room as the meatballs.',
          who: 'Jonas E.',
          where: 'Malmö · beta spillover',
          ref: 'INT-188',
        },
        {
          text: 'Three times the price has to be three times something. I could not tell you what.',
          who: 'Renata C.',
          where: 'Kraków',
          ref: 'INT-176',
        },
      ],
    },
    {
      id: 'o-medical',
      label: 'Is this a medical device',
      accent: 'magenta',
      count: 9,
      strength: 'weak',
      unanswered: true,
      reading:
        'Small count, large consequence. This is the same nine interviews that Concept A is ' +
        'built on, which is the argument against Concept A.',
      quotes: [
        {
          text: 'If it tells me the air is unhealthy, is that a diagnosis? My wife is on oxygen.',
          who: 'Robert K.',
          where: 'Kraków',
          ref: 'INT-140',
        },
      ],
    },
    {
      id: 'o-data',
      label: 'Who else sees my readings',
      accent: 'amber',
      count: 22,
      strength: 'holding',
      unanswered: true,
      reading:
        'Every one of these came up unprompted when the neighbourhood map was described. The map ' +
        'is the feature the evidence frame most wants and privacy least allows.',
      quotes: [
        {
          text: 'If it maps my street I want to be a dot, not an address.',
          who: 'Amélie T.',
          where: 'Porto',
          ref: 'INT-201',
        },
        {
          text: 'My landlord finding my data before I show it to him would be the end of it.',
          who: 'Marieke D.',
          where: 'Rotterdam',
          ref: 'INT-084b',
        },
      ],
    },
    {
      id: 'o-return',
      label: 'The quiet return',
      accent: 'blue',
      count: 6,
      strength: 'weak',
      unanswered: true,
      reading: 'Inferred, not heard. Held at the bottom of the panel until it is earned.',
      quotes: [],
    },
  ],
};

const CONCEPTS: ConceptSet = {
  decidesBy: 'One of these gets the €12,400. Decision closes 6 March, when the Milan buy locks.',
  concepts: [
    {
      id: 'k-vital',
      mark: 'A',
      codename: 'Vital',
      frame: 'health and safety',
      line: 'The smoke alarm for the air you can’t see.',
      evidence:
        'Rests on 9 of 214 interviews. Strongest in Kraków, absent in Porto. The most emotionally ' +
        'direct line we have and the least supported.',
      risk: 'Legal’s 19 Feb note puts any health claim behind an MDR file we cannot open before June.',
      riskLevel: 'high',
      confidence: 0.22,
    },
    {
      id: 'k-instrument',
      mark: 'B',
      codename: 'Instrument',
      frame: 'the quantified home',
      line: 'Your home, finally measured.',
      evidence:
        'Reads well to the 58 who asked what the number means — until they read the same claim on ' +
        'the Vindstyrka box for €59.90.',
      risk: 'Puts us on a spec sheet next to Ikea and Airthings. We do not win that page at €179.',
      riskLevel: 'high',
      confidence: 0.41,
    },
    {
      id: 'k-evidence',
      mark: 'C',
      codename: 'Evidence',
      frame: 'air as something you can hand over',
      line: 'Air you can hand to someone.',
      evidence:
        '71 of 214 already do this without being told to. It is the only concept describing a ' +
        'behaviour the beta cohort invented rather than one we proposed.',
      risk: 'Needs a second party to matter. If the landlord shrugs, we are a shelf object by week four.',
      riskLevel: 'medium',
      confidence: 0.68,
      leading: true,
    },
  ],
};

const STATEMENT: ArtifactDoc = {
  kind: 'Positioning statement',
  version: 'v4',
  producedAt: 'written 11 minutes ago',
  provenance: [
    '214 beta interviews',
    'theme: proof for someone else (71)',
    'Concept C',
    'legal note, 19 Feb',
    'v4',
  ],
  statement: {
    lead: 'For people who need somebody else to act on the air in a room —',
    body:
      'Bellwether is a €179 indoor air monitor that turns what you cannot see into something you ' +
      'can hand over: a dated, sourced, shareable reading that a landlord, a school or an ' +
      'employer has to answer.',
    proof:
      'Because 71 of 214 beta households showed a reading to a third party without ever being ' +
      'asked to.',
    unlike: 'Unlike Vindstyrka and View Plus, which give you the number and stop there.',
  },
  changed:
    'Changed since v3: v3 said “proof”. Legal read “proof” as a claim about health. v4 says “a ' +
    'reading someone has to answer”, which is a claim about the conversation, not the lungs.',
  sequence: [
    {
      day: '2 Mar',
      beat: 'Rotterdam only',
      detail: 'Tenant-union preview, 400 units, no press.',
      locked: true,
    },
    {
      day: '9 Mar',
      beat: 'The receipt ships',
      detail: 'Shareable reading v1. The screenshot becomes the product.',
      locked: false,
    },
    {
      day: '16 Mar',
      beat: 'Milan and Kraków',
      detail: '€8,200 of the buy, evidence framing only, no health language.',
      locked: false,
    },
    {
      day: '6 Apr',
      beat: 'Porto and the map',
      detail: 'Neighbourhood layer, only if week-four retention clears 55%.',
      locked: false,
    },
  ],
  approve: {
    label: 'Approve v4',
    hint: 'Approving fixes the wording for the March brief. Three of the four beats below are waiting on it.',
    unblocks: 'Launch sequencer is blocked on this.',
    approved: 'Approved. Launch sequencer released — it can draw the ninety days now.',
  },
};

/* ------------------------------------------------------------------------ *
 * The context
 * ------------------------------------------------------------------------ */

export const DESIGN: SairiContext = {
  id: 'design',
  kind: 'design',
  hue: 'amber',
  lastActive: 4,
  intention:
    'We ship Bellwether in March. Work out what it actually is, and what the first ninety days say.',
  objective:
    'Find a position for Bellwether that 214 beta interviews actually support, that survives ' +
    'legal’s 19 February note, and that four cities can be sequenced around before the Milan ' +
    'buy closes on 6 March.',
  agents: [
    {
      id: 'a-synth',
      role: 'Insight synthesist',
      task: 'Clustering 214 beta interviews into themes that hold at n ≥ 30',
      status: 'working',
      progress: 0.62,
      hue: 'violet',
      output:
        'Four themes hold. The largest — proof for someone else — appears in no requirement document we wrote.',
      produced: ['p-voices', 'p-objections'],
    },
    {
      id: 'a-writer',
      role: 'Positioning writer',
      task: 'Rewriting the statement around legal’s 19 February note',
      status: 'awaiting-approval',
      progress: 1,
      hue: 'amber',
      output:
        'v4 removes every health claim and keeps the evidence frame. Needs your call before the brief locks.',
      produced: ['p-statement'],
    },
    {
      id: 'a-scan',
      role: 'Market scanner',
      task: 'Watching competitor price and claim moves across the four launch markets',
      status: 'working',
      progress: 0.34,
      hue: 'cyan',
      output:
        'Airthings cut View Plus to €239 on 14 Feb. Vindstyrka is still €59.90 — that is the page we lose.',
      produced: ['p-concepts'],
    },
    {
      id: 'a-board',
      role: 'Board keeper',
      task: 'Holding 15 notes and 4 clusters open — nothing merged yet',
      status: 'idle',
      progress: 0,
      hue: 'blue',
      output: 'One cluster has nothing behind it but instinct. Flagged, not deleted.',
      produced: ['p-board'],
    },
    {
      id: 'a-seq',
      role: 'Launch sequencer',
      task: 'Blocked: cannot draw the ninety days until the claim is fixed',
      status: 'blocked',
      progress: 0,
      hue: 'coral',
      output: 'Three of the four March beats depend on the wording. Holding rather than guessing.',
      produced: [],
    },
  ],
  panels: [
    {
      id: 'p-board',
      title: 'Divergent board — everything March is made of',
      lens: 'canvas',
      certainty: 'provisional',
      span: 12,
      author: 'Board keeper',
      data: BOARD,
    },
    {
      id: 'p-voices',
      title: 'What 214 beta households actually said',
      lens: 'insights',
      certainty: 'forming',
      span: 7,
      author: 'Insight synthesist',
      data: VOICES,
    },
    {
      id: 'p-objections',
      title: 'Objections nothing answers yet',
      lens: 'insights',
      certainty: 'provisional',
      span: 5,
      author: 'Insight synthesist',
      data: OBJECTIONS,
    },
    {
      id: 'p-concepts',
      title: 'Three ways to say what this is',
      lens: 'concepts',
      certainty: 'provisional',
      span: 7,
      author: 'Market scanner',
      data: CONCEPTS,
    },
    {
      id: 'p-statement',
      title: 'Positioning statement, v4',
      lens: 'artifact',
      certainty: 'resolved',
      span: 5,
      author: 'Positioning writer',
      data: STATEMENT,
    },
  ],
  proposal: {
    title: 'Retire Concept A and put the whole €12,400 behind evidence',
    detail:
      'Concept A carries the health claim legal flagged on 19 February, and only 9 of 214 ' +
      'interviews reached for health language unprompted. Folding its two usable notes into ' +
      'Concept C leaves one story to test in Rotterdam on 2 March, while the Milan buy is still open.',
    verb: 'Merge and commit',
  },
};

/**
 * The workspace mounts a lens as a component — `<Lens panel={…} />` — while the
 * registry types it as a plain function of a Panel. Accepting either shape keeps
 * both callers correct, and keeps every hook inside the inner components, where
 * React sees a component under both call styles.
 */
type LensInput = Panel | { panel: Panel };

function panelOf(input: LensInput): Panel {
  return 'panel' in input ? input.panel : input;
}

export const DESIGN_LENSES: Partial<Record<LensKind, (panel: Panel) => JSX.Element>> = {
  canvas: (input) => <CanvasLens board={panelOf(input).data as CanvasBoard} />,
  insights: (input) => <InsightsLens board={panelOf(input).data as InsightBoard} />,
  concepts: (input) => <ConceptsLens set={panelOf(input).data as ConceptSet} />,
  artifact: (input) => <ArtifactLens doc={panelOf(input).data as ArtifactDoc} />,
};
