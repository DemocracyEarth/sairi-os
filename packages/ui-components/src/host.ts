import { createContext, useContext } from 'react';
import type { Context } from '@sairios/context-schema';

/**
 * The render host.
 *
 * Two of the sixteen catalog components (`context-metadata`, `activity-log`)
 * render SairiOS's own state rather than model-supplied content, and
 * `permission-request` must be cross-checked against the broker. Those
 * components read from the host instead of from their props, which is the
 * mechanism that keeps the model from forging them.
 */

export interface PendingPermission {
  requestId: string;
  capability: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  status: string;
}

export interface SairiUIHost {
  /** The context being rendered, or null when rendering a preview. */
  context: Context | null;
  /** Permission requests the BROKER knows about, keyed by request id. */
  permissions: Readonly<Record<string, PendingPermission>>;
  onPermissionDecision?: (
    requestId: string,
    decision: 'allow' | 'deny',
    options: { scope: 'once' | 'context'; remember: boolean },
  ) => void;
  onAction?: (actionId: string, capability?: string) => void;
  onEditorChange?: (regionId: string, value: string) => void;
  onChecklistToggle?: (regionId: string, itemId: string, checked: boolean) => void;
  /** True while an agent run is in flight; disables interactive affordances. */
  busy?: boolean;
}

export const EMPTY_HOST: SairiUIHost = { context: null, permissions: {} };

export const HostContext = createContext<SairiUIHost>(EMPTY_HOST);

export function useHost(): SairiUIHost {
  return useContext(HostContext);
}
