/**
 * Identity URN helpers — canonical identifiers that link node
 * representations across providers and layers.
 *
 * This module is the template's ONE identity-construction mechanism
 * (issue #445 / AF-003): every `urn:` identity string is minted by
 * {@link urnIdentity}, and {@link assignIdentity} is the single entry point
 * that decides a node's identity from its {@link NodeSource}.
 *
 * ## Relationship to core's addressing library (`buildAddress` — AF-025)
 *
 * kbexplorer-core v0.3.0 ships an addressing library (`buildAddress` /
 * `buildPersonAddress`) whose canonical form is `<scheme>://[<authority>/]<body>`
 * — the separator is always `://`. The template's documented identity scheme
 * (content/multi-layer-identity.md, ratified in #47) is the single-colon form
 * `urn:<namespace>:<body>` (e.g. `urn:file:src/engine/graph.ts`). Core's
 * `IdentityAddressingConfig` cannot reproduce that shape:
 * `buildAddress('src/engine/graph.ts', { scheme: 'urn', authority: 'file' })`
 * → `urn://file/src/engine/graph.ts` ≠ `urn:file:src/engine/graph.ts`.
 * Migrating the documented values would break every persisted identity
 * (nodemap `file:` links, goldens, downstream consumers), so — per the
 * reconciliation contract recorded on #445 — the `urn:` shapes are preserved
 * and ALL construction routes through the shared local minting helper below.
 * Schema-minted addresses (content-model `kg://` URNs from `context.jsonld`)
 * are reused verbatim via the JSON-LD `@id` (the core contract: an identity
 * address is ALWAYS reused as a node's `@id`).
 */
import type { KBNode } from '../types';

/**
 * Mint a template-scheme identity URN: `urn:<namespace>:<body>`.
 *
 * The single `urn:` construction point (see module header). Namespaces in use:
 * `file`, `content`, `issue`, `pr`, `commit`, `release`, `person`,
 * `structural`, `structured`, `external`.
 */
export function urnIdentity(namespace: string, body: string | number): string {
  return `urn:${namespace}:${body}`;
}

/**
 * Join multiple parts into an unambiguous (injective) URN body.
 *
 * Each part is percent-encoded before being joined with `:`, so the separator
 * we insert is the ONLY literal colon in the result and `%` can only originate
 * from the encoding. Distinct part tuples therefore always produce distinct
 * bodies. This guards composite identities such as
 * `urn:external:<provider>:<id>` against collision when a `provider` or `id`
 * itself contains a `:` (or `%`): without encoding, `('a', 'b:c')` and
 * `('a:b', 'c')` both collapse to `a:b:c`, silently conflating two distinct
 * real-world entities once the cross-provider merge machinery runs.
 *
 * `encodeURIComponent` leaves the unreserved set (`A–Z a–z 0–9 - _ . ! ~ * ' ( )`)
 * untouched, so non-pathological slugs (`wikipedia-reference`, `org-ceo`,
 * `wiki-knowledge-graph`) are unchanged and existing valid identities do not
 * churn.
 */
export function urnBody(...parts: Array<string | number>): string {
  return parts.map(part => encodeURIComponent(String(part))).join(':');
}

/**
 * Generate a canonical identity URN for a node based on its source.
 *
 * Coverage notes:
 *  - `authored` — the frontmatter id doubles as the content key. Rich-Markdown
 *    authored docs (AuthoredRichMarkdownProvider) also carry an `authored`
 *    source, so they resolve here identically to plain authored docs and merge
 *    with other representations of the same content.
 *  - `structured` — registry-driven nodes. Schema-minted nodes (content-model
 *    entities) carry their canonical address as the JSON-LD `@id`; it is reused
 *    verbatim so the schema's addressing (`buildUrn` / `context.jsonld`) and
 *    this mechanism cannot drift. Structured nodes without an LD address get no
 *    identity from the source alone (their namespace is producer-scoped —
 *    `urn:structural:` vs `urn:structured:` — so producers mint it via
 *    {@link urnIdentity} before or instead of calling this).
 *  - `external` — provider-scoped: `urn:external:<provider>:<node id>`.
 *    Deterministic (provider ids derive from config). The `provider` and node
 *    `id` parts are percent-encoded via {@link urnBody} before joining, so the
 *    composition is injective: two distinct external (provider, id) pairs can
 *    never collide even when a part contains the `:` separator (which would
 *    otherwise let `('a','b:c')` and `('a:b','c')` conflate two real entities).
 *  - `person` — the stable, source-agnostic alias when present, else the
 *    GitHub login (back-compat: existing values used `login`).
 *  - `section` / `branch` / `repository` / `derived` — no identity: these are
 *    either sub-node projections or provider-local structural artifacts with
 *    no cross-provider counterpart to merge with.
 */
export function assignIdentity(node: KBNode): string | undefined {
  switch (node.source.type) {
    case 'file':         return urnIdentity('file', node.source.path);
    case 'authored':     return urnIdentity('content', node.id);
    case 'readme':       return urnIdentity('content', 'readme');
    case 'issue':        return urnIdentity('issue', node.source.number);
    case 'pull_request': return urnIdentity('pr', node.source.number);
    case 'commit':       return urnIdentity('commit', node.source.sha);
    case 'release':      return urnIdentity('release', node.source.tag);
    case 'person':       return urnIdentity('person', node.source.alias ?? node.source.login);
    case 'workflow':     return urnIdentity('structural', node.source.path);
    case 'external':     return urnIdentity('external', urnBody(node.source.provider, node.id));
    case 'structured': {
      // Schema-minted canonical address, reused from the LD envelope.
      const ldId = node.jsonld?.['@id'];
      if (typeof ldId === 'string' && ldId) return ldId;
      return undefined;
    }
    case 'section':      return undefined;
    default:             return undefined;
  }
}

/** Check if two nodes share an identity. */
export function shareIdentity(a: KBNode, b: KBNode): boolean {
  return !!(a.identity && b.identity && a.identity === b.identity);
}

/**
 * Build an identity index — maps identity URNs to all node IDs that share them.
 * Used by the view system to merge representations.
 */
export function buildIdentityIndex(nodes: KBNode[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.identity) continue;
    const existing = index.get(n.identity) ?? [];
    existing.push(n.id);
    index.set(n.identity, existing);
  }
  return index;
}
