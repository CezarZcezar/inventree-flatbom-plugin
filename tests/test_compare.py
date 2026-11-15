"""Unit tests for the BOM comparison logic (no InvenTree / database needed)."""

import unittest
from decimal import Decimal as D

from inventree_flat_bom.compare import (
    ADDED,
    CHANGED,
    REMOVED,
    REPLACED,
    UNCHANGED,
    BomLine,
    PartInfo,
    compare_flat,
    compare_tree,
    count_statuses,
    diff_references,
    jaccard,
)
from inventree_flat_bom.flatten import LeafPart


def line(sub, qty, ref='', **values):
    return BomLine(sub_part=sub, values={'quantity': D(qty), 'reference': ref, **values})


class Fake:
    """BOMs {assembly: [BomLine]} and part infos {pk: PartInfo}."""

    def __init__(self, bom, infos=None):
        self.bom = bom
        self.infos = infos or {}

    def get_lines(self, pk):
        return self.bom.get(pk, [])

    def info(self, pk):
        return self.infos.get(pk) or PartInfo(pk=pk, revision_root=pk, variant_family=1000 + pk, assembly=pk in self.bom)

    def tree(self, a, b, **kwargs):
        return compare_tree(a, b, self.get_lines, self.info, **kwargs)


def by_parts(nodes):
    return {(n.part_a, n.part_b): n for n in nodes}


class TreeTests(unittest.TestCase):
    def test_quantity_change_is_a_change(self):
        """The built-in 'different parts' mode misses this - here it is CHANGED."""
        fake = Fake({1: [line(100, 2), line(101, 1)], 2: [line(100, 3), line(101, 1)]})
        nodes = by_parts(fake.tree(1, 2))
        self.assertEqual(nodes[(100, 100)].status, CHANGED)
        self.assertEqual(nodes[(100, 100)].changes, [('quantity', D(2), D(3))])
        self.assertEqual(nodes[(101, 101)].status, UNCHANGED)

    def test_added_and_removed(self):
        fake = Fake({1: [line(100, 1)], 2: [line(101, 1)]})
        nodes = by_parts(fake.tree(1, 2))
        self.assertEqual(nodes[(100, None)].status, REMOVED)
        self.assertEqual(nodes[(None, 101)].status, ADDED)

    def test_reference_diff(self):
        fake = Fake({1: [line(100, 2, 'R1, R2')], 2: [line(100, 2, 'R1 R3')]})
        node = fake.tree(1, 2)[0]
        self.assertEqual(node.status, CHANGED)
        self.assertEqual((node.refs_added, node.refs_removed), (['R3'], ['R2']))
        self.assertEqual(node.changes, [])

    def test_other_fields(self):
        fake = Fake({1: [line(100, 1, optional=False, note='')], 2: [line(100, 1, optional=True, note=None)]})
        node = fake.tree(1, 2)[0]
        self.assertEqual(node.changes, [('optional', False, True)])  # '' == None for text

    def test_revision_of_sub_assembly_is_compared_inside(self):
        bom = {
            1: [line(10, 1), line(100, 1)],
            2: [line(11, 1), line(100, 1)],
            10: [line(200, 4, 'R1-R4'), line(201, 1)],
            11: [line(200, 5, 'R1-R4 R5'), line(202, 1)],
        }
        infos = {
            10: PartInfo(10, 'PCB', revision_root=10, variant_family=10, assembly=True),
            11: PartInfo(11, 'PCB', revision_root=10, variant_family=11, assembly=True),
        }
        nodes = by_parts(Fake(bom, infos).tree(1, 2))
        pcb = nodes[(10, 11)]
        self.assertEqual((pcb.status, pcb.reason), (REPLACED, 'revision'))
        inner = by_parts(pcb.children)
        self.assertEqual(inner[(200, 200)].status, CHANGED)
        self.assertEqual(inner[(201, None)].status, REMOVED)
        self.assertEqual(inner[(None, 202)].status, ADDED)
        self.assertEqual(nodes[(100, 100)].status, UNCHANGED)
        self.assertTrue(pcb.differs)

    def test_variant_and_ipn_pairing(self):
        infos = {
            10: PartInfo(10, revision_root=10, variant_family=7),
            11: PartInfo(11, revision_root=11, variant_family=7),
            20: PartInfo(20, ipn='X-1', revision_root=20, variant_family=20),
            21: PartInfo(21, ipn='X-1', revision_root=21, variant_family=21),
        }
        nodes = by_parts(Fake({1: [line(10, 1), line(20, 1)], 2: [line(11, 1), line(21, 1)]}, infos).tree(1, 2))
        self.assertEqual(nodes[(10, 11)].reason, 'variant')
        self.assertEqual(nodes[(20, 21)].reason, 'ipn')

    def test_similarity_pairing_is_optional(self):
        bom = {1: [line(10, 1)], 2: [line(11, 1)], 10: [line(100, 1)], 11: [line(100, 1)]}
        fake = Fake(bom)
        self.assertEqual({n.status for n in fake.tree(1, 2)}, {ADDED, REMOVED})

        nodes = fake.tree(1, 2, similarity=lambda a, b: 0.8, threshold=0.5)
        self.assertEqual(len(nodes), 1)
        self.assertEqual((nodes[0].status, nodes[0].reason, nodes[0].score), (REPLACED, 'similarity', 0.8))
        self.assertEqual(nodes[0].children[0].status, UNCHANGED)

        nodes = fake.tree(1, 2, similarity=lambda a, b: 0.3, threshold=0.5)
        self.assertEqual({n.status for n in nodes}, {ADDED, REMOVED})

    def test_stronger_reason_wins(self):
        infos = {
            10: PartInfo(10, ipn='A', revision_root=10, variant_family=10, assembly=True),
            11: PartInfo(11, ipn='A', revision_root=11, variant_family=11, assembly=True),
            12: PartInfo(12, revision_root=10, variant_family=12, assembly=True),
        }
        nodes = by_parts(Fake({1: [line(10, 1)], 2: [line(11, 1), line(12, 1)]}, infos).tree(1, 2))
        self.assertEqual(nodes[(10, 12)].reason, 'revision')
        self.assertEqual(nodes[(None, 11)].status, ADDED)

    def test_same_part_twice_paired_by_reference(self):
        fake = Fake({
            1: [line(100, 1, 'R1'), line(100, 2, 'R5, R6')],
            2: [line(100, 2, 'R5, R6'), line(100, 1, 'R1')],
        })
        self.assertEqual({n.status for n in fake.tree(1, 2)}, {UNCHANGED})

    def test_count_statuses(self):
        bom = {1: [line(10, 1), line(100, 1)], 2: [line(11, 1)], 10: [line(200, 1)], 11: [line(200, 2)]}
        infos = {10: PartInfo(10, revision_root=10, assembly=True), 11: PartInfo(11, revision_root=10, assembly=True)}
        counts = count_statuses(Fake(bom, infos).tree(1, 2))
        self.assertEqual(counts, {ADDED: 0, REMOVED: 1, CHANGED: 1, REPLACED: 1, UNCHANGED: 0})


class FlatTests(unittest.TestCase):
    def test_flat_diff(self):
        a = [LeafPart(100, D(10)), LeafPart(101, D(1)), LeafPart(102, D(2))]
        b = [LeafPart(100, D(12)), LeafPart(101, D(1)), LeafPart(103, D(4))]
        rows = {(r.part_a, r.part_b): r for r in compare_flat(a, b, Fake({}).info)}
        self.assertEqual(rows[(100, 100)].status, CHANGED)
        self.assertEqual(rows[(100, 100)].delta, D(2))
        self.assertEqual(rows[(101, 101)].status, UNCHANGED)
        self.assertEqual(rows[(102, None)].status, REMOVED)
        self.assertEqual(rows[(102, None)].delta, D(-2))
        self.assertEqual(rows[(None, 103)].status, ADDED)

    def test_flat_pairs_revisions(self):
        infos = {102: PartInfo(102, revision_root=102), 103: PartInfo(103, revision_root=102)}
        rows = compare_flat([LeafPart(102, D(2))], [LeafPart(103, D(3))], Fake({}, infos).info)
        self.assertEqual((rows[0].status, rows[0].reason, rows[0].delta), (REPLACED, 'revision', D(1)))
        rows = compare_flat([LeafPart(102, D(2))], [LeafPart(103, D(3))], Fake({}, infos).info, pair_relatives=False)
        self.assertEqual({r.status for r in rows}, {ADDED, REMOVED})


class HelperTests(unittest.TestCase):
    def test_diff_references(self):
        self.assertEqual(diff_references('R1, R2', 'R2;R3'), (['R3'], ['R1']))

    def test_jaccard(self):
        self.assertEqual(jaccard({1, 2}, {2, 3}), 1 / 3)
        self.assertEqual(jaccard(set(), set()), 1.0)


if __name__ == '__main__':
    unittest.main()
