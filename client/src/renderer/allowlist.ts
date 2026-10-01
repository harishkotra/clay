/**
 * The client's allowlist decision, kept free of React imports so it is the one
 * module both the renderer and `npm run verify` can execute. registry.ts adds the
 * widget components on top of this; nothing else decides what may render.
 */

import { COMPONENT_NAMES } from '../../../shared/catalog.ts';

export const ALLOWED_COMPONENTS: readonly string[] = COMPONENT_NAMES;

export type AllowlistDecision =
  | { kind: 'allowed'; name: string }
  | { kind: 'unsupported'; name: string };

export function decide(name: string): AllowlistDecision {
  return (ALLOWED_COMPONENTS as readonly string[]).includes(name)
    ? { kind: 'allowed', name }
    : { kind: 'unsupported', name };
}

/** The exact copy the renderer draws inside the red card. */
export function unsupportedLabel(name: string): string {
  return `UNSUPPORTED COMPONENT: ${name || '(empty)'}`;
}

export function isAllowed(name: string): boolean {
  return decide(name).kind === 'allowed';
}
