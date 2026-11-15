"""Compare two BOMs: a structural (tree) diff and a flat (bottom-level) diff.

This module has no Django / InvenTree imports, so it can be unit tested on its own.

Tree diff
    BOM lines of A and B are matched level by level. Lines with the same sub-part
    are compared field by field. Lines which exist only on one side are paired as
    a *replacement* when the two parts are related (another revision, a variant of
    the same template, the same IPN or - optionally - a similar BOM). Replaced
    sub-assemblies are compared recursively, so the differences inside them are shown.

Flat diff
    Both BOMs are flattened (see flatten.py) and the bottom-level quantities are compared.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal

from .flatten import MAX_DEPTH, BomDepthError, BomLoopError, LeafPart, split_references

#: BOM line fields which are compared (same set as the InvenTree BOM comparison, plus the note)
FIELDS = [
    'quantity',
    'reference',
    'optional',
    'consumable',
    'allow_variants',
    'inherited',
    'setup_quantity',
    'attrition',
    'rounding_multiple',
    'note',
]

#: Statuses of a diff node / row
ADDED = 'added'  # only in B
REMOVED = 'removed'  # only in A
CHANGED = 'changed'  # same part, different BOM line fields
REPLACED = 'replaced'  # a related part (revision / variant / ...) took its place
UNCHANGED = 'unchanged'

#: Pairing reasons, strongest first
REASON_RANK = {'revision': 4, 'variant': 3, 'ipn': 2, 'similarity': 1}


@dataclass(frozen=True)
class PartInfo:
    """What the comparison needs to know about a part."""

    pk: int
    name: str = ''
    ipn: str = ''
    #: pk of the original part of a revision chain (own pk if not a revision)
    revision_root: int | None = None
    #: identifier of the variant (template) family, e.g. the MPTT tree id
    variant_family: int | None = None
    assembly: bool = False


@dataclass(frozen=True)
class BomLine:
    """One BOM line with the compared field values."""

    sub_part: int
    values: dict
    bom_item: int | None = None


@dataclass
class DiffNode:
    """One row of the tree diff."""

    status: str
    part_a: int | None
    part_b: int | None
    line_a: dict | None
    line_b: dict | None
    #: [(field, value in A, value in B)] - without 'reference', see refs_*
    changes: list = field(default_factory=list)
    refs_added: list = field(default_factory=list)
    refs_removed: list = field(default_factory=list)
    #: Why a replacement was paired ('revision', 'variant', 'ipn', 'similarity')
    reason: str | None = None
    #: BOM similarity (0..1) when reason == 'similarity'
    score: float | None = None
    children: list = field(default_factory=list)

    @property
    def differs(self) -> bool:
        """True if this row or anything below it differs."""
        return self.status != UNCHANGED or any(child.differs for child in self.children)


# ------------------------------------------------------------------ helpers


def diff_references(a: str, b: str) -> tuple[list, list]:
    """Return (added, removed) reference designators."""
    ref_a = split_references(a)
    ref_b = split_references(b)
    set_a, set_b = set(ref_a), set(ref_b)
    return [r for r in ref_b if r not in set_a], [r for r in ref_a if r not in set_b]


def values_equal(a, b) -> bool:
    """Compare field values (Decimals by value, None == '' for text)."""
    if isinstance(a, Decimal) or isinstance(b, Decimal):
        try:
            return Decimal(a or 0) == Decimal(b or 0)
        except Exception:
            return a == b
    if a in (None, '') and b in (None, ''):
        return True
    return a == b


def line_changes(a: dict, b: dict) -> tuple[list, list, list]:
    """Return (field changes, refs added, refs removed) between two BOM lines."""
    changes = []
    for name in FIELDS:
        if name == 'reference':
            continue
        if not values_equal(a.get(name), b.get(name)):
            changes.append((name, a.get(name), b.get(name)))
    added, removed = diff_references(a.get('reference', ''), b.get('reference', ''))
    return changes, added, removed


def jaccard(a: set, b: set) -> float:
    """Similarity of two sets (0..1)."""
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def relation(a: PartInfo, b: PartInfo) -> str | None:
    """How two different parts are related (strongest reason) or None."""
    if a.revision_root is not None and a.revision_root == b.revision_root:
        return 'revision'
    if a.variant_family is not None and a.variant_family == b.variant_family:
        return 'variant'
    if a.ipn and a.ipn == b.ipn:
        return 'ipn'
    return None


def pair_lines_same_part(lines_a: list[BomLine], lines_b: list[BomLine]) -> list[tuple]:
    """Pair lines of the same sub-part (a part can appear more than once in a BOM).

    Lines are paired by the overlap of their reference designators, then in order.
    Returns [(line_a or None, line_b or None)].
    """
    if len(lines_a) == 1 and len(lines_b) == 1:
        return [(lines_a[0], lines_b[0])]

    candidates = []
    for i, la in enumerate(lines_a):
        refs_a = set(split_references(la.values.get('reference', '')))
        for j, lb in enumerate(lines_b):
            refs_b = set(split_references(lb.values.get('reference', '')))
            candidates.append((jaccard(refs_a, refs_b) if refs_a or refs_b else 0.0, -i, -j, i, j))
    candidates.sort(reverse=True)

    used_a, used_b, pairs = set(), set(), []
    for _score, _ni, _nj, i, j in candidates:
        if i not in used_a and j not in used_b:
            used_a.add(i)
            used_b.add(j)
            pairs.append((lines_a[i], lines_b[j]))
    pairs += [(la, None) for i, la in enumerate(lines_a) if i not in used_a]
    pairs += [(None, lb) for j, lb in enumerate(lines_b) if j not in used_b]
    return pairs


def pair_related(
    only_a: list,
    only_b: list,
    info: Callable[[int], PartInfo],
    similarity: Callable[[int, int], float] | None = None,
    threshold: float = 0.5,
    key=lambda item: item.sub_part,
) -> tuple[list, list, list]:
    """Pair unmatched items of A and B which are related parts.

    Returns (pairs [(a, b, reason, score)], remaining A, remaining B).
    """
    candidates = []
    for i, a in enumerate(only_a):
        info_a = info(key(a))
        for j, b in enumerate(only_b):
            info_b = info(key(b))
            reason = relation(info_a, info_b)
            score = None
            if reason is None and similarity and info_a.assembly and info_b.assembly:
                score = similarity(info_a.pk, info_b.pk)
                if score >= threshold:
                    reason = 'similarity'
            if reason:
                candidates.append((REASON_RANK[reason], score or 0.0, -i, -j, i, j, reason))
    candidates.sort(reverse=True)

    used_a, used_b, pairs = set(), set(), []
    for _rank, score, _ni, _nj, i, j, reason in candidates:
        if i not in used_a and j not in used_b:
            used_a.add(i)
            used_b.add(j)
            pairs.append((only_a[i], only_b[j], reason, score if reason == 'similarity' else None))
    rest_a = [a for i, a in enumerate(only_a) if i not in used_a]
    rest_b = [b for j, b in enumerate(only_b) if j not in used_b]
    return pairs, rest_a, rest_b


# ---------------------------------------------------------------- tree diff


def compare_tree(
    part_a: int,
    part_b: int,
    get_lines: Callable[[int], list[BomLine]],
    info: Callable[[int], PartInfo],
    similarity: Callable[[int, int], float] | None = None,
    threshold: float = 0.5,
) -> list[DiffNode]:
    """Structural diff of the BOMs of part_a and part_b."""

    def compare(a: int, b: int, stack: tuple) -> list[DiffNode]:
        if (a, b) in stack:
            raise BomLoopError([p for pair in stack for p in pair] + [a, b])
        if len(stack) >= MAX_DEPTH:
            raise BomDepthError([a, b])
        stack = stack + ((a, b),)

        lines_a, lines_b = get_lines(a), get_lines(b)
        by_part_a: dict = {}
        by_part_b: dict = {}
        for line in lines_a:
            by_part_a.setdefault(line.sub_part, []).append(line)
        for line in lines_b:
            by_part_b.setdefault(line.sub_part, []).append(line)

        nodes = []
        only_a, only_b = [], []

        for sub in list(by_part_a) + [p for p in by_part_b if p not in by_part_a]:
            for la, lb in pair_lines_same_part(by_part_a.get(sub, []), by_part_b.get(sub, [])):
                if la and lb:
                    changes, added, removed = line_changes(la.values, lb.values)
                    status = CHANGED if (changes or added or removed) else UNCHANGED
                    nodes.append(DiffNode(status, sub, sub, la.values, lb.values, changes, added, removed))
                elif la:
                    only_a.append(la)
                else:
                    only_b.append(lb)

        pairs, rest_a, rest_b = pair_related(only_a, only_b, info, similarity, threshold)

        for la, lb, reason, score in pairs:
            changes, added, removed = line_changes(la.values, lb.values)
            node = DiffNode(REPLACED, la.sub_part, lb.sub_part, la.values, lb.values, changes, added, removed, reason, score)
            if info(la.sub_part).assembly or info(lb.sub_part).assembly:
                node.children = compare(la.sub_part, lb.sub_part, stack)
            nodes.append(node)

        nodes += [DiffNode(REMOVED, la.sub_part, None, la.values, None) for la in rest_a]
        nodes += [DiffNode(ADDED, None, lb.sub_part, None, lb.values) for lb in rest_b]
        return nodes

    return compare(part_a, part_b, ())


def count_statuses(nodes: list[DiffNode], counts: dict | None = None) -> dict:
    """Count the statuses of all nodes (recursively)."""
    counts = counts if counts is not None else {ADDED: 0, REMOVED: 0, CHANGED: 0, REPLACED: 0, UNCHANGED: 0}
    for node in nodes:
        counts[node.status] += 1
        count_statuses(node.children, counts)
    return counts


# ---------------------------------------------------------------- flat diff


@dataclass
class FlatDiffRow:
    """One row of the flat diff."""

    status: str
    part_a: int | None
    part_b: int | None
    quantity_a: Decimal
    quantity_b: Decimal
    leaf_a: LeafPart | None = None
    leaf_b: LeafPart | None = None
    reason: str | None = None

    @property
    def delta(self) -> Decimal:
        return self.quantity_b - self.quantity_a


def compare_flat(
    leaves_a: list[LeafPart],
    leaves_b: list[LeafPart],
    info: Callable[[int], PartInfo],
    pair_relatives: bool = True,
) -> list[FlatDiffRow]:
    """Diff of two flattened BOMs (bottom-level parts and summed quantities).

    With pair_relatives, a part only in A and a related part only in B (another
    revision / variant / same IPN) are shown as one replaced row.
    """
    by_a = {leaf.part: leaf for leaf in leaves_a}
    by_b = {leaf.part: leaf for leaf in leaves_b}

    rows = []
    for pk in [*by_a, *(pk for pk in by_b if pk not in by_a)]:
        if pk in by_a and pk in by_b:
            qa, qb = by_a[pk].quantity, by_b[pk].quantity
            rows.append(FlatDiffRow(CHANGED if qa != qb else UNCHANGED, pk, pk, qa, qb, by_a[pk], by_b[pk]))

    only_a = [leaf for pk, leaf in by_a.items() if pk not in by_b]
    only_b = [leaf for pk, leaf in by_b.items() if pk not in by_a]

    if pair_relatives:
        pairs, only_a, only_b = pair_related(only_a, only_b, info, key=lambda leaf: leaf.part)
        for la, lb, reason, _score in pairs:
            rows.append(FlatDiffRow(REPLACED, la.part, lb.part, la.quantity, lb.quantity, la, lb, reason))

    rows += [FlatDiffRow(REMOVED, leaf.part, None, leaf.quantity, Decimal(0), leaf_a=leaf) for leaf in only_a]
    rows += [FlatDiffRow(ADDED, None, leaf.part, Decimal(0), leaf.quantity, leaf_b=leaf) for leaf in only_b]
    return rows
