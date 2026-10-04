// The public page, public search and (through guide.js) the public guide read ONLY the bundled
// facts file. This module imports nothing that touches D1, R2 or Vectorize.
import { PUBLIC_FACTS } from '../public-facts.js';

export function publicFactsTree(facts = PUBLIC_FACTS) {
  return {
    founders: facts.founders.map((first, i) => ({ id: `f${i}`, first: String(first), role: 'founder' })),
    branches: facts.branchParents.map((first, i) => ({ id: `b${i}`, first: String(first), role: 'branch', star: i })),
  };
}

export function publicFactsSearch(q, facts = PUBLIC_FACTS) {
  const t = String(q || '').trim().toLowerCase().slice(0, 40);
  if (!t) return [];
  const tree = publicFactsTree(facts);
  return [...tree.founders, ...tree.branches].filter((p) => p.first.toLowerCase().includes(t)).slice(0, 10);
}
