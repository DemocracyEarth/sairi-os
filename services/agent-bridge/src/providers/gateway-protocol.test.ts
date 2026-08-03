import { describe, expect, it } from 'vitest';
import fixture from './gateway-frames.fixture.json' with { type: 'json' };
import {
  CLIENT_IDENTITY,
  GATEWAY_PROTOCOL,
  encodeConnect,
  isConnectChallenge,
} from './openclaw.js';

/**
 * The OpenClaw gateway wire protocol, checked against frames a real gateway
 * actually sent.
 *
 * Everything here runs on ./gateway-frames.fixture.json, captured on 2026-08-03
 * from openclaw 2026.7.1-2 in the SairiOS guest. Nothing in this file was
 * written from documentation, which matters: the protocol.md shipped inside the
 * openclaw package itself contains a connect example the gateway rejects.
 *
 * These tests do not prove SairiOS can run an agent turn. They prove it can
 * connect, that it reads the envelope the way the gateway writes it, and that
 * the specific mistakes already made once cannot come back.
 */

const CLIENT_IDS = [
  'webchat-ui',
  'openclaw-control-ui',
  'openclaw-tui',
  'webchat',
  'cli',
  'gateway-client',
  'openclaw-macos',
  'openclaw-ios',
  'openclaw-android',
  'node-host',
  'test',
  'fingerprint',
  'openclaw-probe',
];
const CLIENT_MODES = ['webchat', 'cli', 'ui', 'backend', 'node', 'probe', 'test'];

describe('the handshake', () => {
  it('recognises the challenge the gateway really opens with', () => {
    expect(isConnectChallenge(fixture.handshake.challenge)).toBe(true);
  });

  it('does not mistake an ordinary event for the challenge', () => {
    expect(isConnectChallenge({ type: 'event', event: 'tick', payload: {} })).toBe(false);
    // The trap the old codec fell into: reading a name out of `type`.
    expect(isConnectChallenge({ type: 'connect.challenge' })).toBe(false);
  });

  it('speaks the protocol version the live gateway agreed to', () => {
    expect(GATEWAY_PROTOCOL).toBe(fixture.protocol);
    expect(fixture.handshake.helloOk.payload.protocol).toBe(GATEWAY_PROTOCOL);
  });

  it('builds a connect request matching the one that was accepted', () => {
    const sent = JSON.parse(encodeConnect('1', '0.1.0')) as typeof fixture.handshake.connect;
    const accepted = fixture.handshake.connect;

    expect(sent.type).toBe('req');
    expect(sent.method).toBe('connect');
    expect(sent.params.client.id).toBe(accepted.params.client.id);
    expect(sent.params.client.mode).toBe(accepted.params.client.mode);
    expect(sent.params.role).toBe(accepted.params.role);
    expect(sent.params.minProtocol).toBe(accepted.params.minProtocol);
    expect(sent.params.scopes).toEqual(accepted.params.scopes);
  });

  it('uses an identity from the closed enums the gateway enforces', () => {
    // This is the exact failure the live gateway returned the first time:
    //   at /client/id: must be equal to one of the allowed values
    //   at /client/mode: must be equal to one of the allowed values
    expect(CLIENT_IDS).toContain(CLIENT_IDENTITY.id);
    expect(CLIENT_MODES).toContain(CLIENT_IDENTITY.mode);
  });

  it('never sends operator as a client MODE, which is a role', () => {
    // Upstream's own protocol.md example does exactly this and is refused.
    expect(CLIENT_MODES).not.toContain('operator');
    expect(CLIENT_IDENTITY.mode).not.toBe('operator');
    const sent = JSON.parse(encodeConnect('1', '0.1.0')) as { params: { role: string } };
    expect(sent.params.role).toBe('operator');
  });

  it('omits auth entirely when there is no token, rather than sending an empty one', () => {
    const without = JSON.parse(encodeConnect('1', '0.1.0')) as { params: Record<string, unknown> };
    expect(without.params['auth']).toBeUndefined();

    const withToken = JSON.parse(encodeConnect('1', '0.1.0', 'tok')) as {
      params: { auth: { token: string } };
    };
    expect(withToken.params.auth.token).toBe('tok');
  });
});

describe('the envelope', () => {
  it('has three categories, and the name is never in `type`', () => {
    expect(fixture.envelope.request.type).toBe('req');
    expect(fixture.envelope.response.type).toBe('res');
    expect(fixture.envelope.event.type).toBe('event');
    // The whole reason the placeholder codec could never have worked.
    expect(fixture.envelope.event.event).toBe('connect.challenge');
  });
});

describe('what the fixture records about the gap that remains', () => {
  it('lists no models, because no provider is configured', () => {
    // This emptiness is the shape of the one thing a key would change.
    expect(fixture.responses.modelsList.payload.models).toEqual([]);
  });

  it('names the approval events that must meet the permission broker', () => {
    // If OpenClaw prompts AND SairiOS prompts, a user answers twice.
    expect(fixture.eventsRelevantToSairiOS.approvals).toContain('exec.approval.requested');
    expect(fixture.eventsRelevantToSairiOS.approvals).toContain('exec.approval.resolved');
  });

  it('keeps the rejection shape, because the error path has to read it', () => {
    expect(fixture.handshake.rejection.ok).toBe(false);
    expect(fixture.handshake.rejection.error.code).toBe('INVALID_REQUEST');
  });
});
