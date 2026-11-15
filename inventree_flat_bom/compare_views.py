"""HTTP views of the BOM Compare panel."""

from __future__ import annotations

import re
from decimal import Decimal

from django.http import Http404, HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .compare import (
    UNCHANGED,
    BomLine,
    PartInfo,
    compare_flat,
    compare_tree,
    count_statuses,
    jaccard,
)
from .flatten import BomDepthError, BomLoopError, flatten_bom, fmt_decimal
from .views import (
    FORMATS,
    as_json,
    bom_error,
    can_view_parts,
    can_view_stock,
    parse_bool,
    parse_quantity,
    part_pricing,
    sanitize,
    shortage,
)

#: Maximum length of a revision chain which is followed
MAX_REVISION_CHAIN = 20


class CompareLoader:
    """Load BOM lines and part information from the database (cached)."""

    def __init__(self):
        from part.models import Part

        self.Part = Part
        self.lines: dict[int, list[BomLine]] = {}
        self.parts: dict[int, object] = {}
        self.infos: dict[int, PartInfo] = {}
        self.leaf_families: dict[int, set] = {}

    # ----------------------------------------------------------- parts

    def part(self, pk: int):
        if pk not in self.parts:
            self.parts[pk] = self.Part.objects.get(pk=pk)
        return self.parts[pk]

    def revision_root(self, part) -> int:
        """pk of the first part of the revision chain."""
        seen = set()
        while part.revision_of_id and part.revision_of_id not in seen and len(seen) < MAX_REVISION_CHAIN:
            seen.add(part.pk)
            part = self.part(part.revision_of_id)
        return part.pk

    def info(self, pk: int) -> PartInfo:
        if pk not in self.infos:
            p = self.part(pk)
            self.infos[pk] = PartInfo(
                pk=p.pk,
                name=p.name,
                ipn=p.IPN or '',
                revision_root=self.revision_root(p),
                # Part is an MPTT tree on 'variant_of': the tree id identifies the template family
                variant_family=p.tree_id,
                assembly=bool(p.assembly),
            )
        return self.infos[pk]

    # ------------------------------------------------------------- BOM

    def get_lines(self, pk: int) -> list[BomLine]:
        if pk not in self.lines:
            part = self.part(pk)
            lines = []
            if part.assembly:
                items = part.get_bom_items(include_inherited=True, include_virtual=True).select_related('sub_part')
                for item in items:
                    self.parts.setdefault(item.sub_part_id, item.sub_part)
                    lines.append(
                        BomLine(
                            sub_part=item.sub_part_id,
                            bom_item=item.pk,
                            values={
                                'quantity': Decimal(item.quantity),
                                'reference': item.reference or '',
                                'optional': bool(item.optional),
                                'consumable': bool(item.consumable),
                                'allow_variants': bool(item.allow_variants),
                                'inherited': bool(item.inherited),
                                'setup_quantity': Decimal(item.setup_quantity or 0),
                                'attrition': Decimal(item.attrition or 0),
                                'rounding_multiple': Decimal(item.rounding_multiple) if item.rounding_multiple else None,
                                'note': item.note or '',
                            },
                        )
                    )
            self.lines[pk] = lines
        return self.lines[pk]

    def is_assembly(self, pk: int) -> bool:
        return bool(self.part(pk).assembly)

    def flat_lines(self, pk: int):
        """Lines in the format of flatten.py."""
        from .flatten import Line

        return [
            Line(
                sub_part=line.sub_part,
                quantity=line.values['quantity'],
                optional=line.values['optional'],
                consumable=line.values['consumable'],
                reference=line.values['reference'],
                bom_item=line.bom_item,
            )
            for line in self.get_lines(pk)
        ]

    def flatten(self, pk: int, quantity=Decimal(1), include_optional=True):
        return flatten_bom(pk, self.flat_lines, self.is_assembly, quantity, include_optional)

    def similarity(self, a: int, b: int) -> float:
        """Similarity of two assemblies: Jaccard index of their bottom-level parts.

        Revisions of the same part count as the same part, so a sub-assembly which
        only moved to a new revision does not lower the similarity.
        """
        for pk in (a, b):
            if pk not in self.leaf_families:
                self.leaf_families[pk] = {self.info(leaf.part).revision_root for leaf in self.flatten(pk)}
        return jaccard(self.leaf_families[a], self.leaf_families[b])


# ------------------------------------------------------------- serialising


def part_summary(part) -> dict:
    """Part fields shown in the comparison."""
    return {
        'pk': part.pk,
        'name': part.name,
        'display_name': f'{part.name} | {part.revision}' if part.revision else part.name,
        'full_name': part.full_name,
        'ipn': part.IPN or '',
        'revision': part.revision or '',
        'description': part.description or '',
        'units': part.units or '',
        'assembly': bool(part.assembly),
        'url': part.get_absolute_url(),
        'thumbnail': part.get_thumbnail_url(),
    }


def json_value(value):
    if isinstance(value, Decimal):
        return fmt_decimal(value)
    return value


def node_json(node, loader: CompareLoader, path: str = '0') -> dict:
    """Serialise a DiffNode (recursively)."""
    return {
        'key': path,
        'status': node.status,
        'reason': node.reason,
        'score': round(node.score, 3) if node.score is not None else None,
        'part_a': part_summary(loader.part(node.part_a)) if node.part_a else None,
        'part_b': part_summary(loader.part(node.part_b)) if node.part_b else None,
        'line_a': {k: json_value(v) for k, v in node.line_a.items()} if node.line_a else None,
        'line_b': {k: json_value(v) for k, v in node.line_b.items()} if node.line_b else None,
        'changes': [{'field': f, 'a': json_value(a), 'b': json_value(b)} for f, a, b in node.changes],
        'refs_added': node.refs_added,
        'refs_removed': node.refs_removed,
        'differs': node.differs,
        'children': [node_json(child, loader, f'{path}.{i}') for i, child in enumerate(sort_nodes(node.children, loader))],
    }


def sort_nodes(nodes, loader: CompareLoader):
    """Sort by IPN, then name (of A, or B for added parts)."""

    def key(node):
        p = loader.part(node.part_a or node.part_b)
        return ((p.IPN or '~').lower(), p.name.lower())

    return sorted(nodes, key=key)


# ------------------------------------------------------------------ request


def load_compare_request(request, pk_a: int, pk_b: int):
    """Permissions, parts and options. Returns a dict or an HttpResponse."""
    from part.models import Part

    if not can_view_parts(request.user):
        return HttpResponseForbidden('Insufficient permissions (part: view)')

    try:
        part_a = Part.objects.get(pk=pk_a)
        part_b = Part.objects.get(pk=pk_b)
    except Part.DoesNotExist:
        raise Http404('Part not found')

    try:
        quantity = parse_quantity(request.GET.get('quantity'))
        threshold = Decimal(request.GET.get('threshold') or '0.5')
    except (ValueError, ArithmeticError):
        return HttpResponseBadRequest('Invalid quantity or threshold')

    if not 0 < threshold <= 1:
        return HttpResponseBadRequest('Threshold must be between 0 and 1')

    return {
        'part_a': part_a,
        'part_b': part_b,
        'quantity': quantity,
        'include_optional': parse_bool(request.GET.get('optional'), True),
        'similarity': parse_bool(request.GET.get('similarity'), False),
        'threshold': float(threshold),
        'pair_relatives': parse_bool(request.GET.get('pair'), True),
        'with_stock': can_view_stock(request.user),
    }


def build_tree(opts: dict, loader: CompareLoader):
    return compare_tree(
        opts['part_a'].pk,
        opts['part_b'].pk,
        loader.get_lines,
        loader.info,
        similarity=loader.similarity if opts['similarity'] else None,
        threshold=opts['threshold'],
    )


def build_flat(opts: dict, loader: CompareLoader) -> list[dict]:
    """Flat diff rows with pricing and stock."""
    from part.models import Part
    from part.serializers import PartSerializer

    leaves_a = loader.flatten(opts['part_a'].pk, opts['quantity'], opts['include_optional'])
    leaves_b = loader.flatten(opts['part_b'].pk, opts['quantity'], opts['include_optional'])
    rows = compare_flat(leaves_a, leaves_b, loader.info, opts['pair_relatives'])

    pks = {pk for row in rows for pk in (row.part_a, row.part_b) if pk}
    parts = Part.objects.filter(pk__in=pks).select_related('pricing_data')
    if opts['with_stock']:
        parts = PartSerializer.annotate_queryset(parts)
    parts = {p.pk: p for p in parts}

    source_pks = {pk for leaf in leaves_a + leaves_b for pk in leaf.sources}
    source_names = dict((p.pk, p.full_name) for p in Part.objects.filter(pk__in=source_pks))

    def sources(leaf):
        if not leaf:
            return []
        return sorted(
            ({'pk': pk, 'name': source_names.get(pk, str(pk)), 'quantity': qty} for pk, qty in leaf.sources.items()),
            key=lambda s: s['name'].lower(),
        )

    result = []
    for row in rows:
        pa = parts.get(row.part_a)
        pb = parts.get(row.part_b)
        price_a = part_pricing(pa) if pa else (None, None, '')
        price_b = part_pricing(pb) if pb else (None, None, '')

        def cost(price, qty):
            low, high, _currency = price
            return (low * qty if low is not None else None, high * qty if high is not None else None)

        cost_a = cost(price_a, row.quantity_a)
        cost_b = cost(price_b, row.quantity_b)

        def delta(i):
            a = cost_a[i] if row.quantity_a else Decimal(0)
            b = cost_b[i] if row.quantity_b else Decimal(0)
            return None if a is None or b is None else b - a

        item = {
            'key': f'{row.part_a or 0}-{row.part_b or 0}',
            'status': row.status,
            'reason': row.reason,
            'part_a': part_summary(pa) if pa else None,
            'part_b': part_summary(pb) if pb else None,
            'quantity_a': row.quantity_a,
            'quantity_b': row.quantity_b,
            'delta': row.delta,
            'currency': price_b[2] or price_a[2],
            'cost_a_min': cost_a[0], 'cost_a_max': cost_a[1],
            'cost_b_min': cost_b[0], 'cost_b_max': cost_b[1],
            'cost_delta_min': delta(0), 'cost_delta_max': delta(1),
            'references_a': ', '.join(row.leaf_a.references) if row.leaf_a else '',
            'references_b': ', '.join(row.leaf_b.references) if row.leaf_b else '',
            'sources_a': sources(row.leaf_a),
            'sources_b': sources(row.leaf_b),
        }

        if opts['with_stock']:
            # Stock of the part which is needed for B (the compared BOM)
            p = pb or pa
            available = Decimal(p.unallocated_stock or 0)
            item.update({
                'available': available,
                'shortage_b': None if (pb is None or pb.virtual) else shortage(row.quantity_b, available),
            })

        result.append(item)

    result.sort(key=lambda r: (((r['part_a'] or r['part_b'])['ipn'] or '~').lower(), (r['part_a'] or r['part_b'])['name'].lower()))
    return result


@require_GET
def compare_view(request, pk_a: int, pk_b: int):
    """JSON: tree diff, flat diff and summary."""
    opts = load_compare_request(request, pk_a, pk_b)
    if isinstance(opts, HttpResponse):
        return opts

    loader = CompareLoader()
    try:
        tree = build_tree(opts, loader)
        flat = build_flat(opts, loader)
    except (BomLoopError, BomDepthError) as exc:
        return JsonResponse({'error': bom_error(exc)}, status=400)

    counts = count_statuses(tree)
    flat_counts = {}
    for row in flat:
        flat_counts[row['status']] = flat_counts.get(row['status'], 0) + 1

    return JsonResponse(as_json({
        'part_a': part_summary(opts['part_a']),
        'part_b': part_summary(opts['part_b']),
        'quantity': opts['quantity'],
        'with_stock': opts['with_stock'],
        'tree': [node_json(node, loader, str(i)) for i, node in enumerate(sort_nodes(tree, loader))],
        'tree_counts': counts,
        'flat': flat,
        'flat_counts': flat_counts,
    }))


# ------------------------------------------------------------------ related


@require_GET
def related_view(request, pk: int):
    """Other revisions and variants of an assembly (quick picks for the comparison)."""
    from part.models import Part

    if not can_view_parts(request.user):
        return HttpResponseForbidden('Insufficient permissions (part: view)')

    try:
        part = Part.objects.get(pk=pk)
    except Part.DoesNotExist:
        raise Http404('Part not found')

    loader = CompareLoader()
    root = loader.revision_root(part)

    revisions = Part.objects.filter(assembly=True).filter(pk=root) | Part.objects.filter(assembly=True, revision_of=root)
    # Revisions of revisions (if the chain is longer)
    revision_pks = set(revisions.values_list('pk', flat=True))
    frontier = set(revision_pks)
    for _ in range(MAX_REVISION_CHAIN):
        frontier = set(Part.objects.filter(revision_of__in=frontier, assembly=True).values_list('pk', flat=True)) - revision_pks
        if not frontier:
            break
        revision_pks |= frontier

    variants = Part.objects.filter(tree_id=part.tree_id, assembly=True).exclude(pk__in=revision_pks)

    def items(queryset):
        return [part_summary(p) for p in queryset.exclude(pk=part.pk).order_by('name', 'revision')[:50]]

    return JsonResponse({
        'revisions': items(Part.objects.filter(pk__in=revision_pks)),
        'variants': items(variants),
    })


# ------------------------------------------------------------------- export


def flatten_tree_rows(nodes: list[dict], level: int = 1, path: str = ''):
    """Walk the serialised tree depth-first: yields (level, path, node)."""
    for node in nodes:
        part = node['part_a'] or node['part_b']
        name = part['full_name']
        yield level, path, node
        yield from flatten_tree_rows(node['children'], level + 1, f'{path} / {name}' if path else name)


@require_GET
def compare_export_view(request, pk_a: int, pk_b: int, fmt: str):
    """Download the comparison (?view=tree|flat, ?only_diff=1)."""
    import tablib

    if fmt not in FORMATS:
        raise Http404('Unknown export format')

    opts = load_compare_request(request, pk_a, pk_b)
    if isinstance(opts, HttpResponse):
        return opts

    view = request.GET.get('view', 'tree')
    only_diff = parse_bool(request.GET.get('only_diff'), False)
    numeric = fmt == 'xlsx'

    def num(value):
        if value is None or value == '':
            return ''
        return float(Decimal(value)) if numeric else fmt_decimal(Decimal(value))

    loader = CompareLoader()
    try:
        if view == 'flat':
            rows = build_flat(opts, loader)
        else:
            tree = [node_json(node, loader, str(i)) for i, node in enumerate(sort_nodes(build_tree(opts, loader), loader))]
    except (BomLoopError, BomDepthError) as exc:
        return HttpResponseBadRequest(bom_error(exc))

    if view == 'flat':
        headers = ['Status', 'Pairing', 'IPN A', 'Component A', 'IPN B', 'Component B', 'Quantity A', 'Quantity B',
                   'Delta', 'Units', 'Reference A', 'Reference B', 'Currency', 'Cost A Min', 'Cost A Max',
                   'Cost B Min', 'Cost B Max', 'Cost Delta Min', 'Cost Delta Max', 'Used In A', 'Used In B']
        if opts['with_stock']:
            headers += ['Available Stock', 'Shortage B']
        data = []
        for r in rows:
            if only_diff and r['status'] == UNCHANGED:
                continue
            a, b = r['part_a'] or {}, r['part_b'] or {}
            line = [
                r['status'], r['reason'] or '',
                sanitize(a.get('ipn', '')), sanitize(a.get('display_name', '')),
                sanitize(b.get('ipn', '')), sanitize(b.get('display_name', '')),
                num(r['quantity_a']), num(r['quantity_b']), num(r['delta']),
                sanitize((b or a).get('units', '')),
                sanitize(r['references_a']), sanitize(r['references_b']),
                r['currency'],
                num(r['cost_a_min']), num(r['cost_a_max']), num(r['cost_b_min']), num(r['cost_b_max']),
                num(r['cost_delta_min']), num(r['cost_delta_max']),
                sanitize('; '.join(f"{s['name']}: {fmt_decimal(s['quantity'])}" for s in r['sources_a'])),
                sanitize('; '.join(f"{s['name']}: {fmt_decimal(s['quantity'])}" for s in r['sources_b'])),
            ]
            if opts['with_stock']:
                line += [num(r['available']), num(r['shortage_b'])]
            data.append(line)
    else:
        headers = ['Level', 'Path', 'Status', 'Pairing', 'IPN A', 'Component A', 'IPN B', 'Component B',
                   'Quantity A', 'Quantity B', 'Delta', 'Reference A', 'Reference B', 'References Added',
                   'References Removed', 'Changed Fields']
        data = []
        for level, path, node in flatten_tree_rows(tree):
            if only_diff and not node['differs']:
                continue
            a, b = node['part_a'] or {}, node['part_b'] or {}
            la, lb = node['line_a'] or {}, node['line_b'] or {}
            qa, qb = la.get('quantity'), lb.get('quantity')
            delta = (Decimal(qb or 0) - Decimal(qa or 0)) if (qa is not None or qb is not None) else None
            reason = node['reason'] or ''
            if reason == 'similarity' and node['score'] is not None:
                reason = f'similarity {round(node["score"] * 100)}%'
            changed = '; '.join(
                f"{c['field']}: {c['a'] if c['a'] not in (None, '') else '-'} → {c['b'] if c['b'] not in (None, '') else '-'}"
                for c in node['changes']
            )
            data.append([
                level, sanitize(path), node['status'], reason,
                sanitize(a.get('ipn', '')), sanitize(a.get('display_name', '')),
                sanitize(b.get('ipn', '')), sanitize(b.get('display_name', '')),
                num(qa), num(qb), num(delta) if delta is not None else '',
                sanitize(la.get('reference', '')), sanitize(lb.get('reference', '')),
                sanitize(', '.join(node['refs_added'])), sanitize(', '.join(node['refs_removed'])),
                sanitize(changed),
            ])

    dataset = tablib.Dataset(*data, headers=headers, title='BOM Compare')

    def short(part):
        return re.sub(r'[^A-Za-z0-9._-]+', '_', part.IPN or part.name).strip('_') or str(part.pk)

    filename = f'bom_compare_{short(opts["part_a"])}_vs_{short(opts["part_b"])}_{view}_{timezone.localdate().isoformat()}.{fmt}'
    response = HttpResponse(dataset.export(fmt), content_type=FORMATS[fmt])
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
