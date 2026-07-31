/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SairiUIDocument } from '@sairios/adaptive-ui-schema';
import { EMPTY_HOST, type SairiUIHost } from './host.js';
import { renderMarkdown } from './markdown.js';
import { SairiUIRenderer } from './renderer.js';

afterEach(cleanup);

const CONTEXT_ID = 'ctx_0123456789abcdef0123456789abcdef';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

function doc(regions: SairiUIDocument['layout']['regions']): SairiUIDocument {
  return {
    version: '0.1',
    contextId: CONTEXT_ID,
    title: 'Test',
    contextType: 'ephemeral',
    layout: { type: 'workspace', regions },
    suggestedActions: [],
  };
}

describe('SairiUI renderer', () => {
  it('renders a valid document', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: { type: 'text', props: { title: 'Objective', body: 'Pick a vendor' } },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByText('Pick a vendor')).toBeDefined();
  });

  it('renders the safe error state instead of an unknown component', () => {
    render(
      <SairiUIRenderer
        document={doc([{ id: 'a', component: { type: 'iframe', props: { src: 'x' } } as never }])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByText(/could not be verified/i)).toBeDefined();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders NOTHING from a document that has one invalid region', () => {
    render(
      <SairiUIRenderer
        document={doc([
          { id: 'good', component: { type: 'text', props: { body: 'this must not appear' } } },
          { id: 'bad', component: { type: 'script', props: {} } as never },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.queryByText('this must not appear')).toBeNull();
  });

  it('renders the error state for a non-object payload', () => {
    render(<SairiUIRenderer document="not a document" host={EMPTY_HOST} />);
    expect(screen.getByText(/could not be verified/i)).toBeDefined();
  });

  it('injects no script element from any props', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'text',
              props: { body: '<script>window.pwned = true</script>' },
            },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/window.pwned/)).toBeDefined();
  });
});

describe('component rendering', () => {
  it('renders a table with columns and rows', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'table',
              props: {
                columns: [
                  { key: 'criterion', label: 'Criterion' },
                  { key: 'price', label: 'Price', align: 'right' },
                ],
                rows: [{ criterion: 'Cost', price: 1200 }],
              },
            },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByText('Criterion')).toBeDefined();
    expect(screen.getByText('1200')).toBeDefined();
  });

  it('marks a source the user did not author as untrusted', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'source-list',
              props: { sources: [{ label: 'fetched.html', kind: 'url' }] },
            },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByText('untrusted')).toBeDefined();
  });

  it('does not mark an explicitly trusted source', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'source-list',
              props: { sources: [{ label: 'mine.md', kind: 'file', trusted: true }] },
            },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.queryByText('untrusted')).toBeNull();
  });

  it('renders host-supplied context metadata rather than model-supplied values', () => {
    const host: SairiUIHost = {
      ...EMPTY_HOST,
      context: {
        id: CONTEXT_ID,
        schemaVersion: '0.1',
        name: 'Real context name',
        type: 'persistent',
        status: 'active',
        createdAt: '2026-07-31T09:00:00.000Z',
        updatedAt: '2026-07-31T09:00:00.000Z',
        objective: 'The real objective',
        memory: [],
        artifacts: [],
        permissions: [],
        tasks: [],
        events: [],
        uiSpecification: null,
        agentSession: { provider: 'mock', sessionId: null, status: 'idle' },
        parentContextId: null,
        crystallizedFrom: null,
      },
    };
    render(
      <SairiUIRenderer
        document={doc([
          { id: 'a', component: { type: 'context-metadata', props: { title: 'Context' } } },
        ])}
        host={host}
      />,
    );
    expect(screen.getByText('Real context name')).toBeDefined();
    expect(screen.getByText('The real objective')).toBeDefined();
  });

  it('reports a permission request the broker does not know about', () => {
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'permission-request',
              props: {
                capability: 'files.delete',
                reason: 'trust me',
                risk: 'low',
                requestId: REQUEST_ID,
              },
            },
          },
        ])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByText(/Unverified permission request/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
  });

  it('offers the four decision options for a request the broker confirms', () => {
    const onPermissionDecision = vi.fn();
    const host: SairiUIHost = {
      ...EMPTY_HOST,
      onPermissionDecision,
      permissions: {
        [REQUEST_ID]: {
          requestId: REQUEST_ID,
          capability: 'files.read',
          reason: 'Read the proposals',
          risk: 'medium',
          status: 'pending',
        },
      },
    };
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'permission-request',
              props: {
                capability: 'files.read',
                reason: 'Read the proposals',
                risk: 'medium',
                requestId: REQUEST_ID,
              },
            },
          },
        ])}
        host={host}
      />,
    );
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Allow for this context' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny and remember' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Deny and remember' }));
    expect(onPermissionDecision).toHaveBeenCalledWith(REQUEST_ID, 'deny', {
      scope: 'context',
      remember: true,
    });
  });

  it('shows the broker’s reason, not the model’s', () => {
    const host: SairiUIHost = {
      ...EMPTY_HOST,
      permissions: {
        [REQUEST_ID]: {
          requestId: REQUEST_ID,
          capability: 'files.delete',
          reason: 'BROKER REASON',
          risk: 'high',
          status: 'pending',
        },
      },
    };
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'permission-request',
              props: {
                capability: 'files.read',
                reason: 'MODEL REASON',
                risk: 'low',
                requestId: REQUEST_ID,
              },
            },
          },
        ])}
        host={host}
      />,
    );
    expect(screen.getByText('BROKER REASON')).toBeDefined();
    expect(screen.queryByText('MODEL REASON')).toBeNull();
    expect(screen.getByText('files.delete')).toBeDefined();
  });

  it('calls the host when an action button is pressed', () => {
    const onAction = vi.fn();
    render(
      <SairiUIRenderer
        document={doc([
          {
            id: 'a',
            component: {
              type: 'action-button',
              props: { label: 'Export', actionId: 'export.now' },
            },
          },
        ])}
        host={{ ...EMPTY_HOST, onAction }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onAction).toHaveBeenCalledWith('export.now', undefined);
  });

  it('clamps a progress value into range', () => {
    render(
      <SairiUIRenderer
        document={doc([{ id: 'a', component: { type: 'progress', props: { value: 1 } } }])}
        host={EMPTY_HOST}
      />,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('restricted markdown', () => {
  it('renders headings, lists, bold and code', () => {
    render(renderMarkdown('# Title\n\n- one\n- two\n\n**bold** and `code`'));
    expect(screen.getByText('Title')).toBeDefined();
    expect(screen.getByText('one')).toBeDefined();
    expect(screen.getByText('bold')).toBeDefined();
    expect(screen.getByText('code')).toBeDefined();
  });

  it('never emits raw HTML', () => {
    const { container } = render(renderMarkdown('<img src=x onerror="alert(1)"> <b>bold</b>'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('renders an http link', () => {
    render(renderMarkdown('[example](https://example.org/page)'));
    const link = screen.getByRole('link', { name: 'example' });
    expect(link.getAttribute('href')).toBe('https://example.org/page');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('refuses a javascript: link and shows it as text', () => {
    const { container } = render(renderMarkdown('[click](javascript:alert(1))'));
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('javascript:alert(1)');
  });

  it('refuses a data: link', () => {
    const { container } = render(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)'));
    expect(container.querySelector('a')).toBeNull();
  });

  it('handles an empty source without crashing', () => {
    const { container } = render(renderMarkdown(''));
    expect(container.querySelector('.sairi-markdown')).not.toBeNull();
  });
});
