import type { EdgeId, EdgeKind } from '../../shared/protocol';

export function makeEdge(kind: EdgeKind, r: number, c: number): EdgeId {
  return `${kind}:${r}:${c}`;
}
