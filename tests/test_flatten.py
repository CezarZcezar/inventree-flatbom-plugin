"""Unit tests for the BOM flattening logic (no InvenTree / database needed).

Run with:  python -m unittest discover -s tests -v
"""

import unittest
from decimal import Decimal as D

from inventree_flat_bom.flatten import (
    BomDepthError,
    BomLoopError,
    Line,
    MAX_DEPTH,
    flatten_bom,
    fmt_decimal,
    shortage,
    split_references,
)


class FakeBom:
    """BOM given as {assembly: [Line, ...]}; parts with an entry are assemblies."""

    def __init__(self, bom, assemblies=()):
        self.bom = bom
        self.assemblies = set(bom) | set(assemblies)
        self.calls = {}

    def get_lines(self, pk):
        self.calls[pk] = self.calls.get(pk, 0) + 1
        return self.bom.get(pk, [])

    def is_assembly(self, pk):
        return pk in self.assemblies

    def flatten(self, root, **kwargs):
        return {leaf.part: leaf for leaf in flatten_bom(root, self.get_lines, self.is_assembly, **kwargs)}


# Part numbers: 1 = top assembly, 10/11 = sub-assemblies, 100+ = leaf parts
EXAMPLE = {
    1: [Line(10, D(2)), Line(11, D(1)), Line(100, D(3))],
    10: [Line(100, D(10)), Line(101, D('0.5'))],
    11: [Line(100, D(5))],
}


class FlattenTests(unittest.TestCase):
    def test_sums_leaf_parts_across_sub_assemblies(self):
        result = FakeBom(EXAMPLE).flatten(1)
        # 100: 2*10 (from 10) + 1*5 (from 11) + 3 (direct) = 28
        self.assertEqual(result[100].quantity, D(28))
        self.assertEqual(result[100].sources, {10: D(20), 11: D(5), 1: D(3)})
        self.assertEqual(result[101].quantity, D(1))
        # Sub-assemblies themselves are not listed
        self.assertNotIn(10, result)
        self.assertNotIn(11, result)

    def test_build_quantity_multiplies(self):
        result = FakeBom(EXAMPLE).flatten(1, quantity=D(4))
        self.assertEqual(result[100].quantity, D(112))
        self.assertEqual(result[100].sources[10], D(80))

    def test_deep_nesting(self):
        bom = {1: [Line(2, D(2))], 2: [Line(3, D(3))], 3: [Line(4, D(4))], 4: [Line(100, D(5))]}
        self.assertEqual(FakeBom(bom).flatten(1)[100].quantity, D(120))

    def test_sub_assembly_bom_loaded_once(self):
        bom = {1: [Line(10, D(1)), Line(11, D(1))], 10: [Line(20, D(1))], 11: [Line(20, D(2))], 20: [Line(100, D(1))]}
        fake = FakeBom(bom)
        self.assertEqual(fake.flatten(1)[100].quantity, D(3))
        self.assertEqual(fake.calls[20], 1)  # loaded once, expansion memoised

    def test_empty_assembly_is_a_leaf_with_flag(self):
        fake = FakeBom({1: [Line(10, D(2)), Line(100, D(1))]}, assemblies={10})
        result = fake.flatten(1)
        self.assertEqual(result[10].quantity, D(2))
        self.assertTrue(result[10].empty_bom)
        self.assertFalse(result[100].empty_bom)

    def test_non_assembly_root_or_empty_bom(self):
        self.assertEqual(FakeBom({}).flatten(1), {})

    def test_optional_flag_propagates_and_can_be_excluded(self):
        bom = {1: [Line(10, D(1), optional=True), Line(100, D(1))], 10: [Line(100, D(2)), Line(101, D(1))]}
        result = FakeBom(bom).flatten(1)
        self.assertTrue(result[100].optional)  # part of the quantity is optional
        self.assertTrue(result[101].optional)
        self.assertEqual(result[100].quantity, D(3))

        result = FakeBom(bom).flatten(1, include_optional=False)
        self.assertEqual(result[100].quantity, D(1))
        self.assertFalse(result[100].optional)
        self.assertNotIn(101, result)

    def test_consumable_flag(self):
        bom = {1: [Line(10, D(1), consumable=True)], 10: [Line(100, D(1))]}
        self.assertTrue(FakeBom(bom).flatten(1)[100].consumable)

    def test_loop_detected(self):
        bom = {1: [Line(10, D(1))], 10: [Line(11, D(1))], 11: [Line(10, D(1))]}
        with self.assertRaises(BomLoopError) as ctx:
            FakeBom(bom).flatten(1)
        self.assertEqual(ctx.exception.args[0], [10, 11, 10])

    def test_too_deep(self):
        bom = {i: [Line(i + 1, D(1))] for i in range(1, MAX_DEPTH + 5)}
        with self.assertRaises(BomDepthError):
            FakeBom(bom).flatten(1)


class ReferenceTests(unittest.TestCase):
    def test_references_merged_from_all_occurrences(self):
        bom = {
            1: [Line(10, D(2)), Line(11, D(1)), Line(100, D(1), reference='R10', bom_item=1)],
            10: [Line(100, D(2), reference='R1, R2', bom_item=2), Line(101, D(1), reference='C1', bom_item=3)],
            11: [Line(100, D(1), reference='R1;R5', bom_item=4)],
        }
        result = FakeBom(bom).flatten(1)
        self.assertEqual(result[100].references, ['R1', 'R2', 'R5', 'R10'])
        self.assertEqual(sorted(result[100].bom_items), [1, 2, 4])
        self.assertEqual(result[101].references, ['C1'])

    def test_references_of_skipped_optional_lines_are_dropped(self):
        bom = {1: [Line(100, D(1), reference='R1'), Line(100, D(1), optional=True, reference='R9')]}
        self.assertEqual(FakeBom(bom).flatten(1, include_optional=False)[100].references, ['R1'])

    def test_split_references(self):
        self.assertEqual(split_references('R1, R2;R3  R4'), ['R1', 'R2', 'R3', 'R4'])
        self.assertEqual(split_references(''), [])


class HelperTests(unittest.TestCase):
    def test_shortage(self):
        self.assertEqual(shortage(D(10), D(3)), D(7))
        self.assertEqual(shortage(D(3), D(10)), D(0))

    def test_fmt_decimal(self):
        self.assertEqual(fmt_decimal(D('2.500')), '2.5')
        self.assertEqual(fmt_decimal(D('1E+1')), '10')
        self.assertEqual(fmt_decimal(D('0.00010')), '0.0001')
        self.assertEqual(fmt_decimal(None), '')


if __name__ == '__main__':
    unittest.main()
