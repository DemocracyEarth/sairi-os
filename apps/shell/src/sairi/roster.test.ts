import { describe, expect, it } from 'vitest';
import {
  NOTES_CARRIED_MAX,
  NOTE_MAX_CHARS,
  ROSTER,
  carryForward,
  isReturning,
  recordFor,
  setNoteRetired,
  standing,
  trackRecord,
  type AgentRecord,
  type Roster,
} from './roster.js';

/**
 * The seeded roster used to supply these. It described eight colleagues who had
 * never worked, so it went with the rest of the fixtures — and the records the
 * tests need now live here, which is where a test's fixtures belong anyway.
 */
const METROLOGIST: AgentRecord = {
  id: 'agent-metrologist',
  role: 'Metrologist',
  charter: 'Puts claimed numbers on a common scale.',
  engagements: [
    {
      contextId: 'c1',
      intention: 'i1',
      kind: 'research',
      contribution: 'x',
      outcome: 'ongoing',
      daysAgo: 0,
    },
    {
      contextId: 'c2',
      intention: 'i2',
      kind: 'design',
      contribution: 'x',
      outcome: 'accepted',
      daysAgo: 12,
    },
    {
      contextId: 'c3',
      intention: 'i3',
      kind: 'incident',
      contribution: 'x',
      outcome: 'accepted',
      daysAgo: 34,
    },
    {
      contextId: 'c4',
      intention: 'i4',
      kind: 'research',
      contribution: 'x',
      outcome: 'revised',
      daysAgo: 61,
    },
  ],
  notes: [],
};

/**
 * These tests are modelled on the crystallization tests, and for the same
 * reason: `carryForward` is the only thing between what an agent learned in one
 * context and a context that has never seen it. So most of what follows asserts
 * what must NOT survive, not what must.
 */

/**
 * A record loaded with everything that would be damaging to carry: another
 * workspace's intention, a credential, a path, a raw finding about the user's
 * private data. All of it lives in fields `carryForward` does not read.
 */
const hostile: AgentRecord = {
  id: 'agent-hostile',
  role: 'Metrologist',
  charter: 'Puts claimed numbers on a common scale.',
  engagements: [
    {
      contextId: 'ctx-acquisition',
      intention: 'Model the Northwind acquisition before the board meeting',
      kind: 'research',
      contribution: 'Valued the earn-out at $4.1M using the unpublished Q3 file.',
      outcome: 'accepted',
      daysAgo: 3,
    },
  ],
  notes: [
    {
      id: 'n-1',
      text: 'Ask for the median and the sample size before comparing headline figures.',
      from: 'ctx-acquisition',
    },
    {
      id: 'n-2',
      text: 'Retired belief that should not travel.',
      from: 'ctx-acquisition',
      retired: true,
    },
  ],
};

describe('carryForward', () => {
  it('carries the role, the charter and the live notes', () => {
    const carried = carryForward(hostile);
    expect(carried.role).toBe('Metrologist');
    expect(carried.charter).toBe('Puts claimed numbers on a common scale.');
    expect(carried.notes).toEqual([
      'Ask for the median and the sample size before comparing headline figures.',
    ]);
  });

  it('carries no field beyond the four on CarriedBriefing', () => {
    // The allow-list, asserted as an allow-list. A field added to AgentRecord
    // and accidentally spread into the briefing fails here rather than shipping.
    expect(Object.keys(carryForward(hostile)).sort()).toEqual([
      'charter',
      'notes',
      'priorContexts',
      'role',
    ]);
  });

  it('does not carry another context’s intention, contribution or id', () => {
    const blob = JSON.stringify(carryForward(hostile));
    expect(blob).not.toContain('Northwind');
    expect(blob).not.toContain('earn-out');
    expect(blob).not.toContain('$4.1M');
    expect(blob).not.toContain('Q3 file');
    expect(blob).not.toContain('ctx-acquisition');
  });

  it('reports prior contexts as a count, never as a list', () => {
    const carried = carryForward(hostile);
    expect(carried.priorContexts).toBe(1);
    // A count says "has done this before" without saying what "this" was.
    expect(JSON.stringify(carried)).not.toContain('engagements');
  });

  it('does not carry a retired note', () => {
    expect(carryForward(hostile).notes).not.toContain('Retired belief that should not travel.');
  });

  it('caps how many notes travel', () => {
    const many: AgentRecord = {
      ...hostile,
      notes: Array.from({ length: NOTES_CARRIED_MAX + 7 }, (_, i) => ({
        id: `n-${i}`,
        text: `note ${i}`,
        from: 'ctx-acquisition',
      })),
    };
    expect(carryForward(many).notes).toHaveLength(NOTES_CARRIED_MAX);
  });

  it('truncates a note long enough to be content rather than a heuristic', () => {
    const long: AgentRecord = {
      ...hostile,
      notes: [{ id: 'n', text: 'x'.repeat(NOTE_MAX_CHARS * 3), from: 'ctx-acquisition' }],
    };
    const [note] = carryForward(long).notes;
    expect(note).toHaveLength(NOTE_MAX_CHARS);
    expect(note?.endsWith('…')).toBe(true);
  });

  it('flattens whitespace so a pasted block cannot smuggle structure', () => {
    const structured: AgentRecord = {
      ...hostile,
      notes: [{ id: 'n', text: '  line one\n\n\tline two   ', from: 'ctx-acquisition' }],
    };
    expect(carryForward(structured).notes).toEqual(['line one line two']);
  });

  it('returns nothing to carry for an agent with no past', () => {
    const fresh = recordFor('nobody', 'Scout', {});
    expect(carryForward(fresh).notes).toEqual([]);
    expect(carryForward(fresh).priorContexts).toBe(0);
  });

  it('drops a malformed field rather than throwing', () => {
    // The types say these are strings; a model-produced record will not care.
    // A sanitizer that throws is one somebody wraps in a try/catch that skips
    // sanitizing, so a bad field has to fail INSIDE the allow-list.
    const malformed = {
      ...hostile,
      charter: undefined,
      notes: [{ id: 'n', text: { toString: () => 'not a string' }, from: 'ctx-acquisition' }],
    } as unknown as AgentRecord;

    const carried = carryForward(malformed);
    expect(carried.charter).toBe('');
    expect(carried.notes).toEqual(['']);
    expect(JSON.stringify(carried)).not.toContain('not a string');
  });
});

describe('trackRecord', () => {
  it('has no acceptance rate until an engagement has settled', () => {
    const ongoing: AgentRecord = {
      ...hostile,
      engagements: [{ ...hostile.engagements[0]!, outcome: 'ongoing' }],
    };
    // 0/0 rendered as "0%" would read as an agent that has never been right.
    expect(trackRecord(ongoing).acceptance).toBeNull();
    expect(trackRecord(ongoing).ongoing).toBe(1);
  });

  it('counts each outcome and rates only the settled ones', () => {
    const t = trackRecord(METROLOGIST);
    expect(t.engagements).toBe(4);
    expect(t.accepted).toBe(2);
    expect(t.revised).toBe(1);
    expect(t.ongoing).toBe(1);
    // Two accepted out of three settled. The ongoing one is not in the ratio.
    expect(t.acceptance).toBeCloseTo(2 / 3);
  });
});

describe('recordFor', () => {
  it('synthesises a blank record rather than failing for a first-time agent', () => {
    const record = recordFor('unseen', 'Scout', {});
    expect(record.id).toBe('unseen');
    expect(record.role).toBe('Scout');
    expect(record.engagements).toEqual([]);
    expect(record.notes).toEqual([]);
  });

  it('finds a seeded agent by the id its context already uses', () => {
    expect(recordFor('keeper', 'Budget keeper', { keeper: METROLOGIST }).role).toBe('Metrologist');
  });
});

describe('setNoteRetired', () => {
  it('retires a note without mutating the roster it was given', () => {
    const before: Roster = { a: hostile };
    const after = setNoteRetired(before, 'a', 'n-1', true);
    expect(standing(after['a']!)).toHaveLength(0);
    expect(standing(before['a']!)).toHaveLength(1);
  });

  it('restores a retired note', () => {
    const restored = setNoteRetired({ a: hostile }, 'a', 'n-2', false);
    expect(standing(restored['a']!).map((n) => n.id)).toEqual(['n-1', 'n-2']);
  });

  it('keeps a retired note visible in the history', () => {
    const after = setNoteRetired({ a: hostile }, 'a', 'n-1', true);
    // Retiring is not deleting: you can still see what the agent used to think.
    expect(after['a']!.notes).toHaveLength(2);
    expect(after['a']!.notes.find((n) => n.id === 'n-1')?.retired).toBe(true);
  });

  it('is a no-op for an agent that is not in the roster', () => {
    const before: Roster = { a: hostile };
    expect(setNoteRetired(before, 'missing', 'n-1', true)).toBe(before);
  });
});

describe('isReturning', () => {
  it('is true only for a kind the agent has actually worked', () => {
    const metrologist = METROLOGIST;
    expect(isReturning(metrologist, 'research')).toBe(true);
    expect(isReturning(metrologist, 'incident')).toBe(true);
    expect(isReturning(metrologist, 'travel')).toBe(false);
  });
});

describe('the roster ships empty', () => {
  it('seeds nobody', () => {
    // A roster of colleagues who never worked is exactly the placeholder data
    // this build removed. Records arrive from real sessions.
    expect(Object.keys(ROSTER)).toEqual([]);
  });
});
