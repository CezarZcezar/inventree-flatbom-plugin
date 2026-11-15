"""Flatten a multi-level BOM into its bottom-level (leaf) parts.

This module has no Django / InvenTree imports, so it can be unit tested on its own.

Sub-assemblies which have a BOM are expanded (and not listed themselves); the
quantities of the same leaf part coming from different sub-assemblies are summed.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from decimal import Decimal

#: Maximum BOM depth (protects against runaway data)
MAX_DEPTH = 50


@dataclass(frozen=True)
class Line:
    """One BOM line: `quantity` of `sub_part` per one unit of the parent assembly."""

    sub_part: int
    quantity: Decimal
    optional: bool = False
    consumable: bool = False
    #: Reference designators of this BOM line (e.g. "R1, R2")
    reference: str = ''
    #: pk of the BomItem (used to look up substitutes)
    bom_item: int | None = None


@dataclass
class LeafPart:
    """A bottom-level part with the summed required quantity."""

    part: int
    quantity: Decimal = Decimal(0)
    #: assembly pk -> quantity coming from the BOM of that assembly
    sources: dict = field(default_factory=dict)
    #: True if (part of) the quantity comes from an optional BOM line (at any level)
    optional: bool = False
    #: True if (part of) the quantity comes from a consumable BOM line
    consumable: bool = False
    #: The part is an assembly, but its BOM is empty
    empty_bom: bool = False
    #: Reference designators from all BOM lines of this part (unique, in BOM order)
    references: list = field(default_factory=list)
    #: pks of all BomItems which contribute to this part
    bom_items: list = field(default_factory=list)


def split_references(reference: str) -> list[str]:
    """Split a reference string ("R1, R2;R3 R4") into designators."""
    return [token for token in re.split(r'[,;\s]+', reference or '') if token]


def merge_unique(target: list, values: Iterable) -> None:
    """Append values which are not in the list yet (keeps the order)."""
    seen = set(target)
    for value in values:
        if value not in seen:
            seen.add(value)
            target.append(value)


class BomLoopError(ValueError):
    """The BOM contains a loop (a part which contains itself)."""


class BomDepthError(ValueError):
    """The BOM is deeper than MAX_DEPTH levels."""


# Contribution key: (leaf part, source assembly, optional, consumable) -> quantity per 1 unit
Contributions = dict


def flatten_bom(
    root: int,
    get_lines: Callable[[int], list[Line]],
    is_assembly: Callable[[int], bool],
    quantity: Decimal = Decimal(1),
    include_optional: bool = True,
) -> list[LeafPart]:
    """Return the bottom-level parts needed to build `quantity` of `root`.

    Arguments:
        root: pk of the top level assembly
        get_lines: Return the BOM lines of an assembly (called once per assembly)
        is_assembly: Return True if the part is an assembly
        quantity: Number of top level assemblies to build
        include_optional: If False, optional BOM lines (and everything below them) are skipped

    Returns:
        Leaf parts in order of first appearance in the BOM
    """
    memo: dict[int, Contributions] = {}
    # part -> {leaf: (references, bom items)} for one unit of the part
    details_memo: dict[int, dict] = {}
    empty_assemblies: set[int] = set()
    lines_cache: dict[int, list[Line]] = {}

    def lines_of(part: int) -> list[Line]:
        """BOM lines of a part (loaded once; non-assemblies have none)."""
        if part not in lines_cache:
            lines_cache[part] = list(get_lines(part)) if (part == root or is_assembly(part)) else []
        return lines_cache[part]

    def expand(part: int, stack: tuple) -> Contributions:
        """Contributions for one unit of `part`."""
        if part in memo:
            return memo[part]

        if part in stack:
            raise BomLoopError(list(stack[stack.index(part):]) + [part])

        if len(stack) >= MAX_DEPTH:
            raise BomDepthError(list(stack) + [part])

        result: Contributions = {}
        details: dict = {}

        def add(key, qty):
            result[key] = result.get(key, Decimal(0)) + qty

        def add_details(leaf, references, bom_items):
            refs, items = details.setdefault(leaf, ([], []))
            merge_unique(refs, references)
            merge_unique(items, bom_items)

        for line in lines_of(part):
            if line.optional and not include_optional:
                continue

            sub = line.sub_part
            if lines_of(sub):
                # Sub-assembly with a BOM: expand it, the flags of this line apply to everything below
                for (leaf, source, optional, consumable), qty in expand(sub, stack + (part,)).items():
                    add((leaf, source, optional or line.optional, consumable or line.consumable), qty * line.quantity)
                for leaf, (refs, items) in details_memo[sub].items():
                    add_details(leaf, refs, items)
            else:
                if is_assembly(sub):
                    empty_assemblies.add(sub)
                add((sub, part, line.optional, line.consumable), line.quantity)
                add_details(sub, split_references(line.reference), [line.bom_item] if line.bom_item else [])

        memo[part] = result
        details_memo[part] = details
        return result

    leaves: dict[int, LeafPart] = {}
    contributions = expand(root, ())

    for (leaf, source, optional, consumable), qty in contributions.items():
        item = leaves.setdefault(leaf, LeafPart(part=leaf, empty_bom=leaf in empty_assemblies))
        total = qty * quantity
        item.quantity += total
        item.sources[source] = item.sources.get(source, Decimal(0)) + total
        item.optional = item.optional or optional
        item.consumable = item.consumable or consumable

    for leaf, (refs, items) in details_memo[root].items():
        if leaf in leaves:
            leaves[leaf].references = list(refs)
            leaves[leaf].bom_items = list(items)

    return list(leaves.values())


def shortage(required: Decimal, available: Decimal) -> Decimal:
    """Missing quantity (never negative)."""
    return max(Decimal(0), required - available)


def fmt_decimal(value) -> str:
    """Format a Decimal without trailing zeros or exponent (e.g. 2.50 -> '2.5', 1E+1 -> '10')."""
    if value is None:
        return ''
    value = Decimal(value)
    if value == value.to_integral_value():
        return str(value.quantize(Decimal(1)))
    return format(value.normalize(), 'f')
