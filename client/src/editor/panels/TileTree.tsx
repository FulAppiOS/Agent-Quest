import { useMemo, useState } from 'react';
import type { DecorationManifest } from '../types/map';

export interface TreeNode {
  name: string;
  fullKey: string;
  children: Map<string, TreeNode>;
  assetCount: number;
}

interface Props {
  decorations: DecorationManifest[];
  selected: string;
  onSelect(folderKey: string): void;
}

export function TileTree({ decorations, selected, onSelect }: Props) {
  const root = useMemo(() => buildTree(decorations), [decorations]);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());

  const toggle = (key: string): void => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
    saveExpanded(next);
  };

  return (
    <div className="tile-tree">
      {Array.from(root.children.values()).map((child) => (
        <TreeRow
          key={child.fullKey}
          node={child}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle(key: string): void;
  selected: string;
  onSelect(key: string): void;
}

function TreeRow({ node, depth, expanded, onToggle, selected, onSelect }: RowProps) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.fullKey);
  const isSelected = selected === node.fullKey;
  const pad = depth * 12 + 4;
  return (
    <>
      <button
        type="button"
        className={`tile-tree-row${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: pad }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (hasChildren && target.dataset.role === 'chevron') {
            onToggle(node.fullKey);
            return;
          }
          onSelect(node.fullKey);
          if (hasChildren && !isExpanded) onToggle(node.fullKey);
        }}
      >
        {hasChildren ? (
          <span data-role="chevron" className="tile-tree-chevron">
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span className="tile-tree-chevron" />
        )}
        <span className="tile-tree-name">{node.name}</span>
        <span className="tile-tree-count">{node.assetCount}</span>
      </button>
      {hasChildren && isExpanded && Array.from(node.children.values()).map((child) => (
        <TreeRow
          key={child.fullKey}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

/** Legacy v2 manifest entries have no folderPath — fall back to the
 * single-segment `group` so they still render as top-level tree nodes. */
export function folderSegments(d: DecorationManifest): string[] {
  if (d.folderPath !== undefined && d.folderPath.length > 0) return d.folderPath;
  return d.group !== '' ? [d.group] : [];
}

export function buildTree(decorations: DecorationManifest[]): TreeNode {
  const root: TreeNode = { name: '', fullKey: '', children: new Map(), assetCount: 0 };
  for (const d of decorations) {
    const segs = folderSegments(d);
    if (segs.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i]!;
      const fullKey = segs.slice(0, i + 1).join('/');
      let next = cursor.children.get(name);
      if (next === undefined) {
        next = { name, fullKey, children: new Map(), assetCount: 0 };
        cursor.children.set(name, next);
      }
      cursor = next;
    }
  }
  const countsByKey = new Map<string, number>();
  for (const d of decorations) {
    const segs = folderSegments(d);
    for (let i = 1; i <= segs.length; i++) {
      const key = segs.slice(0, i).join('/');
      countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
    }
  }
  const visit = (node: TreeNode): void => {
    node.assetCount = countsByKey.get(node.fullKey) ?? 0;
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return root;
}

const LS_KEY = 'cc0.tree.expanded';
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw !== null) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}
function saveExpanded(set: Set<string>): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
}
