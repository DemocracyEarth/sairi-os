import type { CSSProperties, JSX } from 'react';
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
import type { LensKind, Panel, SairiContext, Spectral } from '../state.js';
import './travel.css';

/**
 * TRAVEL — a thirteen-night route through Japan, mid-convergence.
 *
 * The convergence journey this context is built to show: the immovable facts
 * (award seats, ¥820,000, open-jaw HND→KIX) are RESOLVED and therefore narrow —
 * four columns, dense type, nothing decorative. The route and the money are
 * FORMING at eight. The two things nobody has decided — whether Kanazawa
 * survives the budget, and what happens after 14 April — are PROVISIONAL and
 * take the full twelve, because an open question needs room to hold its
 * alternatives side by side.
 *
 * Spans go 4 / 8 / 12 across the three certainties on purpose. It is the
 * plainest possible statement of the idea: the answer is small, the question is
 * large.
 *
 * All payloads below are literals authored in this file. They never leave it and
 * nothing untrusted enters it, which is why the lenses narrow `panel.data` with
 * a cast rather than a validator — the moment any of this arrives from a model
 * or the network that stops being true and it must go through a schema first.
 */

/* ------------------------------------------------------------------ *
 * Payload shapes. Each lens owns one and narrows to it.
 * ------------------------------------------------------------------ */

/** Where a single committable thing sits: paid for, on hold, or still an idea. */
type Commitment = 'booked' | 'held' | 'proposed' | 'alternative';

const COMMITMENT_HUE: Record<Commitment, Spectral> = {
  booked: 'mint',
  held: 'amber',
  proposed: 'cyan',
  alternative: 'violet',
};

const COMMITMENT_LABEL: Record<Commitment, string> = {
  booked: 'booked',
  held: 'on hold',
  proposed: 'proposed',
  alternative: 'alternative',
};

interface MapCity {
  id: string;
  name: string;
  jp: string;
  /** Map-space coordinates, hand-placed against a real lat/lon projection. */
  x: number;
  y: number;
  nights: string;
  state: 'confirmed' | 'contested' | 'alternative';
  /** Which side the label hangs off, chosen so no label crosses a route line. */
  side: 'left' | 'right';
}

interface MapLeg {
  id: string;
  route: string;
  service: string;
  duration: string;
  fare: string;
  commitment: Commitment;
  /** Quadratic arc between the two city marks. Bowed so legs never overlap. */
  path: string;
}

interface MapData {
  outline: string;
  cities: MapCity[];
  legs: MapLeg[];
  reasoning: string;
}

interface DayBlock {
  time: string;
  what: string;
  note?: string;
}

interface Day {
  n: number;
  date: string;
  city: string;
  commitment: Commitment;
  transit?: string;
  lodging?: string;
  blocks: DayBlock[];
}

interface Branch {
  id: string;
  label: string;
  city: string;
  confidence: number;
  cost: string;
  argument: string;
  against: string;
  days: Day[];
}

type ItineraryData =
  | { mode: 'linear'; days: Day[]; footnote: string }
  | { mode: 'branched'; question: string; branches: Branch[]; footnote: string };

type ChipState = 'locked' | 'satisfied' | 'tension' | 'open' | 'evaluating';

interface Chip {
  id: string;
  label: string;
  value: string;
  state: ChipState;
  note: string;
}

interface Tension {
  id: string;
  left: string;
  right: string;
  why: string;
  cost: string;
}

interface ConstraintsData {
  chips: Chip[];
  tensions?: Tension[];
  footnote: string;
}

interface LedgerLine {
  id: string;
  label: string;
  accent: Spectral;
  committed: number;
  projected: number;
  note: string;
}

interface LedgerData {
  budget: number;
  lines: LedgerLine[];
  counterfactual: { label: string; delta: number; result: number; detail: string };
  footnote: string;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/**
 * Hand-rolled rather than `toLocaleString`: the shell must render identically on
 * a machine with a trimmed ICU build, and a keynote should not depend on which
 * locale data happens to be compiled in.
 */
function yen(n: number): string {
  return `¥${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function accent(h: Spectral): CSSProperties {
  return { '--accent': hue(h) } as CSSProperties;
}

/**
 * The lens map is typed `(panel: Panel) => JSX.Element`, but the shell renders
 * each entry as a React component — `<Lens panel={panel} />` — so at runtime the
 * first argument arrives as a props object wrapping the panel. Both call shapes
 * are legitimate readings of the contract, and a lens that only survives one of
 * them renders an empty card in the other. So normalise once, here, rather than
 * betting on which side changes.
 */
function panelOf(input: Panel): Panel {
  const wrapped = input as Panel & { panel?: Panel };
  return wrapped.panel ?? input;
}

/* ------------------------------------------------------------------ *
 * MAP — an abstract Honshū, drawn once by hand
 *
 * Not a tile map and not trying to be. Every mark is placed by the same linear
 * projection of real coordinates — x = 38 + (lon − 131.5) × 33.7, y = 40 +
 * (37.2 − lat) × 41 — with the two scales chosen so a degree of longitude and a
 * degree of latitude cover the same ground at 35°N. That is the whole reason
 * the island reads as Japan: bearings and proportions are true even though the
 * coast is eleven curves and four straight lines.
 *
 * The peninsulas are drawn as hard corners rather than smoothed. Noto, Kii and
 * Izu are what let someone recognise the country in a shape this crude, and
 * they are also what fixes Kanazawa on the north coast and Hakone behind Sagami
 * Bay — the two facts the route argument depends on.
 * ------------------------------------------------------------------ */

const HONSHU =
  // San'in coast, west to east: the frame cuts the island rather than ending it.
  'M -12 156 C 10 150, 32 148, 51 143 C 68 133, 78 118, 90 111 ' +
  'C 106 107, 118 109, 130 110 C 146 110, 158 108, 169 106 L 192 104 ' +
  // Wakasa Bay up to the Noto peninsula, and Toyama Bay behind it.
  'C 199 90, 203 76, 208 63 L 231 26 L 245 57 ' +
  'C 259 42, 274 24, 291 12 C 322 4, 356 -6, 392 -14 L 398 34 ' +
  // Pacific side, east to west: Tokyo Bay, Izu, Ise, then the Kii peninsula.
  'C 372 58, 344 100, 331 126 C 324 120, 318 114, 315 116 ' +
  'C 310 124, 305 130, 300 137 L 292 162 L 286 145 ' +
  'C 262 147, 238 144, 220 140 C 214 152, 200 172, 188 178 ' +
  'C 180 176, 172 164, 166 152 C 150 150, 132 146, 119 145 ' +
  'C 100 150, 80 158, 68 163 C 48 167, 20 170, -12 172 Z';

function MapLens(panel: Panel): JSX.Element {
  const data = panelOf(panel).data as MapData;

  return (
    <div className="s-trv-map">
      <figure className="s-trv-map__figure">
        <svg
          aria-labelledby="s-trv-map-title s-trv-map-desc"
          className="s-trv-map__svg"
          role="img"
          viewBox="0 0 390 210"
        >
          <title id="s-trv-map-title">Route through central Japan</title>
          <desc id="s-trv-map-desc">
            Tokyo to Hakone to Kyoto is ticketed; a northern loop through Kanazawa and a western
            alternative through Hiroshima are both undecided. Every leg is listed as text beside
            this map.
          </desc>

          <defs>
            <linearGradient id="s-trv-land" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.05" />
            </linearGradient>
            <radialGradient id="s-trv-node-glow">
              <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Graticule first, so the land sits on top of it like ink on a chart. */}
          <g aria-hidden="true" className="s-trv-map__grat">
            {[30, 70, 110, 150, 190].map((y) => (
              <line key={`h${y}`} x1="0" x2="390" y1={y} y2={y} />
            ))}
            {[60, 130, 200, 270, 340].map((x) => (
              <line key={`v${x}`} x1={x} x2={x} y1="0" y2="210" />
            ))}
          </g>

          <path className="s-trv-map__land" d={data.outline} />

          <text className="s-trv-map__sea" x="150" y="76">
            SEA OF JAPAN
          </text>
          <text className="s-trv-map__sea" x="272" y="184">
            PACIFIC
          </text>

          {/* Bottom-left, over open water: the only corner no label or leg uses. */}
          <g aria-hidden="true" className="s-trv-map__compass">
            <path d="M 28 178 L 33 192 L 28 188 L 23 192 Z" />
            <text x="28" y="204">
              N
            </text>
          </g>

          {data.legs.map((leg) => (
            <path
              className={`s-trv-map__leg s-trv-map__leg--${leg.commitment}`}
              d={leg.path}
              key={leg.id}
            />
          ))}

          {data.cities.map((city) => (
            <g className={`s-trv-map__city s-trv-map__city--${city.state}`} key={city.id}>
              {city.state === 'confirmed' && (
                <circle cx={city.x} cy={city.y} fill="url(#s-trv-node-glow)" r="17" />
              )}
              {city.state === 'contested' && (
                <circle className="s-trv-map__pulse" cx={city.x} cy={city.y} r="11" />
              )}
              <circle className="s-trv-map__node" cx={city.x} cy={city.y} r="4.5" />
              <text
                className="s-trv-map__name"
                textAnchor={city.side === 'left' ? 'end' : 'start'}
                x={city.side === 'left' ? city.x - 11 : city.x + 11}
                y={city.y + 1}
              >
                {city.name}
              </text>
              <text
                className="s-trv-map__nights"
                textAnchor={city.side === 'left' ? 'end' : 'start'}
                x={city.side === 'left' ? city.x - 11 : city.x + 11}
                y={city.y + 12}
              >
                {city.jp} · {city.nights}
              </text>
            </g>
          ))}
        </svg>
        <figcaption className="s-trv-map__key">
          <span className="s-trv-map__keyitem s-trv-map__keyitem--booked">ticketed</span>
          <span className="s-trv-map__keyitem s-trv-map__keyitem--proposed">contested</span>
          <span className="s-trv-map__keyitem s-trv-map__keyitem--alternative">alternative</span>
        </figcaption>
      </figure>

      {/* The same data as prose. This is the map's text alternative and it is
          visible, because a leg list is more useful than a hidden caption. */}
      <div className="s-trv-map__side">
        {/* `role="list"` is restated on every list in this file because the
            styling removes markers, and WebKit drops list semantics from a list
            with `list-style: none`. */}
        <ol className="s-trv-legs" role="list">
          {data.legs.map((leg) => (
            <li className="s-trv-leg" key={leg.id} style={accent(COMMITMENT_HUE[leg.commitment])}>
              <span className="s-trv-leg__mark" />
              <div className="s-trv-leg__body">
                <p className="s-trv-leg__route">
                  {leg.route}
                  <Tag accent={COMMITMENT_HUE[leg.commitment]} solid={leg.commitment === 'booked'}>
                    {COMMITMENT_LABEL[leg.commitment]}
                  </Tag>
                </p>
                <p className="s-trv-leg__svc">{leg.service}</p>
                <p className="s-trv-leg__meta">
                  <span>{leg.duration}</span>
                  <span>{leg.fare}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>

        <GlowDivider accent="cyan" />

        <details className="s-trv-why">
          <summary>Why the route bends north</summary>
          <p>{data.reasoning}</p>
        </details>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ITINERARY — booked and proposed are the same axis as certainty
 *
 * A booked day is a fact and renders like one: solid marker, tight leading, no
 * hedging. A proposed day renders as an outline. So the panel's own convergence
 * is legible from across the room without reading a word of it.
 * ------------------------------------------------------------------ */

function DayRow({ day, tight }: { day: Day; tight: boolean }): JSX.Element {
  return (
    <li
      className={`s-trv-day s-trv-day--${day.commitment}${tight ? ' s-trv-day--tight' : ''}`}
      style={accent(COMMITMENT_HUE[day.commitment])}
    >
      <span aria-hidden="true" className="s-trv-day__dot" />
      <div className="s-trv-day__body">
        <p className="s-trv-day__head">
          <span className="s-trv-day__n">Day {day.n}</span>
          <span className="s-trv-day__date">{day.date}</span>
          <span className="s-trv-day__city">{day.city}</span>
        </p>

        {day.transit && (
          <p className="s-trv-day__transit">
            <span aria-hidden="true" className="s-trv-day__rail" />
            {day.transit}
          </p>
        )}

        <ul className="s-trv-blocks" role="list">
          {day.blocks.map((block) => (
            <li className="s-trv-block" key={block.time + block.what}>
              <span className="s-trv-block__time">{block.time}</span>
              <span className="s-trv-block__what">
                {block.what}
                {block.note && <span className="s-trv-block__note">{block.note}</span>}
              </span>
            </li>
          ))}
        </ul>

        {day.lodging && (
          <p className="s-trv-day__lodge">
            <StatusOrb
              hue={COMMITMENT_HUE[day.commitment]}
              label={COMMITMENT_LABEL[day.commitment]}
              size={5}
            />
            {day.lodging}
          </p>
        )}
      </div>
    </li>
  );
}

function ItineraryLens(panel: Panel): JSX.Element {
  const data = panelOf(panel).data as ItineraryData;

  if (data.mode === 'linear') {
    return (
      <div className="s-trv-itin s-trv-itin--tight">
        <ol className="s-trv-days" role="list">
          {data.days.map((day) => (
            <DayRow day={day} key={day.n} tight />
          ))}
        </ol>
        <p className="s-trv-foot">{data.footnote}</p>
      </div>
    );
  }

  return (
    <div className="s-trv-itin s-trv-itin--open">
      <p className="s-trv-question">{data.question}</p>

      <div className="s-trv-branches">
        {data.branches.map((branch) => (
          <section className="s-trv-branch" key={branch.id}>
            <header className="s-trv-branch__head">
              <h4 className="s-trv-branch__title">
                {branch.label}
                <span className="s-trv-branch__city">{branch.city}</span>
              </h4>
              <ConvergenceMeter accent="cyan" value={branch.confidence} />
            </header>

            <p className="s-trv-branch__cost">{branch.cost}</p>

            <ol className="s-trv-days" role="list">
              {branch.days.map((day) => (
                <DayRow day={day} key={`${branch.id}-${day.n}`} tight={false} />
              ))}
            </ol>

            <details className="s-trv-why">
              <summary>The case for and against</summary>
              <p className="s-trv-why__for">{branch.argument}</p>
              <p className="s-trv-why__against">{branch.against}</p>
            </details>
          </section>
        ))}
      </div>

      <Empty>
        Neither branch is chosen, so nothing after 14 April is ticketed. Sairi will not spend
        against a fork.
      </Empty>
      <p className="s-trv-foot">{data.footnote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * CONSTRAINTS — chips that know whether they are being honoured
 *
 * A constraint in tension is drawn as a PAIR joined by a magenta hairline,
 * because a tension is never a property of one constraint: it is the shape of
 * two of them not fitting in the same trip.
 * ------------------------------------------------------------------ */

const CHIP_HUE: Record<ChipState, Spectral> = {
  locked: 'mint',
  satisfied: 'mint',
  tension: 'magenta',
  open: 'cyan',
  evaluating: 'violet',
};

const CHIP_LABEL: Record<ChipState, string> = {
  locked: 'locked',
  satisfied: 'satisfied',
  tension: 'in tension',
  open: 'open',
  evaluating: 'evaluating',
};

function ConstraintsLens(panel: Panel): JSX.Element {
  const data = panelOf(panel).data as ConstraintsData;

  return (
    <div className="s-trv-cons">
      <ul className="s-trv-chips" role="list">
        {data.chips.map((chip) => (
          <li
            className={`s-trv-chip s-trv-chip--${chip.state}`}
            key={chip.id}
            style={accent(CHIP_HUE[chip.state])}
          >
            <p className="s-trv-chip__top">
              <span className="s-trv-chip__label">{chip.label}</span>
              <Tag accent={CHIP_HUE[chip.state]} solid={chip.state === 'locked'}>
                {CHIP_LABEL[chip.state]}
              </Tag>
            </p>
            <p className="s-trv-chip__value">{chip.value}</p>
            {chip.state === 'evaluating' ? (
              <Forming rows={2} />
            ) : (
              <p className="s-trv-chip__note">{chip.note}</p>
            )}
          </li>
        ))}
      </ul>

      {data.tensions && data.tensions.length > 0 && (
        <>
          <GlowDivider accent="magenta" />
          <ul className="s-trv-tensions" role="list">
            {data.tensions.map((tension) => (
              <li className="s-trv-tension" key={tension.id}>
                <p className="s-trv-tension__pair">
                  <span className="s-trv-tension__side">{tension.left}</span>
                  <span aria-label="conflicts with" className="s-trv-tension__link" role="img" />
                  <span className="s-trv-tension__side">{tension.right}</span>
                </p>
                <p className="s-trv-tension__why">{tension.why}</p>
                <p className="s-trv-tension__cost">{tension.cost}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="s-trv-foot">{data.footnote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LEDGER — money against a hard ceiling
 *
 * The total rail is scaled to the RUNNING TOTAL rather than to the budget, and
 * the budget is drawn as a line across it. Scaling the other way would clip the
 * overspend out of the picture, which is the one thing this panel exists to
 * show.
 * ------------------------------------------------------------------ */

function LedgerTotal({
  total,
  committed,
  budget,
}: {
  total: number;
  committed: number;
  budget: number;
}): JSX.Element {
  const shown = useCountUp(total, 900);
  const over = total - budget;
  const marker = budget / total;

  return (
    <div className="s-trv-ledg__total" style={{ '--marker': marker } as CSSProperties}>
      <div className="s-trv-ledg__figs">
        <Metric accent="cyan" label="running total" value={yen(shown)} />
        <Metric accent="mint" label="ceiling" value={yen(budget)} />
        <Metric
          accent={over > 0 ? 'coral' : 'mint'}
          label={over > 0 ? 'over budget' : 'head-room'}
          trend={over > 0 ? 'up' : 'down'}
          value={yen(Math.abs(over))}
        />
      </div>

      <div
        aria-label={`Running total ${yen(total)} against a ceiling of ${yen(budget)}`}
        className="s-trv-ledg__rail"
        role="img"
      >
        <span className="s-trv-ledg__grow">
          <span
            className="s-trv-ledg__seg s-trv-ledg__seg--committed"
            style={{ flexBasis: `${(committed / total) * 100}%` }}
          />
          <span className="s-trv-ledg__seg s-trv-ledg__seg--projected" />
        </span>
        <span className="s-trv-ledg__over" />
        <span className="s-trv-ledg__marker" />
      </div>
      <p className="s-trv-ledg__scale">
        <span>{yen(committed)} committed</span>
        <span className="s-trv-ledg__ceiling">ceiling</span>
      </p>
    </div>
  );
}

function LedgerLens(panel: Panel): JSX.Element {
  const data = panelOf(panel).data as LedgerData;
  const total = data.lines.reduce((sum, line) => sum + line.committed + line.projected, 0);
  const committed = data.lines.reduce((sum, line) => sum + line.committed, 0);
  const widest = data.lines.reduce(
    (max, line) => Math.max(max, line.committed + line.projected),
    1,
  );

  return (
    <div className="s-trv-ledg">
      <LedgerTotal budget={data.budget} committed={committed} total={total} />

      <GlowDivider accent="cyan" />

      <ul className="s-trv-rows" role="list">
        {data.lines.map((line) => {
          const lineTotal = line.committed + line.projected;
          return (
            <li className="s-trv-row" key={line.id} style={accent(line.accent)}>
              <p className="s-trv-row__head">
                <span className="s-trv-row__name">{line.label}</span>
                <span className="s-trv-row__fig">{yen(lineTotal)}</span>
              </p>
              <span
                aria-hidden="true"
                className="s-trv-row__bar"
                style={{ '--w': lineTotal / widest } as CSSProperties}
              >
                <span
                  className="s-trv-row__seg s-trv-row__seg--committed"
                  style={{ flexBasis: `${(line.committed / lineTotal) * 100}%` }}
                />
                <span className="s-trv-row__seg s-trv-row__seg--projected" />
              </span>
              <p className="s-trv-row__note">
                <span className="s-trv-row__split">
                  {yen(line.committed)} paid · {yen(line.projected)} estimated
                </span>
                {line.note}
              </p>
            </li>
          );
        })}
      </ul>

      <details className="s-trv-why s-trv-why--ledger">
        <summary>{data.counterfactual.label}</summary>
        <p className="s-trv-cf">
          <span className="s-trv-cf__delta">−{yen(Math.abs(data.counterfactual.delta))}</span>
          <span className="s-trv-cf__result">lands at {yen(data.counterfactual.result)}</span>
        </p>
        <p>{data.counterfactual.detail}</p>
      </details>

      <p className="s-trv-foot">{data.footnote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The context
 * ------------------------------------------------------------------ */

const MAP_DATA: MapData = {
  outline: HONSHU,
  cities: [
    {
      id: 'tokyo',
      name: 'Tokyo',
      jp: '東京',
      x: 317,
      y: 102,
      nights: '3 nights',
      state: 'confirmed',
      side: 'right',
    },
    {
      id: 'hakone',
      name: 'Hakone',
      jp: '箱根',
      x: 292,
      y: 121,
      nights: '2 nights · held',
      state: 'contested',
      side: 'right',
    },
    {
      id: 'kanazawa',
      name: 'Kanazawa',
      jp: '金沢',
      x: 212,
      y: 66,
      nights: '2 nights · contested',
      state: 'contested',
      side: 'right',
    },
    {
      id: 'kyoto',
      name: 'Kyoto',
      jp: '京都',
      x: 183,
      y: 124,
      nights: '4 nights',
      state: 'confirmed',
      side: 'left',
    },
    {
      id: 'osaka',
      name: 'Osaka',
      jp: '大阪',
      x: 170,
      y: 154,
      nights: '2 nights',
      state: 'confirmed',
      side: 'left',
    },
    {
      id: 'hiroshima',
      name: 'Hiroshima',
      jp: '広島',
      x: 70,
      y: 155,
      nights: 'alternative',
      state: 'alternative',
      side: 'left',
    },
  ],
  legs: [
    {
      id: 'l1',
      route: 'Tokyo → Hakone',
      service: 'Odakyu Romancecar 21 · Shinjuku 09:00 → Hakone-Yumoto 10:25',
      duration: '1h 25m',
      fare: '¥4,780 ×2',
      commitment: 'booked',
      path: 'M 317 102 Q 300 108 292 121',
    },
    {
      id: 'l2',
      route: 'Hakone → Kyoto',
      service: 'Odakyu to Odawara, then Hikari 645 · Odawara 11:26 → Kyoto 13:32',
      duration: '2h 21m',
      fare: '¥12,140 ×2',
      commitment: 'booked',
      path: 'M 292 121 Q 237 143 183 124',
    },
    {
      id: 'l3',
      route: 'Kyoto → Kanazawa',
      service: 'Thunderbird 17 to Tsuruga, then Hokuriku Shinkansen Tsurugi 15',
      duration: '2h 09m',
      fare: '¥7,790 ×2',
      commitment: 'proposed',
      path: 'M 183 124 Q 208 104 212 66',
    },
    {
      id: 'l4',
      route: 'Kanazawa → Osaka',
      service: 'Tsurugi to Tsuruga, then Thunderbird 40 · arrives Shin-Osaka 19:04',
      duration: '2h 32m',
      fare: '¥9,140 ×2',
      commitment: 'proposed',
      path: 'M 212 66 Q 158 100 170 154',
    },
    {
      id: 'l5',
      route: 'Kyoto → Hiroshima',
      service: 'Sakura 549 · Kyoto 09:14 → Hiroshima 10:52, reserved green not required',
      duration: '1h 38m',
      fare: '¥11,410 ×2',
      commitment: 'alternative',
      path: 'M 183 124 Q 126 132 70 155',
    },
    {
      id: 'l6',
      route: 'Hiroshima → Osaka',
      service: 'Nozomi 34 · Hiroshima 16:26 → Shin-Osaka 17:53',
      duration: '1h 27m',
      fare: '¥10,620 ×2',
      commitment: 'alternative',
      path: 'M 70 155 Q 122 178 170 154',
    },
  ],
  reasoning:
    'Kanazawa is 300 km off a straight Tokyo–Osaka line, and the detour only exists because the ' +
    'blossom front arrives there roughly a fortnight after Kyoto. Route Planner keeps it on the map ' +
    'until the ledger decides: dropping it saves ¥52,900 and one hotel change, and costs the only ' +
    'stop on this itinerary where the trees are likely to still be in flower on 15 April.',
};

const LOCKED_DATA: ConstraintsData = {
  chips: [
    {
      id: 'dates',
      label: 'Dates',
      value: '8–21 April 2026 · 13 nights',
      state: 'locked',
      note: 'Mileage award seats. A date change forfeits the award and re-books at cash fare.',
    },
    {
      id: 'budget',
      label: 'Ground budget',
      value: '¥820,000',
      state: 'locked',
      note: 'Everything inside Japan for two people. International flights already paid in miles.',
    },
    {
      id: 'shape',
      label: 'Open-jaw',
      value: 'HND in · KIX out',
      state: 'locked',
      note: 'The route has to end in Kansai. Haruka 32 from Kyoto to KIX is the fallback if Osaka drops.',
    },
    {
      id: 'party',
      label: 'Travellers',
      value: '2 adults, no car',
      state: 'locked',
      note: 'Neither drives in Japan, so every leg has to exist on rail or a scheduled bus.',
    },
  ],
  footnote: 'Four constraints are settled. Sairi treats these as walls, not preferences.',
};

const BOOKED_DATA: ItineraryData = {
  mode: 'linear',
  days: [
    {
      n: 1,
      date: 'Wed 8 Apr',
      city: 'Tokyo',
      commitment: 'booked',
      transit: 'HND T3 → Shinjuku · Airport Limousine 07:15, 55 min',
      lodging: 'Citadines Shinjuku · 3 nights · ¥27,800/night',
      blocks: [
        { time: '06:15', what: 'Land HND', note: 'Visit Japan Web QR pre-cleared' },
        { time: '13:00', what: 'Shinjuku Gyoen', note: '¥500 · yaezakura still out this late' },
      ],
    },
    {
      n: 2,
      date: 'Thu 9 Apr',
      city: 'Tokyo',
      commitment: 'booked',
      blocks: [
        {
          time: '10:30',
          what: 'teamLab Borderless, Azabudai Hills',
          note: 'timed entry · ¥4,800 ×2',
        },
        { time: '19:00', what: 'Dinner — Sougo, Roppongi', note: 'shōjin, kombu dashi confirmed' },
      ],
    },
    {
      n: 3,
      date: 'Fri 10 Apr',
      city: 'Tokyo',
      commitment: 'booked',
      blocks: [
        { time: '07:00', what: 'Tsukiji outer market, then Hamarikyu' },
        {
          time: '17:40',
          what: 'Kabuki-za, single-act seats',
          note: '¥2,000 ×2 · same-day queue only',
        },
      ],
    },
    {
      n: 4,
      date: 'Sat 11 Apr',
      city: 'Tokyo → Hakone',
      commitment: 'held',
      transit: 'Romancecar 21 · Shinjuku 09:00 → Hakone-Yumoto 10:25',
      lodging: 'Hakone Ginyu · 2 nights half-board · ¥68,400/night · rate lock expires 18:00 JST',
      blocks: [{ time: '14:00', what: 'Hakone Open-Air Museum', note: '¥1,600 ×2' }],
    },
    {
      n: 5,
      date: 'Sun 12 Apr',
      city: 'Hakone',
      commitment: 'held',
      blocks: [
        { time: '09:30', what: 'Ōwakudani ropeway + Lake Ashi' },
        {
          time: '—',
          what: 'Contingency',
          note: 'ropeway suspends on volcanic gas; bus H replaces it',
        },
      ],
    },
    {
      n: 6,
      date: 'Mon 13 Apr',
      city: 'Hakone → Kyoto',
      commitment: 'booked',
      transit: 'Odakyu to Odawara · Hikari 645 · Odawara 11:26 → Kyoto 13:32',
      lodging: 'Nazuna Kyoto Gosho · 4 nights · ¥41,200/night',
      blocks: [{ time: '16:00', what: 'Nishiki, then Ponto-chō at dusk' }],
    },
    {
      n: 7,
      date: 'Tue 14 Apr',
      city: 'Kyoto',
      commitment: 'booked',
      blocks: [
        { time: '06:40', what: 'Fushimi Inari before the coaches' },
        {
          time: '11:30',
          what: 'Shigetsu, Tenryū-ji',
          note: 'shōjin ryōri ¥6,600 ×2 · phone booking held',
        },
      ],
    },
  ],
  footnote: 'Seven days ticketed. Only the Hakone ryokan is on a lock rather than paid.',
};

const TENSION_DATA: ConstraintsData = {
  chips: [
    {
      id: 'pace',
      label: 'Pace',
      value: 'No more than two hotel changes',
      state: 'tension',
      note: 'The five-stop route needs four. Dropping Kanazawa brings it to three, still one over.',
    },
    {
      id: 'diet',
      label: 'Diet',
      value: 'Vegetarian, no katsuobushi dashi',
      state: 'open',
      note: '9 of 13 dinners verified. Hakone half-board needs the written request five days ahead.',
    },
    {
      id: 'blossom',
      label: 'Must see',
      value: 'Cherry blossom',
      state: 'tension',
      note: 'Kyoto full bloom is forecast 2 Apr; arrival is 8 Apr. Kanazawa peaks around 12 Apr.',
    },
    {
      id: 'kenrokuen',
      label: 'Must see',
      value: 'Kenroku-en',
      state: 'open',
      note: 'Only reachable if Kanazawa survives. Night illumination runs to 21:30 in blossom season.',
    },
    {
      id: 'rest',
      label: 'Pace',
      value: 'One day with nothing in it',
      state: 'evaluating',
      note: 'Route Planner is testing where a rest day fits without losing a booked entry slot.',
    },
    {
      id: 'teamlab',
      label: 'Must see',
      value: 'teamLab Borderless',
      state: 'satisfied',
      note: '10:30 slot held for 9 April, inside the Tokyo block. Nothing depends on it.',
    },
  ],
  tensions: [
    {
      id: 't1',
      left: 'Cherry blossom',
      right: '¥820,000 ceiling',
      why:
        'The only stop still likely to be in flower after 12 April is Kanazawa, and Kanazawa is ' +
        'exactly what puts the trip ¥18,500 over the ceiling.',
      cost: 'Resolving one breaks the other. Sairi will not pick for you.',
    },
    {
      id: 't2',
      left: 'Two hotel changes',
      right: 'Five cities in 13 nights',
      why:
        'Five stops implies four changes however they are ordered. Constraint Watch is blocked here ' +
        'and has stopped proposing lodging until the stop count is settled.',
      cost: 'Either the pace rule relaxes to three changes, or a city goes.',
    },
  ],
  footnote:
    'Six live constraints, two of them pulling against each other. This panel stays wide until they stop.',
};

const OPEN_DATA: ItineraryData = {
  mode: 'branched',
  question:
    'Days 8–13 fork after Kyoto. Both branches end at KIX on the 21st; neither is ticketed.',
  branches: [
    {
      id: 'a',
      label: 'Branch A',
      city: 'Kanazawa',
      confidence: 0.44,
      cost: '+¥52,900 · four hotel changes · blossom likely',
      argument:
        'Kanazawa is the one stop where the trees should still be in flower — Kenroku-en runs its ' +
        'night illumination through peak bloom, forecast around 12 April. Higashi Chaya and the ' +
        '21st Century Museum fill two days without a single reservation.',
      against:
        'It puts the ledger ¥18,500 over the ceiling and adds a fourth hotel change. Thunderbird 40 ' +
        'back to Shin-Osaka is 2h32 of the last full day.',
      days: [
        {
          n: 8,
          date: 'Wed 15 Apr',
          city: 'Kyoto → Kanazawa',
          commitment: 'proposed',
          transit: 'Thunderbird 17 → Tsuruga → Tsurugi 15 · 2h 09m · ¥7,790 ×2',
          lodging: 'Kanazawa proposal: Hotel Amanek Korinbo · ¥19,600/night',
          blocks: [{ time: '15:00', what: 'Kenroku-en + Seisonkaku', note: '¥820 ×2 combined' }],
        },
        {
          n: 9,
          date: 'Thu 16 Apr',
          city: 'Kanazawa',
          commitment: 'proposed',
          blocks: [
            { time: '09:00', what: 'Ōmichō market, then Higashi Chaya' },
            {
              time: '14:00',
              what: '21st Century Museum',
              note: 'closed Mondays — 16th is a Thursday',
            },
          ],
        },
        {
          n: 10,
          date: 'Fri 17 Apr',
          city: 'Kanazawa → Osaka',
          commitment: 'proposed',
          transit: 'Tsurugi → Tsuruga → Thunderbird 40 · arrives Shin-Osaka 19:04',
          blocks: [
            { time: '20:30', what: 'Dōtonbori on arrival', note: 'nothing booked, deliberately' },
          ],
        },
      ],
    },
    {
      id: 'b',
      label: 'Branch B',
      city: 'Hiroshima + Miyajima',
      confidence: 0.31,
      cost: '−¥4,300 · three hotel changes · no blossom',
      argument:
        'Under the ceiling, one fewer hotel change, and Sakura 549 puts Hiroshima 1h38 from Kyoto. ' +
        'Miyajima at low tide on the 16th is the single strongest image of the trip.',
      against:
        'The blossom is gone in Hiroshima by mid-April, and the Peace Memorial Museum is a heavy ' +
        'half-day that the rest of this itinerary is not built around.',
      days: [
        {
          n: 8,
          date: 'Wed 15 Apr',
          city: 'Kyoto → Hiroshima',
          commitment: 'proposed',
          transit: 'Sakura 549 · Kyoto 09:14 → Hiroshima 10:52 · ¥11,410 ×2',
          lodging: 'Hiroshima proposal: Hotel Granvia · ¥16,400/night',
          blocks: [{ time: '13:00', what: 'Peace Memorial Park and Museum', note: '¥200 ×2' }],
        },
        {
          n: 9,
          date: 'Thu 16 Apr',
          city: 'Miyajima',
          commitment: 'proposed',
          blocks: [
            {
              time: '07:20',
              what: 'JR ferry to Miyajima',
              note: 'low tide 09:41 — torii walkable',
            },
            { time: '15:00', what: 'Mt Misen ropeway', note: '¥2,000 ×2 return' },
          ],
        },
        {
          n: 10,
          date: 'Fri 17 Apr',
          city: 'Hiroshima → Osaka',
          commitment: 'proposed',
          transit: 'Nozomi 34 · Hiroshima 16:26 → Shin-Osaka 17:53 · ¥10,620 ×2',
          blocks: [{ time: '19:30', what: 'Osaka, hotel not yet chosen' }],
        },
      ],
    },
  ],
  footnote:
    'Days 11–13 in Osaka are identical under both branches and are held, not booked, until the fork closes.',
};

const LEDGER_DATA: LedgerData = {
  budget: 820000,
  lines: [
    {
      id: 'lodging',
      label: 'Lodging',
      accent: 'cyan',
      committed: 312600,
      projected: 118400,
      note: 'Hakone Ginyu is the whole variance: ¥68,400/night against ¥27,800 in Tokyo.',
    },
    {
      id: 'rail',
      label: 'Rail & transit',
      accent: 'blue',
      committed: 98400,
      projected: 69300,
      note: 'Point-to-point beats the 14-day JR Pass by ¥12,300 on the current route.',
    },
    {
      id: 'food',
      label: 'Food',
      accent: 'mint',
      committed: 12800,
      projected: 132800,
      note: '¥5,600 per person per day, two reservations already paid.',
    },
    {
      id: 'entry',
      label: 'Entry & experiences',
      accent: 'violet',
      committed: 9400,
      projected: 28800,
      note: 'teamLab and Kabuki-za are paid. Kenroku-en and Mt Misen are branch-dependent.',
    },
    {
      id: 'buffer',
      label: 'Contingency',
      accent: 'amber',
      committed: 0,
      projected: 56000,
      note: 'Held at 7% of ground spend. Budget Keeper refuses to spend this to close a gap.',
    },
  ],
  counterfactual: {
    label: 'If Kanazawa is dropped',
    delta: 52900,
    result: 785600,
    detail:
      'Two ryokan nights at ¥19,600, both Hokuriku legs, and Kenroku-en come out; a third Kyoto ' +
      'night and the Sakura 549 fare go back in. Net ¥52,900 recovered, landing ¥34,400 under the ' +
      'ceiling with the contingency untouched.',
  },
  footnote: 'Committed figures are paid or non-refundable. Estimates carry ±8% on food and entry.',
};

export const TRAVEL: SairiContext = {
  id: 'ctx-travel-japan-april',
  intention: 'plan two weeks in Japan in April — Tokyo, Kyoto, and wherever else makes sense',
  objective:
    'Assemble a 13-night April route across at most five Japanese cities under ¥820,000 of ground ' +
    'spend, honouring an open-jaw HND→KIX booking, a no-dashi vegetarian diet, and a hard limit on ' +
    'how often the party changes hotel.',
  kind: 'travel',
  hue: 'cyan',
  agents: [
    {
      id: 'wayfinder',
      role: 'Route planner',
      task: 'Weighing Kanazawa against Hiroshima for days 8–10',
      status: 'working',
      progress: 0.68,
      hue: 'cyan',
      output:
        'Kagayaki 509 does Tokyo→Kanazawa in 2h33, but from Kyoto the only path is Thunderbird to ' +
        'Tsuruga and change: 2h09 out, 2h32 back.',
      produced: ['trv-map', 'trv-open'],
    },
    {
      id: 'concierge',
      role: 'Lodging',
      task: 'Holding two half-board rooms at Hakone Ginyu',
      status: 'awaiting-approval',
      progress: 0.9,
      hue: 'amber',
      output:
        'Rate lock expires 18:00 JST — 4h 12m left. ¥68,400/night, kaiseki has a shōjin setting on ' +
        'five days notice. Confirm or the rooms release.',
      produced: ['trv-booked'],
    },
    {
      id: 'keeper',
      role: 'Budget keeper',
      task: 'Reconciling JR Pass against point-to-point fares',
      status: 'working',
      progress: 0.41,
      hue: 'mint',
      output:
        '14-day JR Pass at ¥80,000 loses to point-to-point by ¥12,300 on this route, and by more if ' +
        'Kanazawa is dropped.',
      produced: ['trv-ledger'],
    },
    {
      id: 'watch',
      role: 'Constraint watch',
      task: 'Blocked: five stops cannot fit two hotel changes',
      status: 'blocked',
      progress: 0.55,
      hue: 'magenta',
      output:
        'Five stops implies four changes however they are ordered. Not proposing further lodging ' +
        'until the stop count is settled.',
      produced: ['trv-tension', 'trv-locks'],
    },
    {
      id: 'table',
      role: 'Dietary scout',
      task: 'Verified evening meals in every confirmed stop',
      status: 'done',
      progress: 1,
      hue: 'violet',
      output:
        'Shigetsu at Tenryū-ji confirmed by phone, ¥6,600 set, no online booking. Four dinners in ' +
        'the fork are unverified because the cities are.',
      produced: [],
    },
  ],
  panels: [
    {
      id: 'trv-locks',
      title: 'Fixed',
      lens: 'constraints',
      certainty: 'resolved',
      span: 4,
      author: 'Constraint watch',
      data: LOCKED_DATA,
    },
    {
      id: 'trv-map',
      title: 'Route · five stops, 13 nights',
      lens: 'map',
      certainty: 'forming',
      span: 8,
      author: 'Route planner',
      data: MAP_DATA,
    },
    {
      id: 'trv-booked',
      title: 'Days 1–7 · ticketed',
      lens: 'itinerary',
      certainty: 'resolved',
      span: 4,
      author: 'Lodging',
      data: BOOKED_DATA,
    },
    {
      id: 'trv-ledger',
      title: 'Spend against ¥820,000',
      lens: 'ledger',
      certainty: 'forming',
      span: 8,
      author: 'Budget keeper',
      data: LEDGER_DATA,
    },
    {
      id: 'trv-tension',
      title: 'Constraints in tension',
      lens: 'constraints',
      certainty: 'provisional',
      span: 12,
      author: 'Constraint watch',
      data: TENSION_DATA,
    },
    {
      id: 'trv-open',
      title: 'Days 8–13 · unresolved',
      lens: 'itinerary',
      certainty: 'provisional',
      span: 12,
      author: 'Route planner',
      data: OPEN_DATA,
    },
  ],
  proposal: {
    title: 'Drop Kanazawa, give the fourth night to Kyoto',
    detail:
      'Recovers ¥52,900 and lands ¥34,400 under the ceiling, removes one hotel change, and frees ' +
      '17 April for Nara. It costs the only stop still likely to be in blossom. Sairi will hold the ' +
      'Hakone rooms either way, but the lock expires at 18:00 JST.',
    verb: 'Apply and re-cost',
  },
  lastActive: 3,
};

export const TRAVEL_LENSES: Partial<Record<LensKind, (panel: Panel) => JSX.Element>> = {
  map: MapLens,
  itinerary: ItineraryLens,
  constraints: ConstraintsLens,
  ledger: LedgerLens,
};
