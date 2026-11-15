"""HTTP views of the Flat BOM plugin."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.http import Http404, HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .flatten import BomDepthError, BomLoopError, Line, flatten_bom, fmt_decimal, shortage

STATIC_DIR = Path(__file__).parent / 'static'
#: Panel scripts which may be served
PANEL_SCRIPTS = ('flat_bom.js', 'bom_compare.js')

FORMATS = {
    'csv': 'text/csv; charset=utf-8',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

#: Maximum build quantity accepted from the UI
MAX_QUANTITY = Decimal('1000000')

# Leading characters which spreadsheet applications interpret as a formula (CSV injection)
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def can_view_parts(user) -> bool:
    """The user must be logged in and have the 'part: view' role."""
    from users.permissions import check_user_role

    return bool(user and user.is_authenticated and check_user_role(user, 'part', 'view'))


def can_view_stock(user) -> bool:
    """Stock columns are only shown with the 'stock: view' role."""
    from users.permissions import check_user_role

    return check_user_role(user, 'stock', 'view')


def parse_quantity(value) -> Decimal:
    """Parse the build quantity (default 1). Raises ValueError for invalid values."""
    if value in (None, ''):
        return Decimal(1)
    try:
        qty = Decimal(str(value).replace(',', '.'))
    except InvalidOperation:
        raise ValueError('Invalid quantity')
    if not qty.is_finite() or qty <= 0 or qty > MAX_QUANTITY:
        raise ValueError('Quantity must be greater than 0')
    return qty


def parse_bool(value, default: bool) -> bool:
    """Parse a boolean query parameter."""
    if value in (None, ''):
        return default
    return str(value).lower() in ('1', 'true', 'yes', 'on')


class BomLoader:
    """Load BOM lines from the database, once per assembly."""

    def __init__(self):
        from part.models import Part

        self.Part = Part
        self.lines: dict[int, list[Line]] = {}
        self.assembly: dict[int, bool] = {}

    def is_assembly(self, pk: int) -> bool:
        if pk not in self.assembly:
            self.assembly[pk] = bool(self.Part.objects.filter(pk=pk, assembly=True).exists())
        return self.assembly[pk]

    def get_lines(self, pk: int) -> list[Line]:
        if pk not in self.lines:
            part = self.Part.objects.get(pk=pk)
            items = part.get_bom_items(include_inherited=True, include_virtual=True).select_related('sub_part')
            lines = []
            for item in items:
                self.assembly[item.sub_part_id] = bool(item.sub_part.assembly)
                lines.append(
                    Line(
                        sub_part=item.sub_part_id,
                        quantity=Decimal(item.quantity),
                        optional=bool(item.optional),
                        consumable=bool(item.consumable),
                        reference=item.reference or '',
                        bom_item=item.pk,
                    )
                )
            self.lines[pk] = lines
        return self.lines[pk]


def part_pricing(part):
    """Return (min, max, currency) of the cached part pricing, or (None, None, '')."""
    try:
        pricing = part.pricing_data
    except Exception:  # no PartPricing record yet
        return None, None, ''

    low, high = pricing.overall_min, pricing.overall_max
    currency = str((low or high).currency) if (low or high) is not None else ''
    return (
        Decimal(low.amount) if low is not None else None,
        Decimal(high.amount) if high is not None else None,
        currency,
    )


def build_flat_bom(part, quantity: Decimal, include_optional: bool, with_stock: bool, queryset_hook=None) -> list[dict]:
    """Return the flat BOM rows for `quantity` of `part` (sorted by IPN, name).

    Keys starting with an underscore hold objects for the export and are not sent as JSON.
    `queryset_hook` can add prefetches to the leaf part queryset.
    """
    from part.models import Part
    from part.serializers import PartSerializer

    loader = BomLoader()
    leaves = flatten_bom(part.pk, loader.get_lines, loader.is_assembly, quantity, include_optional)

    leaf_parts = Part.objects.filter(pk__in=[leaf.part for leaf in leaves]).select_related('category', 'pricing_data')
    if with_stock:
        leaf_parts = PartSerializer.annotate_queryset(leaf_parts)
    if queryset_hook:
        leaf_parts = queryset_hook(leaf_parts)
    leaf_parts = {p.pk: p for p in leaf_parts}

    source_pks = {pk for leaf in leaves for pk in leaf.sources}
    source_names = {p.pk: p.full_name for p in Part.objects.filter(pk__in=source_pks)}

    rows = []

    for leaf in leaves:
        p = leaf_parts[leaf.part]
        price_min, price_max, currency = part_pricing(p)

        row = {
            'pk': p.pk,
            'ipn': p.IPN or '',
            'name': p.name,
            # Name with revision, without the IPN (which has its own column)
            'display_name': f'{p.name} | {p.revision}' if p.revision else p.name,
            'full_name': p.full_name,
            'description': p.description or '',
            'category': p.category.name if p.category else '',
            'category_path': p.category.pathstring if p.category else '',
            'category_pk': p.category_id,
            'reference': ', '.join(leaf.references),
            'units': p.units or '',
            'url': p.get_absolute_url(),
            'thumbnail': p.get_thumbnail_url(),
            'required': leaf.quantity,
            'currency': currency,
            'unit_price_min': price_min,
            'unit_price_max': price_max,
            'total_price_min': price_min * leaf.quantity if price_min is not None else None,
            'total_price_max': price_max * leaf.quantity if price_max is not None else None,
            'optional': leaf.optional,
            'consumable': leaf.consumable,
            'virtual': bool(p.virtual),
            'empty_bom': leaf.empty_bom,
            'sources': sorted(
                ({'pk': pk, 'name': source_names.get(pk, str(pk)), 'quantity': qty} for pk, qty in leaf.sources.items()),
                key=lambda s: s['name'].lower(),
            ),
            '_part': p,
            '_bom_items': leaf.bom_items,
        }

        if with_stock:
            in_stock = Decimal(p.total_in_stock or 0)
            available = Decimal(p.unallocated_stock or 0)
            on_order = Decimal(p.ordering or 0)
            row.update({
                'in_stock': in_stock,
                'available': available,
                'on_order': on_order,
                # Virtual parts have no stock, so a shortage makes no sense for them
                'shortage': None if p.virtual else shortage(leaf.quantity, available),
                'shortage_after_orders': None if p.virtual else shortage(leaf.quantity, available + on_order),
            })

        rows.append(row)

    rows.sort(key=lambda r: ((r['ipn'] or '~').lower(), r['name'].lower()))
    return rows


def load_request(request, pk: int):
    """Common request handling: permissions, part lookup and parameters.

    Returns (part, quantity, include_optional, with_stock) or an HttpResponse on error.
    """
    from part.models import Part

    if not can_view_parts(request.user):
        return HttpResponseForbidden('Insufficient permissions (part: view)')

    try:
        part = Part.objects.get(pk=pk)
    except Part.DoesNotExist:
        raise Http404('Part not found')

    try:
        quantity = parse_quantity(request.GET.get('quantity'))
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))

    include_optional = parse_bool(request.GET.get('optional'), True)
    return part, quantity, include_optional, can_view_stock(request.user)


def bom_error(exc) -> str:
    """Readable message for a BOM structure error."""
    from part.models import Part

    names = dict(Part.objects.filter(pk__in=exc.args[0]).values_list('pk', 'name'))
    path = ' → '.join(names.get(pk, str(pk)) for pk in exc.args[0])
    if isinstance(exc, BomLoopError):
        return f'BOM loop: {path}'
    return f'BOM is too deep: {path}'


def as_json(value):
    """Decimals are sent as strings (exact), private keys (_...) are dropped."""
    if isinstance(value, Decimal):
        return fmt_decimal(value)
    if isinstance(value, list):
        return [as_json(v) for v in value]
    if isinstance(value, dict):
        return {k: as_json(v) for k, v in value.items() if not str(k).startswith('_')}
    return value


@require_GET
def flat_bom_view(request, pk: int):
    """JSON data for the panel."""
    result = load_request(request, pk)
    if isinstance(result, HttpResponse):
        return result
    part, quantity, include_optional, with_stock = result

    try:
        rows = build_flat_bom(part, quantity, include_optional, with_stock)
    except (BomLoopError, BomDepthError) as exc:
        return JsonResponse({'error': bom_error(exc)}, status=400)

    return JsonResponse(as_json({
        'part': {'pk': part.pk, 'full_name': part.full_name},
        'quantity': quantity,
        'include_optional': include_optional,
        'with_stock': with_stock,
        'rows': rows,
    }))


# ------------------------------------------------------------------ export

def sanitize(value):
    """Neutralise text values which a spreadsheet would evaluate as a formula."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


#: Export options (query parameter -> default), same as the InvenTree BOM exporter
EXPORT_OPTIONS = {
    'stock': True,
    'pricing': True,
    'supplier': True,
    'manufacturer': True,
    'substitutes': True,
    'parameters': True,
    'used_in': True,
}


def parse_export_options(params) -> dict:
    """Read the export switches from the query parameters."""
    return {key: parse_bool(params.get(key), default) for key, default in EXPORT_OPTIONS.items()}


def parse_part_filter(value):
    """?parts=1,2,3 limits the export to these parts (the rows visible in the panel)."""
    if not value:
        return None
    try:
        return {int(pk) for pk in str(value).split(',') if pk.strip()}
    except ValueError:
        raise ValueError('Invalid part list')


def export_prefetch(options: dict):
    """Prefetches for the selected export options."""

    def hook(queryset):
        related = []
        if options['supplier']:
            related += ['supplier_parts__supplier', 'supplier_parts__manufacturer_part']
        if options['manufacturer']:
            related += ['manufacturer_parts__manufacturer']
        if options['parameters']:
            related += ['parameters_list__template']
        return queryset.prefetch_related(*related) if related else queryset

    return hook


def substitute_names(rows: list[dict]) -> dict:
    """Map part pk -> names of the substitutes of all its BOM lines."""
    from part.models import BomItemSubstitute

    item_to_part = {item: row['pk'] for row in rows for item in row['_bom_items']}
    result: dict = {}
    substitutes = (
        BomItemSubstitute.objects.filter(bom_item__in=item_to_part.keys())
        .select_related('part')
        .order_by('bom_item', 'pk')
    )
    for sub in substitutes:
        names = result.setdefault(item_to_part[sub.bom_item_id], [])
        if sub.part.full_name not in names:
            names.append(sub.part.full_name)
    return result


def export_table(rows: list[dict], options: dict, with_stock: bool, numeric: bool):
    """Headers and rows for CSV / XLSX (numeric=True keeps numbers as numbers)."""

    def num(value):
        if value is None:
            return ''
        return float(value) if numeric else fmt_decimal(value)

    stock = options['stock'] and with_stock

    # Variable number of columns, like the InvenTree BOM exporter
    substitutes = substitute_names(rows) if options['substitutes'] else {}
    n_substitutes = max((len(v) for v in substitutes.values()), default=0)

    suppliers = {}
    manufacturers = {}
    parameters = {}
    parameter_names = {}

    for row in rows:
        p = row['_part']
        if options['supplier']:
            suppliers[p.pk] = [
                (sp.supplier.name if sp.supplier else '', sp.SKU or '',
                 sp.manufacturer_part.MPN if sp.manufacturer_part else '')
                for sp in p.supplier_parts.all()
            ]
        if options['manufacturer']:
            manufacturers[p.pk] = [
                (mp.manufacturer.name if mp.manufacturer else '', mp.MPN or '') for mp in p.manufacturer_parts.all()
            ]
        if options['parameters']:
            values = {}
            for parameter in p.parameters_list.all():
                parameter_names.setdefault(parameter.template_id, parameter.template.name)
                values[parameter.template_id] = parameter.data
            parameters[p.pk] = values

    n_suppliers = max((len(v) for v in suppliers.values()), default=0)
    n_manufacturers = max((len(v) for v in manufacturers.values()), default=0)
    parameter_ids = sorted(parameter_names, key=lambda pk: parameter_names[pk].lower())

    headers = ['IPN', 'Component', 'Category', 'Description', 'Reference', 'Quantity', 'Units']
    if stock:
        headers += ['In Stock', 'Available Stock', 'On Order', 'Shortage', 'Shortage incl. On Order']
    if options['pricing']:
        headers += ['Currency', 'Unit Price Min', 'Unit Price Max', 'Total Price Min', 'Total Price Max']
    headers += ['Optional', 'Consumable', 'Virtual']
    if options['used_in']:
        headers += ['Used In']
    headers += [f'Substitute {i + 1}' for i in range(n_substitutes)]
    for i in range(n_suppliers):
        headers += [f'Supplier {i + 1}', f'Supplier {i + 1} SKU', f'Supplier {i + 1} MPN']
    for i in range(n_manufacturers):
        headers += [f'Manufacturer {i + 1}', f'Manufacturer {i + 1} MPN']
    headers += [parameter_names[pk] for pk in parameter_ids]

    def padded(values: list, width: int, size: int = 1) -> list:
        flat = [v for value in values for v in (value if isinstance(value, tuple) else (value,))]
        return [sanitize(v) for v in flat] + [''] * (width * size - len(flat))

    data = []
    for r in rows:
        row = [
            sanitize(r['ipn']),
            sanitize(r['display_name']),
            sanitize(r['category_path']),
            sanitize(r['description']),
            sanitize(r['reference']),
            num(r['required']),
            sanitize(r['units']),
        ]
        if stock:
            row += [num(r['in_stock']), num(r['available']), num(r['on_order']),
                    num(r['shortage']), num(r['shortage_after_orders'])]
        if options['pricing']:
            row += [r['currency'], num(r['unit_price_min']), num(r['unit_price_max']),
                    num(r['total_price_min']), num(r['total_price_max'])]
        row += [r['optional'], r['consumable'], r['virtual']]
        if options['used_in']:
            row.append(sanitize('; '.join(f"{s['name']}: {fmt_decimal(s['quantity'])}" for s in r['sources'])))
        row += padded(substitutes.get(r['pk'], []), n_substitutes)
        row += padded(suppliers.get(r['pk'], []), n_suppliers, 3)
        row += padded(manufacturers.get(r['pk'], []), n_manufacturers, 2)
        row += [sanitize(parameters.get(r['pk'], {}).get(pk, '')) for pk in parameter_ids]
        data.append(row)

    return headers, data


@require_GET
def export_view(request, pk: int, fmt: str):
    """Download the flat BOM as CSV or XLSX (options as in the InvenTree BOM exporter)."""
    import tablib

    if fmt not in FORMATS:
        raise Http404('Unknown export format')

    result = load_request(request, pk)
    if isinstance(result, HttpResponse):
        return result
    part, quantity, include_optional, with_stock = result

    options = parse_export_options(request.GET)
    try:
        only_parts = parse_part_filter(request.GET.get('parts'))
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))

    try:
        rows = build_flat_bom(part, quantity, include_optional, with_stock, export_prefetch(options))
    except (BomLoopError, BomDepthError) as exc:
        return HttpResponseBadRequest(bom_error(exc))

    if only_parts is not None:
        rows = [row for row in rows if row['pk'] in only_parts]

    headers, data = export_table(rows, options, with_stock, numeric=fmt == 'xlsx')
    dataset = tablib.Dataset(*data, headers=headers, title='Flat BOM')

    name = re.sub(r'[^A-Za-z0-9._-]+', '_', part.IPN or part.name).strip('_') or str(part.pk)
    filename = f'flat_bom_{name}_x{fmt_decimal(quantity)}_{timezone.localdate().isoformat()}.{fmt}'

    response = HttpResponse(dataset.export(fmt), content_type=FORMATS[fmt])
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def panel_script_tag(name: str = 'flat_bom.js') -> str:
    """Cache-busting tag for a panel script URL (changes whenever the file changes)."""
    try:
        stat = (STATIC_DIR / name).stat()
        return f'{int(stat.st_mtime)}-{stat.st_size}'
    except OSError:
        return '0'


@require_GET
def panel_script_view(request, tag: str, name: str):
    """Serve a panel JavaScript module (contains no sensitive data)."""
    if name not in PANEL_SCRIPTS:
        raise Http404('Panel script not found')
    try:
        content = (STATIC_DIR / name).read_text(encoding='utf-8')
    except OSError:
        raise Http404('Panel script not found')

    response = HttpResponse(content, content_type='text/javascript; charset=utf-8')
    # The URL contains a version tag, so the module can be cached
    response['Cache-Control'] = 'public, max-age=86400'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
