import { useId, useState, type CSSProperties, type JSX } from 'react';
import {
  ConvergenceMeter,
  Empty,
  Forming,
  GlowDivider,
  Metric,
  StatusOrb,
  Tag,
  hue,
  useCountUp,
} from '../primitives.js';
import {
  CERTAINTY_VALUE,
  type Certainty,
  type LensKind,
  type Panel,
  type SairiContext,
  type Spectral,
} from '../state.js';
import './incident.css';

/**
 * INCIDENT — "checkout payments are failing for some users".
 *
 * A LATE-convergence context. Four agents have already worked the problem: the
 * root cause is confirmed, three rival explanations are eliminated, and the only
 * thing left is a human saying yes to a rollback. So most panels are resolved
 * and narrow, and the one genuinely open question — a 0.31% residual that the
 * root cause does not explain — is the single wide, dim, full-bleed panel.
 *
 * That shape is the argument: you can read this workspace's epistemic state from
 * across the room without reading a word of it.
 */

/* ------------------------------------------------------------------------ *
 * Payloads
 *
 * Each lens declares the shape it renders and checks it at the door. Panel data
 * is `unknown` because a lens has to survive a payload it did not author — the
 * same rule the rest of the system applies to anything a model produced.
 * ------------------------------------------------------------------------ */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogLine {
  t: string;
  level: LogLevel;
  service: string;
  region: string;
  msg: string;
  /** Rendered under the message, dimmer. Present on thrown errors only. */
  frames?: string[];
}

interface LogsData {
  stream: string;
  window: string;
  scanned: string;
  matched: string;
  lines: LogLine[];
}

type NodeState = 'critical' | 'degraded' | 'healthy';

interface HealthNode {
  service: string;
  region: string;
  city: string;
  version: string;
  state: NodeState;
  p50: number;
  p95: number;
  p99: number;
  /** Percent of authorisation attempts that failed, last 60s. */
  errorRate: number;
  /** 0..1, CPU-equivalent headroom used. */
  saturation: number;
  /** Sixteen four-minute buckets of error rate, 13:20 → 14:20 UTC. */
  spark: number[];
  /** Index into `spark` where a new build landed, if one did. */
  deployAt?: number;
  note?: string;
}

interface HealthData {
  headline: { failed: number; errorRate: string; p99: string; regions: string };
  nodes: HealthNode[];
}

type HypothesisState = 'confirmed' | 'testing' | 'eliminated' | 'untested';

interface Hypothesis {
  id: string;
  claim: string;
  state: HypothesisState;
  /** 0..1. What the testing agent currently believes. */
  confidence: number;
  agent: string;
  method: string;
  for: string[];
  against: string[];
}

interface HypothesesData {
  question: string;
  /** Aggregate position on this question, 0..1. Feeds the meter. */
  convergence: number;
  hypotheses: Hypothesis[];
  /** An agent is still writing another explanation into this panel. */
  drafting?: string;
}

interface SeqActor {
  id: string;
  label: string;
  sub: string;
}

interface SeqStep {
  from: string;
  to: string;
  label: string;
  /** Elapsed time since the request entered the edge, for the left gutter. */
  at: string;
  kind: 'call' | 'self' | 'error' | 'never';
  failing?: boolean;
}

interface SequenceData {
  trace: string;
  budget: string;
  caption: string;
  actors: SeqActor[];
  steps: SeqStep[];
}

/**
 * The one field a lens cannot render without. Deliberately not a schema: this is
 * a shape check to keep a bad payload from throwing inside render, not a trust
 * decision — the trust decisions happen at the service boundaries.
 */
function narrow<T>(data: unknown, key: keyof T): T | null {
  const value = data as T | null;
  return value && Array.isArray(value[key]) ? value : null;
}

/* ------------------------------------------------------------------------ *
 * logs — the stream, as an engineer would actually read it
 * ------------------------------------------------------------------------ */

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

type LevelFilter = 'all' | 'warn' | 'error';

const FILTERS: { id: LevelFilter; label: string; floor: number }[] = [
  { id: 'all', label: 'All', floor: 0 },
  { id: 'warn', label: 'Warnings +', floor: 2 },
  { id: 'error', label: 'Errors only', floor: 3 },
];

function LogsLens({ panel }: { panel: Panel }): JSX.Element {
  const [filter, setFilter] = useState<LevelFilter>('all');
  const data = narrow<LogsData>(panel.data, 'lines');

  if (!data) return <Empty>Waiting on the log correlator to attach a stream.</Empty>;

  const floor = FILTERS.find((f) => f.id === filter)?.floor ?? 0;
  const lines = data.lines.filter((l) => LEVEL_RANK[l.level] >= floor);

  return (
    <div className="s-inc-log">
      <div className="s-inc-log__bar">
        <span className="s-inc-log__stream">
          <StatusOrb hue="cyan" pulse label="stream live" size={6} /> {data.stream}
        </span>
        <span className="s-inc-log__window">{data.window}</span>
        <div className="s-inc-log__filters" role="group" aria-label="Filter log lines by level">
          {FILTERS.map((f) => (
            <button
              aria-pressed={filter === f.id}
              className="s-inc-log__btn"
              key={f.id}
              onClick={() => setFilter(f.id)}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Focusable so the stream can be read and scrolled from the keyboard;
          role="log" tells a screen reader this region grows over time. */}
      <div
        aria-label={`${data.stream} log stream, ${lines.length} lines shown`}
        className="s-inc-log__scroll"
        role="log"
        tabIndex={0}
      >
        <ol className="s-inc-log__list">
          {lines.map((line, i) => (
            <li className="s-inc-log__line" data-level={line.level} key={`${line.t}-${i}`}>
              <span className="s-inc-log__t">{line.t}</span>
              <span className="s-inc-log__lvl">{line.level.toUpperCase()}</span>
              <span className="s-inc-log__svc">{line.service}</span>
              <span className="s-inc-log__region">{line.region}</span>
              <span className="s-inc-log__msg">
                {line.msg}
                {line.frames?.map((frame) => (
                  <span className="s-inc-log__frame" key={frame}>
                    {frame}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="s-inc-log__foot">
        {data.scanned} scanned · {data.matched} matching confirms · {lines.length} of{' '}
        {data.lines.length} lines shown
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * health — the fleet, and the version that splits it
 * ------------------------------------------------------------------------ */

const NODE_HUE: Record<NodeState, Spectral> = {
  critical: 'coral',
  degraded: 'amber',
  healthy: 'mint',
};

/**
 * Sparkline geometry. Two units of vertical padding so a peak never sits on the
 * clip edge, where it reads as truncated rather than as a maximum.
 */
function sparkPath(values: number[], w: number, h: number): string {
  const max = Math.max(...values, 0.001);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  return values
    .map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (h - 2 - (v / max) * (h - 4)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

function Sparkline({ node }: { node: HealthNode }): JSX.Element {
  const w = 96;
  const h = 26;
  const line = sparkPath(node.spark, w, h);
  const last = node.spark[node.spark.length - 1] ?? 0;
  const first = node.spark[0] ?? 0;
  const deployX =
    node.deployAt === undefined ? null : (node.deployAt / (node.spark.length - 1)) * w;

  return (
    <svg
      aria-label={`Error rate for ${node.service} in ${node.region}: ${first}% an hour ago, ${last}% now${
        node.deployAt === undefined ? '' : `, with ${node.version} deployed mid-window`
      }`}
      className="s-inc-health__spark"
      role="img"
      style={{ '--accent': hue(NODE_HUE[node.state]) } as CSSProperties}
      viewBox={`0 0 ${w} ${h}`}
    >
      <path className="s-inc-health__sparkarea" d={`${line} L${w} ${h} L0 ${h} Z`} />
      <path className="s-inc-health__sparkline" d={line} />
      {deployX !== null && (
        <g className="s-inc-health__deploy">
          <line x1={deployX} x2={deployX} y1={0} y2={h} />
          <circle cx={deployX} cy={3} r={2.2} />
        </g>
      )}
    </svg>
  );
}

function HealthLens({ panel }: { panel: Panel }): JSX.Element {
  const data = narrow<HealthData>(panel.data, 'nodes');
  // Hooks run before the guard returns: a lens must not change its hook count
  // between renders, and the panel can arrive before its payload does.
  const failed = useCountUp(data?.headline.failed ?? 0, 900);

  if (!data) return <Empty>Waiting on the fleet observer to attach regional telemetry.</Empty>;

  return (
    <div className="s-inc-health">
      <div className="s-inc-health__summary">
        <Metric
          accent="coral"
          label="failed confirms since 13:47"
          trend="up"
          value={Math.round(failed).toLocaleString('en-US')}
        />
        <Metric
          accent="coral"
          label="auth error rate · eu-west-1"
          trend="up"
          value={data.headline.errorRate}
        />
        <Metric accent="amber" label="p99 confirm latency" trend="up" value={data.headline.p99} />
        <Metric
          accent="violet"
          label="regions on v2.31.0"
          trend="flat"
          value={data.headline.regions}
        />
      </div>

      <GlowDivider accent="coral" />

      <ul className="s-inc-health__fleet">
        {data.nodes.map((node) => (
          <li
            className="s-inc-health__row"
            data-state={node.state}
            key={`${node.service}-${node.region}`}
          >
            <div className="s-inc-health__id">
              <StatusOrb
                hue={NODE_HUE[node.state]}
                label={`${node.service} is ${node.state}`}
                pulse={node.state !== 'healthy'}
                size={7}
              />
              <span className="s-inc-health__name">{node.service}</span>
              <span className="s-inc-health__where">
                {node.region} · {node.city}
              </span>
              <Tag accent={node.version === 'v2.31.0' ? 'coral' : 'blue'}>{node.version}</Tag>
            </div>

            <Sparkline node={node} />

            <dl className="s-inc-health__nums">
              <div>
                <dt>p50</dt>
                <dd>{node.p50} ms</dd>
              </div>
              <div>
                <dt>p95</dt>
                <dd>{node.p95.toLocaleString('en-US')} ms</dd>
              </div>
              <div>
                <dt>p99</dt>
                <dd className="s-inc-health__hot">{node.p99.toLocaleString('en-US')} ms</dd>
              </div>
              <div>
                <dt>err</dt>
                <dd className="s-inc-health__hot">{node.errorRate.toFixed(2)}%</dd>
              </div>
            </dl>

            <div className="s-inc-health__sat">
              <span className="s-inc-health__satlabel">
                sat {Math.round(node.saturation * 100)}%
              </span>
              <span aria-hidden="true" className="s-inc-health__sattrack">
                <span
                  className="s-inc-health__satfill"
                  style={{ width: `${node.saturation * 100}%` } as CSSProperties}
                />
              </span>
            </div>

            {node.note && <p className="s-inc-health__note">{node.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * hypotheses — the signature lens of this context
 *
 * Competing explanations, each carrying its own certainty. The cards obey the
 * same shape rule as the panels that hold them: an eliminated hypothesis is
 * wide, flat and dim; the confirmed root cause is inset, raised and warm.
 * ------------------------------------------------------------------------ */

const HYP_CERTAINTY: Record<HypothesisState, Certainty> = {
  confirmed: 'resolved',
  testing: 'forming',
  eliminated: 'provisional',
  untested: 'provisional',
};

const HYP_TONE: Record<HypothesisState, Spectral> = {
  confirmed: 'mint',
  testing: 'cyan',
  eliminated: 'magenta',
  untested: 'violet',
};

const HYP_LABEL: Record<HypothesisState, string> = {
  confirmed: 'root cause',
  testing: 'under test',
  eliminated: 'eliminated',
  untested: 'untested',
};

function HypothesisCard({ h }: { h: Hypothesis }): JSX.Element {
  const certainty = HYP_CERTAINTY[h.state];
  const tone = HYP_TONE[h.state];

  /*
   * --certainty is set here and re-derived locally in CSS rather than inherited.
   * The --c-* tokens in tokens.css resolve their var() references at .sairi and
   * are inherited as fixed strings, so a nested surface that wants the same
   * convergence shape has to compute it from the raw number itself.
   */
  const style = {
    '--certainty': CERTAINTY_VALUE[certainty],
    '--accent': hue(tone),
  } as CSSProperties;

  return (
    <li className="s-inc-hyp__card" data-state={h.state} style={style}>
      <div className="s-inc-hyp__head">
        <Tag accent={tone} solid={h.state === 'confirmed'}>
          {HYP_LABEL[h.state]}
        </Tag>
        <span className="s-inc-hyp__conf">
          <span className="s-inc-hyp__confnum">{Math.round(h.confidence * 100)}%</span>
          <span
            aria-hidden="true"
            className="s-inc-hyp__confbar"
            style={{ '--v': h.confidence } as CSSProperties}
          />
        </span>
      </div>

      <p className="s-inc-hyp__claim">{h.claim}</p>

      <div className="s-inc-hyp__ev">
        <div className="s-inc-hyp__for">
          <h4>Supports</h4>
          <ul>
            {h.for.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        <div className="s-inc-hyp__against">
          <h4>Contradicts</h4>
          <ul>
            {h.against.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="s-inc-hyp__method">
        <StatusOrb hue={tone} size={5} /> {h.agent} — {h.method}
      </p>
    </li>
  );
}

function HypothesesLens({ panel }: { panel: Panel }): JSX.Element {
  const data = narrow<HypothesesData>(panel.data, 'hypotheses');

  if (!data) return <Empty>No competing explanations have been proposed yet.</Empty>;

  return (
    <div className="s-inc-hyp">
      <div className="s-inc-hyp__q">
        <p className="s-inc-hyp__question">{data.question}</p>
        <ConvergenceMeter accent="coral" value={data.convergence} />
      </div>

      <ul className="s-inc-hyp__list">
        {data.hypotheses.map((h) => (
          <HypothesisCard h={h} key={h.id} />
        ))}
      </ul>

      {data.drafting && (
        <div className="s-inc-hyp__draft">
          <p className="s-inc-hyp__drafting">{data.drafting}</p>
          <Forming rows={2} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * sequence — the failing request, drawn
 *
 * Hand-built SVG. Lanes across the top, a time gutter down the left, and a
 * coral band behind the hop where the request actually dies.
 * ------------------------------------------------------------------------ */

const SEQ_W = 800;
const SEQ_LANE_0 = 132;
const SEQ_LANE_GAP = 148;
const SEQ_START_Y = 76;
const SEQ_GAP_Y = 34;

function SequenceLens({ panel }: { panel: Panel }): JSX.Element {
  const uid = useId();
  const data = narrow<SequenceData>(panel.data, 'steps');

  if (!data) return <Empty>Waiting on the trace reader to reconstruct a failing path.</Empty>;

  const laneX = (id: string): number => {
    const i = data.actors.findIndex((a) => a.id === id);
    return SEQ_LANE_0 + Math.max(0, i) * SEQ_LANE_GAP;
  };

  const rows = data.steps.map((step, i) => ({ step, y: SEQ_START_Y + i * SEQ_GAP_Y }));
  const failing = rows.filter((r) => r.step.failing);
  const bottom = SEQ_START_Y + data.steps.length * SEQ_GAP_Y;
  const height = bottom + 12;
  const bandTop = failing.length > 0 ? (failing[0]?.y ?? 0) - 15 : 0;
  const bandBottom = failing.length > 0 ? (failing[failing.length - 1]?.y ?? 0) + 13 : 0;

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  return (
    <div className="s-inc-seq">
      <div className="s-inc-seq__meta">
        <Tag accent="coral">trace {data.trace}</Tag>
        <span className="s-inc-seq__budget">budget {data.budget}</span>
      </div>

      <svg
        aria-labelledby={`${titleId} ${descId}`}
        className="s-inc-seq__svg"
        role="img"
        viewBox={`0 0 ${SEQ_W} ${height}`}
      >
        <title id={titleId}>Failing checkout confirmation across five services</title>
        <desc id={descId}>
          {data.steps
            .map(
              (s) =>
                `${s.at}: ${s.from} to ${s.to} — ${s.label}${s.failing ? ' (failing hop)' : ''}`,
            )
            .join('. ')}
        </desc>

        <defs>
          <marker
            id={`${uid}-arrow`}
            markerHeight="6"
            markerWidth="7"
            orient="auto"
            refX="6"
            refY="3"
          >
            <path className="s-inc-seq__head" d="M0 0 L7 3 L0 6 Z" />
          </marker>
          <marker
            id={`${uid}-arrow-bad`}
            markerHeight="6"
            markerWidth="7"
            orient="auto"
            refX="6"
            refY="3"
          >
            <path className="s-inc-seq__head s-inc-seq__head--bad" d="M0 0 L7 3 L0 6 Z" />
          </marker>
        </defs>

        {failing.length > 0 && (
          <rect
            className="s-inc-seq__band"
            height={bandBottom - bandTop}
            rx="6"
            width={SEQ_W - 84}
            x="72"
            y={bandTop}
          />
        )}

        {data.actors.map((actor) => {
          const x = laneX(actor.id);
          return (
            <g key={actor.id}>
              <rect className="s-inc-seq__lane" height="38" rx="7" width="132" x={x - 66} y="6" />
              <text className="s-inc-seq__lanename" textAnchor="middle" x={x} y="22">
                {actor.label}
              </text>
              <text className="s-inc-seq__lanesub" textAnchor="middle" x={x} y="34">
                {actor.sub}
              </text>
              <line className="s-inc-seq__life" x1={x} x2={x} y1="48" y2={bottom} />
            </g>
          );
        })}

        {rows.map(({ step, y }, i) => {
          const from = laneX(step.from);
          const to = laneX(step.to);
          const bad = step.kind === 'error' || step.failing === true;
          const marker = `url(#${uid}-${bad ? 'arrow-bad' : 'arrow'})`;

          if (step.kind === 'self') {
            return (
              <g className="s-inc-seq__step" data-kind="self" key={i}>
                <text className="s-inc-seq__at" x="8" y={y + 3}>
                  {step.at}
                </text>
                <path
                  className="s-inc-seq__arrow"
                  d={`M${from} ${y - 5} h30 v12 h-24`}
                  markerEnd={marker}
                />
                <text className="s-inc-seq__label" x={from + 38} y={y - 8}>
                  {step.label}
                </text>
              </g>
            );
          }

          const dir = to > from ? 1 : -1;
          const x2 = to - 8 * dir;
          return (
            <g
              className="s-inc-seq__step"
              data-bad={bad ? 'true' : undefined}
              data-kind={step.kind}
              key={i}
            >
              <text className="s-inc-seq__at" x="8" y={y + 3}>
                {step.at}
              </text>
              <line
                className="s-inc-seq__arrow"
                markerEnd={marker}
                x1={from}
                x2={x2}
                y1={y}
                y2={y}
              />
              <text className="s-inc-seq__label" textAnchor="middle" x={(from + x2) / 2} y={y - 7}>
                {step.label}
              </text>
              {step.kind === 'never' && (
                <text
                  className="s-inc-seq__cross"
                  textAnchor="middle"
                  x={(from + x2) / 2}
                  y={y + 4}
                >
                  ✕
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="s-inc-seq__caption">{data.caption}</p>

      <ul className="s-inc-seq__legend">
        <li data-swatch="bad">failing hop</li>
        <li data-swatch="never">never reached</li>
        <li data-swatch="ok">completed call</li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------------ */

const LOGS: LogsData = {
  stream: 'payments-gateway · eu-west-1',
  window: '13:46:58 → 14:02:16 UTC',
  scanned: '41.2M lines',
  matched: '4,218',
  lines: [
    {
      t: '13:46:58.402',
      level: 'info',
      service: 'checkout-api',
      region: 'eu-west-1',
      msg: 'confirm start cart=cart_7c41e0 amount=8490 currency=EUR trace=4f9c2a17',
    },
    {
      t: '13:46:58.433',
      level: 'info',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'authorize accepted route=adyen-eu build=v2.31.0 pool=warm',
    },
    {
      t: '13:46:58.435',
      level: 'debug',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'idempotency key derived key=ik_8c4b1a20e5f7 len=12 source=customer_id+amount_minor',
    },
    {
      t: '13:46:59.639',
      level: 'warn',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'acquirer refused idempotent replay key=ik_8c4b1a20e5f7 psp_ref=8H2K9QT4RJ2N7X01',
    },
    {
      t: '13:46:59.641',
      level: 'error',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'AcquirerError: 409 idempotency_key_in_use — key ik_8c4b1a20e5f7 already bound to psp_ref 8H2K9QT4RJ2N7X01 (cart_3b90d2, EUR 84.90)',
      frames: [
        'at IdempotencyStore.claim (/srv/payments-gateway/dist/idempotency/store.js:214:11)',
        'at async AdyenClient.authorize (/srv/payments-gateway/dist/acquirers/adyen.js:96:20)',
        'at async AuthorizeHandler.run (/srv/payments-gateway/dist/handlers/authorize.js:88:24)',
      ],
    },
    {
      t: '13:46:59.644',
      level: 'info',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'retry 1/3 scheduled backoff=200ms key unchanged policy=acquirer_5xx_or_409',
    },
    {
      t: '13:47:01.093',
      level: 'warn',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'retry 2/3 → 409 idempotency_key_in_use elapsed=2652ms',
    },
    {
      t: '13:47:03.271',
      level: 'warn',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'retry 3/3 → 409 idempotency_key_in_use elapsed=4830ms',
    },
    {
      t: '13:47:06.435',
      level: 'error',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'authorize budget exhausted elapsed=8002ms budget=8000ms — returning 504',
    },
    {
      t: '13:47:06.437',
      level: 'error',
      service: 'checkout-api',
      region: 'eu-west-1',
      msg: 'UpstreamTimeout: payments-gateway did not respond within 8000ms (POST /internal/authorize, trace=4f9c2a17)',
      frames: [
        'at CircuitBreaker.call (/srv/checkout-api/dist/net/breaker.js:141:15)',
        'at async ConfirmController.confirm (/srv/checkout-api/dist/routes/confirm.js:73:9)',
      ],
    },
    {
      t: '13:47:06.474',
      level: 'error',
      service: 'checkout-api',
      region: 'eu-west-1',
      msg: 'confirm failed cart=cart_7c41e0 → 502 payment_unavailable shown_to_user=true',
    },
    {
      t: '13:47:06.475',
      level: 'debug',
      service: 'ledger-svc',
      region: 'eu-west-1',
      msg: 'no authorisation record for cart_7c41e0 — nothing to reconcile',
    },
    {
      t: '13:47:11.208',
      level: 'warn',
      service: 'payments-gateway',
      region: 'eu-west-1',
      msg: 'collision rate 4.21% over 60s window (threshold 0.50%) — 218 keys with ≥2 claimants',
    },
    {
      t: '13:52:40.017',
      level: 'error',
      service: 'payments-gateway',
      region: 'ap-southeast-1',
      msg: 'AcquirerError: 409 idempotency_key_in_use — first occurrence in region, build=v2.31.0',
    },
    {
      t: '14:02:16.930',
      level: 'fatal',
      service: 'pagerduty',
      region: 'global',
      msg: 'SEV-2 declared: checkout authorisation failure 4.2% for 15m — owner @payments-oncall',
    },
  ],
};

const HEALTH: HealthData = {
  headline: { failed: 4218, errorRate: '4.21%', p99: '8,002 ms', regions: '2 of 6' },
  nodes: [
    {
      service: 'payments-gateway',
      region: 'eu-west-1',
      city: 'Dublin',
      version: 'v2.31.0',
      state: 'critical',
      p50: 84,
      p95: 6210,
      p99: 8002,
      errorRate: 4.21,
      saturation: 0.71,
      spark: [0.08, 0.07, 0.09, 0.06, 0.08, 0.11, 1.9, 3.2, 3.8, 4.0, 4.1, 4.4, 4.2, 4.3, 4.2, 4.2],
      deployAt: 5,
      note: 'v2.31.0 landed 13:41; first collision 13:46:59, six minutes later.',
    },
    {
      service: 'checkout-api',
      region: 'eu-west-1',
      city: 'Dublin',
      version: 'v8.4.2',
      state: 'degraded',
      p50: 46,
      p95: 1180,
      p99: 8140,
      errorRate: 3.94,
      saturation: 0.58,
      spark: [0.05, 0.06, 0.05, 0.07, 0.06, 0.08, 1.6, 2.9, 3.5, 3.7, 3.8, 4.0, 3.9, 3.9, 3.9, 3.9],
      note: 'Unchanged build. Inherits the failure through its 8,000 ms upstream budget.',
    },
    {
      service: 'payments-gateway',
      region: 'ap-southeast-1',
      city: 'Singapore',
      version: 'v2.31.0',
      state: 'degraded',
      p50: 91,
      p95: 2340,
      p99: 7890,
      errorRate: 3.81,
      saturation: 0.49,
      spark: [
        0.09, 0.1, 0.08, 0.09, 0.11, 0.09, 0.1, 0.08, 0.09, 0.1, 0.09, 0.11, 0.1, 0.9, 2.7, 3.8,
      ],
      deployAt: 13,
      note: 'Second wave: same build, rolled 14:12, same curve 25 minutes behind Dublin.',
    },
    {
      service: 'payments-gateway',
      region: 'us-east-1',
      city: 'Ashburn',
      version: 'v2.30.4',
      state: 'healthy',
      p50: 79,
      p95: 214,
      p99: 402,
      errorRate: 0.11,
      saturation: 0.44,
      spark: [
        0.12, 0.1, 0.11, 0.09, 0.12, 0.1, 0.11, 0.13, 0.1, 0.11, 0.12, 0.1, 0.11, 0.12, 0.11, 0.11,
      ],
      note: 'Held back by the canary gate. The control case for every hypothesis below.',
    },
    {
      service: 'ledger-svc',
      region: 'eu-west-1',
      city: 'Dublin',
      version: 'v3.9.1',
      state: 'healthy',
      p50: 9,
      p95: 27,
      p99: 44,
      errorRate: 0.0,
      saturation: 0.17,
      spark: [0.01, 0.0, 0.01, 0.0, 0.0, 0.01, 0.0, 0.0, 0.01, 0.0, 0.0, 0.0, 0.01, 0.0, 0.0, 0.0],
      note: 'Healthy but starved: authorisation writes down 38%. The money never gets this far.',
    },
  ],
};

const ROOT_CAUSE: HypothesesData = {
  question: 'Why did 4.2% of card authorisations start failing at 13:47 UTC?',
  convergence: 0.92,
  hypotheses: [
    {
      id: 'h-idem',
      claim:
        'payments-gateway v2.31.0 derives the idempotency key from customer_id + amount_minor and truncates it to 12 hex characters. Two confirms from the same shopper at the same price now collide, and the acquirer refuses the second with 409.',
      state: 'confirmed',
      confidence: 0.96,
      agent: 'Hypothesis tester',
      method: '500 captured confirms replayed against v2.30.4 and v2.31.0',
      for: [
        '61 of 500 replays collide on v2.31.0; 0 of 500 on v2.30.4',
        'Every failing key is 12 characters; healthy-region keys are 44',
        'Only eu-west-1 and ap-southeast-1 run v2.31.0, and only they fail',
        'adyen-eu returns 409 idempotency_key_in_use on 96.4% of failures',
      ],
      against: ['0.31% of failures carry a full-length key and are not explained by this'],
    },
    {
      id: 'h-retry',
      claim:
        'The retry policy amplifies the collision: three automatic retries reuse the identical key, so a 409 that should surface in 1.2 s becomes a 504 at the 8,000 ms budget and the shopper sees a generic failure.',
      state: 'testing',
      confidence: 0.44,
      agent: 'Trace reader',
      method: 'replaying the same traffic in staging with acquirer retries disabled',
      for: [
        'Median failed confirm makes 3.0 acquirer calls',
        'Every 504 lands at 8,002 ms ± 6 ms — the budget, not the acquirer',
      ],
      against: [
        'Disabling retries in staging still leaves the first 409',
        'Contributing, not causal',
      ],
    },
    {
      id: 'h-acquirer',
      claim: 'The Adyen eu-west acquirer is degraded and refusing traffic.',
      state: 'eliminated',
      confidence: 0.04,
      agent: 'Fleet observer',
      method: 'cross-region comparison against the acquirer status feed',
      for: ['Every failure terminates at the adyen-eu hop'],
      against: [
        'Acquirer status green for the whole window, no advisory raised',
        'The same acquirer serves us-east-1 at 0.11% error',
        '409 is a well-formed refusal, not a timeout or a 5xx',
      ],
    },
    {
      id: 'h-pool',
      claim: 'Connection-pool exhaustion in payments-gateway after the 14:02 traffic spike.',
      state: 'eliminated',
      confidence: 0.02,
      agent: 'Log correlator',
      method: 'pool wait metrics correlated against failure onset',
      for: ['Saturation did reach 0.71 at 14:04'],
      against: [
        'Failures began 13:47, fifteen minutes before the spike',
        'Pool wait p99 held at 3 ms throughout',
        'us-east-1 absorbed the same spike with no failures',
      ],
    },
  ],
};

const RESIDUAL: HypothesesData = {
  question:
    'Still open: 13 of the 4,218 failures carry a full-length 44-character key, so the truncation cannot explain them. Nothing here has been tested yet.',
  convergence: 0.21,
  drafting:
    'Log correlator is drafting a fourth explanation from the guest-checkout session table.',
  hypotheses: [
    {
      id: 'h-guest',
      claim:
        'Guest checkout reuses one shared anonymous customer id per storefront, so two different shoppers at the same price can collide even on the old key derivation.',
      state: 'untested',
      confidence: 0.28,
      agent: 'Log correlator',
      method: 'not yet started — needs the guest session table joined to failed carts',
      for: ['11 of the 13 are guest checkouts', 'All 13 sit in the €79–€99 band'],
      against: ['This failure mode would predate 13:47, and no such failures appear before it'],
    },
    {
      id: 'h-cdn',
      claim:
        'A stale checkout-web bundle still sends the pre-June client-supplied Idempotency-Key header, which the gateway trusts ahead of its own derivation.',
      state: 'untested',
      confidence: 0.21,
      agent: 'Trace reader',
      method: 'not yet started — needs edge cache age sampled per failing request',
      for: ['2 of the 13 carry a client-supplied header', 'Edge cache TTL is 7 days'],
      against: ['checkout-web has not shipped a bundle since 06-11'],
    },
    {
      id: 'h-ledger',
      claim:
        'A separate failure mode entirely: ledger-svc write contention on carts held open by the 13:31 reconciliation batch.',
      state: 'untested',
      confidence: 0.14,
      agent: 'Fleet observer',
      method: 'not yet started — needs the batch job window against the failing cart ids',
      for: ['The 13:31 batch overlaps the window'],
      against: [
        'ledger-svc reports 0.00% errors and p99 of 44 ms',
        'No authorisation ever reached it',
      ],
    },
  ],
};

const SEQUENCE: SequenceData = {
  trace: '4f9c2a17',
  budget: '8,000 ms',
  caption:
    'The request dies at payments-gateway → adyen-eu. The acquirer refuses the reused idempotency key with 409, three retries present the same key again, and the 8,000 ms budget expires before any authorisation is recorded — so the shopper is charged nothing and told nothing useful.',
  actors: [
    { id: 'web', label: 'checkout-web', sub: 'browser' },
    { id: 'api', label: 'checkout-api', sub: 'eu-west-1' },
    { id: 'gw', label: 'payments-gateway', sub: 'v2.31.0' },
    { id: 'acq', label: 'adyen-eu', sub: 'acquirer' },
    { id: 'ledger', label: 'ledger-svc', sub: 'eu-west-1' },
  ],
  steps: [
    { from: 'web', to: 'api', label: 'POST /v1/checkout/confirm', at: '0 ms', kind: 'call' },
    {
      from: 'api',
      to: 'gw',
      label: 'authorize · cart_7c41e0 · EUR 84.90',
      at: '12 ms',
      kind: 'call',
    },
    {
      from: 'gw',
      to: 'gw',
      label: 'derive key → ik_8c4b1a20e5f7 (12 hex)',
      at: '43 ms',
      kind: 'self',
    },
    {
      from: 'gw',
      to: 'acq',
      label: 'POST /payments · idem ik_8c4b1a20e5f7',
      at: '45 ms',
      kind: 'call',
      failing: true,
    },
    {
      from: 'acq',
      to: 'gw',
      label: '409 idempotency_key_in_use',
      at: '1,249 ms',
      kind: 'error',
      failing: true,
    },
    { from: 'gw', to: 'acq', label: 'retry 2 and 3 · same key', at: '1,251 ms', kind: 'call' },
    { from: 'acq', to: 'gw', label: '409 × 2', at: '4,878 ms', kind: 'error' },
    {
      from: 'gw',
      to: 'api',
      label: '504 upstream_timeout · budget spent',
      at: '8,002 ms',
      kind: 'error',
    },
    {
      from: 'api',
      to: 'ledger',
      label: 'authorisation write — never issued',
      at: '—',
      kind: 'never',
    },
    { from: 'api', to: 'web', label: '502 payment_unavailable', at: '8,041 ms', kind: 'error' },
  ],
};

/* ------------------------------------------------------------------------ *
 * The context
 * ------------------------------------------------------------------------ */

export const INCIDENT: SairiContext = {
  id: 'incident',
  intention: 'checkout payments are failing for some users',
  objective:
    'Find why 4.2% of card authorisations began failing at 13:47 UTC, and put a reversible fix in front of a human.',
  kind: 'incident',
  hue: 'coral',
  agents: [
    {
      id: 'agent-correlator',
      role: 'Log correlator',
      task: 'Joining 41.2M gateway lines to the 4,218 failed carts',
      status: 'working',
      progress: 0.72,
      hue: 'cyan',
      output: '96.4% of failures carry a 12-character idempotency key. 13 do not.',
      produced: ['inc-logs', 'inc-open'],
    },
    {
      id: 'agent-fleet',
      role: 'Fleet observer',
      task: 'Watching p99 and error rate across six regions',
      status: 'working',
      progress: 0.41,
      hue: 'blue',
      output: 'Dublin and Singapore diverge from Ashburn by 3.8 points. Both run v2.31.0.',
      produced: ['inc-health'],
    },
    {
      id: 'agent-tester',
      role: 'Hypothesis tester',
      task: 'Replaying 500 captured confirms against v2.30.4 and v2.31.0',
      status: 'done',
      progress: 1,
      hue: 'violet',
      output: 'Collision reproduces 61 times in 500 on v2.31.0, and 0 times on v2.30.4.',
      produced: ['inc-hyp'],
    },
    {
      id: 'agent-trace',
      role: 'Trace reader',
      task: 'Reconstructing the failing path from 1,862 traces',
      status: 'done',
      progress: 1,
      hue: 'mint',
      output: 'Every failure ends at payments-gateway → adyen-eu, then burns the 8,000 ms budget.',
      produced: ['inc-seq'],
    },
    {
      id: 'agent-remedy',
      role: 'Remediation drafter',
      task: 'Holding a rollback of payments-gateway v2.31.0 in two regions',
      status: 'awaiting-approval',
      progress: 0.94,
      hue: 'amber',
      output:
        'PR #4471 restores the cart-scoped key. Blast radius: 11 pods, 2 regions, no schema change.',
      produced: [],
    },
  ],
  panels: [
    {
      id: 'inc-hyp',
      title: 'Competing explanations',
      lens: 'hypotheses',
      certainty: 'resolved',
      span: 7,
      author: 'Hypothesis tester',
      data: ROOT_CAUSE,
    },
    {
      id: 'inc-health',
      title: 'Fleet health · last 60 minutes',
      lens: 'health',
      certainty: 'resolved',
      span: 5,
      author: 'Fleet observer',
      data: HEALTH,
    },
    {
      id: 'inc-seq',
      title: 'Failing request path',
      lens: 'sequence',
      certainty: 'resolved',
      span: 7,
      author: 'Trace reader',
      data: SEQUENCE,
    },
    {
      id: 'inc-logs',
      title: 'Log stream',
      lens: 'logs',
      certainty: 'forming',
      span: 5,
      author: 'Log correlator',
      data: LOGS,
    },
    {
      id: 'inc-open',
      title: 'The 13 failures the root cause does not explain',
      lens: 'hypotheses',
      certainty: 'provisional',
      span: 12,
      author: 'Log correlator',
      data: RESIDUAL,
    },
  ],
  proposal: {
    title: 'Roll payments-gateway back to v2.30.4 in eu-west-1 and ap-southeast-1',
    detail:
      'Restores the cart-scoped idempotency key on 11 pods. About four minutes to full drain; roughly 180 in-flight confirms will be retried by the client. us-east-1 is already on v2.30.4 and is not touched. Reversible: the v2.31.0 image stays in the registry.',
    verb: 'Approve rollback',
  },
  lastActive: 1,
};

/**
 * The registry type says a lens is called with a Panel, but the shell renders
 * it as a React component, which means it arrives as a props object instead.
 * Accepting both costs one line and removes a class of bug that only shows up
 * as a silently empty panel.
 */
type LensArg = Panel | { panel: Panel };

function panelOf(arg: LensArg): Panel {
  return 'panel' in arg ? arg.panel : arg;
}

export const INCIDENT_LENSES: Partial<Record<LensKind, (panel: Panel) => JSX.Element>> = {
  // Each lens hands off to a real component rather than inlining its body here,
  // so the hooks inside belong to that component. The shell is then free to
  // mount and unmount panels during assembly without disturbing hook order.
  logs: (arg: LensArg) => <LogsLens panel={panelOf(arg)} />,
  health: (arg: LensArg) => <HealthLens panel={panelOf(arg)} />,
  hypotheses: (arg: LensArg) => <HypothesesLens panel={panelOf(arg)} />,
  sequence: (arg: LensArg) => <SequenceLens panel={panelOf(arg)} />,
};
