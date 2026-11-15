/**
 * Flat BOM - panel for the InvenTree React UI (assembly part pages).
 *
 * Shows the bottom-level parts of the whole BOM with summed quantities,
 * merged reference designators, pricing, stock and shortages.
 *
 * Uses the React and Mantine instances which InvenTree exposes to plugins
 * (window.React, window.MantineCore), so the table looks like the native
 * InvenTree tables and no build step is required. The single-argument entry
 * point makes InvenTree render the returned element inside its own React tree.
 */

const React = window.React;
const M = window.MantineCore;
const h = React.createElement;
const { useEffect, useMemo, useState, useCallback } = React;

const COLUMNS_STORAGE_KEY = 'inventree-flat-bom-hidden-columns';

const STRINGS = {
  en: {
    intro: 'Bottom-level parts of all sub-assemblies, quantities summed. Sub-assemblies themselves are not listed.',
    quantity: 'Build quantity',
    optional: 'Include optional items',
    search: 'Search',
    refresh: 'Refresh',
    columns: 'Select Columns',
    filters: 'Table Filters',
    download: 'Download',
    loadFailed: 'Could not load the BOM',
    empty: 'This assembly has no BOM items.',
    noRows: 'No parts match the filters.',
    parts: '{n} parts',
    withShortage: '{n} with shortage',
    totalCost: 'Total cost: {value}',
    missingPrices: '{n} without price',
    // columns
    part: 'Component',
    ipn: 'IPN',
    category: 'Category',
    description: 'Description',
    reference: 'Reference',
    required: 'Quantity',
    unitPrice: 'Unit Price',
    totalPrice: 'Total Price',
    inStock: 'In Stock',
    available: 'Available Stock',
    onOrder: 'On Order',
    shortage: 'Shortage',
    shortageOrders: 'Shortage incl. On Order',
    usedIn: 'Used In',
    noStock: 'No stock',
    flagOptional: 'Optional',
    flagConsumable: 'Consumable',
    flagVirtual: 'Virtual',
    flagEmptyBom: 'Empty BOM',
    availableHint: 'In stock minus stock allocated to build and sales orders',
    shortageHint: 'Quantity minus available stock',
    shortageOrdersHint: 'Quantity minus available stock minus on order',
    viewPart: 'View Part',
    // filters
    addFilter: 'Add Filter',
    clearFilters: 'Clear Filters',
    filter: 'Filter',
    value: 'Value',
    selectFilter: 'Select filter',
    selectValue: 'Select filter value',
    add: 'Add',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    noFilters: 'No filters',
    fHasShortage: 'Has shortage',
    fHasShortageOrders: 'Has shortage incl. on order',
    fAvailable: 'Has available stock',
    fHasPricing: 'Has pricing',
    fHasReference: 'Has reference',
    fOptional: 'Optional',
    fConsumable: 'Consumable',
    fVirtual: 'Virtual',
    // export
    exportTitle: 'Export Data',
    exportFormat: 'Export Format',
    exportFormatHint: 'Select export file format',
    export: 'Export',
    exportFiltered: 'Only filtered rows',
    exportFilteredHint: 'Export the {n} rows shown in the table (of {total})',
    exportStock: 'Stock Data',
    exportStockHint: 'Include part stock data',
    exportPricing: 'Pricing Data',
    exportPricingHint: 'Include part pricing data',
    exportSupplier: 'Supplier Data',
    exportSupplierHint: 'Include supplier data',
    exportManufacturer: 'Manufacturer Data',
    exportManufacturerHint: 'Include manufacturer data',
    exportSubstitutes: 'Substitute Data',
    exportSubstitutesHint: 'Include substitute part data',
    exportParameters: 'Parameter Data',
    exportParametersHint: 'Include part parameter data',
    exportUsedIn: 'Used In',
    exportUsedInHint: 'Include the sub-assemblies each quantity comes from',
  },
  pl: {
    intro: 'Części bazowe ze wszystkich podzłożeń, ilości zsumowane. Same podzłożenia nie są wyświetlane.',
    quantity: 'Ilość do zbudowania',
    optional: 'Uwzględnij pozycje opcjonalne',
    search: 'Szukaj',
    refresh: 'Odśwież',
    columns: 'Wybierz kolumny',
    filters: 'Filtry tabeli',
    download: 'Pobierz',
    loadFailed: 'Nie udało się wczytać BOM',
    empty: 'To złożenie nie ma pozycji BOM.',
    noRows: 'Żadna część nie pasuje do filtrów.',
    parts: '{n} części',
    withShortage: '{n} z brakiem',
    totalCost: 'Koszt całkowity: {value}',
    missingPrices: '{n} bez ceny',
    part: 'Komponent',
    ipn: 'IPN',
    category: 'Kategoria',
    description: 'Opis',
    reference: 'Oznaczenia',
    required: 'Ilość',
    unitPrice: 'Cena jedn.',
    totalPrice: 'Cena całk.',
    inStock: 'Na stanie',
    available: 'Dostępne',
    onOrder: 'Zamówione',
    shortage: 'Brak',
    shortageOrders: 'Brak po zamówieniach',
    usedIn: 'Użyte w',
    noStock: 'Brak w magazynie',
    flagOptional: 'Opcjonalna',
    flagConsumable: 'Zużywalna',
    flagVirtual: 'Wirtualna',
    flagEmptyBom: 'Pusty BOM',
    availableHint: 'Stan minus ilości przydzielone do zleceń produkcyjnych i sprzedaży',
    shortageHint: 'Ilość minus dostępne',
    shortageOrdersHint: 'Ilość minus dostępne minus zamówione',
    viewPart: 'Pokaż część',
    addFilter: 'Dodaj filtr',
    clearFilters: 'Wyczyść filtry',
    filter: 'Filtr',
    value: 'Wartość',
    selectFilter: 'Wybierz filtr',
    selectValue: 'Wybierz wartość',
    add: 'Dodaj',
    cancel: 'Anuluj',
    yes: 'Tak',
    no: 'Nie',
    noFilters: 'Brak filtrów',
    fHasShortage: 'Ma brak',
    fHasShortageOrders: 'Ma brak po zamówieniach',
    fAvailable: 'Jest dostępna na stanie',
    fHasPricing: 'Ma cenę',
    fHasReference: 'Ma oznaczenia',
    fOptional: 'Opcjonalna',
    fConsumable: 'Zużywalna',
    fVirtual: 'Wirtualna',
    exportTitle: 'Eksport danych',
    exportFormat: 'Format eksportu',
    exportFormatHint: 'Wybierz format pliku',
    export: 'Eksportuj',
    exportFiltered: 'Tylko przefiltrowane wiersze',
    exportFilteredHint: 'Eksportuj {n} wierszy widocznych w tabeli (z {total})',
    exportStock: 'Dane magazynowe',
    exportStockHint: 'Stany, dostępność, zamówienia i braki',
    exportPricing: 'Ceny',
    exportPricingHint: 'Ceny jednostkowe i całkowite',
    exportSupplier: 'Dostawcy',
    exportSupplierHint: 'Dostawca, SKU i MPN',
    exportManufacturer: 'Producenci',
    exportManufacturerHint: 'Producent i MPN',
    exportSubstitutes: 'Zamienniki',
    exportSubstitutesHint: 'Zamienniki z pozycji BOM',
    exportParameters: 'Parametry',
    exportParametersHint: 'Parametry części',
    exportUsedIn: 'Użyte w',
    exportUsedInHint: 'Z których podzłożeń pochodzi ilość',
  },
};

const fmt = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

function loadHiddenColumns() {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLUMNS_STORAGE_KEY) || 'null');
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function saveHiddenColumns(hidden) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // storage unavailable (private mode etc.) - the choice is kept for this page only
  }
}

// --------------------------------------------------------------- icons (Tabler, MIT)

function icon(paths, size = 18) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    paths.map((d, i) => (typeof d === 'string' ? h('path', { key: i, d }) : h(d.tag, { key: i, ...d.attrs })))
  );
}

const IconRefresh = () => icon(['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4']);
const IconDownload = () => icon(['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12']);
const IconArrowRight = () => icon(['M5 12l14 0', 'M13 18l6 -6', 'M13 6l6 6'], 16);
const IconSearch = () => icon([{ tag: 'circle', attrs: { cx: 10, cy: 10, r: 7 } }, 'M21 21l-6 -6'], 16);
const IconFilter = () =>
  icon(['M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z']);
const IconColumns = () =>
  icon([
    'M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0', 'M6 4v4', 'M6 12v8',
    'M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0', 'M12 4v10', 'M12 18v2',
    'M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0', 'M18 4v1', 'M18 9v11',
  ]);
const IconPlus = () => icon(['M12 5l0 14', 'M5 12l14 0'], 16);
const IconX = () => icon(['M18 6l-12 12', 'M6 6l12 12'], 16);
const IconSort = (dir) =>
  icon(
    dir === 'asc' ? ['M12 5l0 14', 'M18 11l-6 -6', 'M6 11l6 -6']
      : dir === 'desc' ? ['M12 5l0 14', 'M18 13l-6 6', 'M6 13l6 6']
        : ['M3 9l4 -4l4 4m-4 -4v14', 'M21 15l-4 4l-4 -4m4 4v-14'],
    14
  );

// ------------------------------------------------------------------- panel

function FlatBomPanel({ context }) {
  const ctx = context?.context || {};
  const api = context.api;
  const base = (ctx.base_url || '/plugin/flat_bom/').replace(/\/?$/, '/');
  const locale = context?.locale || navigator.language || 'en';
  const t = STRINGS[String(locale).toLowerCase().startsWith('pl') ? 'pl' : 'en'];
  const partId = ctx.part_id;

  const [quantity, setQuantity] = useState(1);
  const [includeOptional, setIncludeOptional] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'ipn', direction: 'asc' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, row }
  const [hiddenColumns, setHiddenColumns] = useState(() => loadHiddenColumns() || ['in_stock', 'on_order']);
  const [filters, setFilters] = useState([]); // [{ key, value }]
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const qty = Number(quantity) > 0 ? String(quantity) : '1';
  const params = `quantity=${encodeURIComponent(qty)}&optional=${includeOptional ? '1' : '0'}`;

  // ---------------------------------------------------------- formatting

  const numberFormat = useMemo(() => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
    } catch {
      return new Intl.NumberFormat('en', { maximumFractionDigits: 6 });
    }
  }, [locale]);
  const formatNumber = useCallback((value) => (value === null || value === undefined ? '' : numberFormat.format(Number(value))), [numberFormat]);

  const formatMoney = useCallback(
    (value, currency) => {
      if (value === null || value === undefined) return '';
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency || 'USD',
          currencyDisplay: 'code',
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }).format(Number(value));
      } catch {
        return `${formatNumber(value)} ${currency || ''}`.trim();
      }
    },
    [locale, formatNumber]
  );

  const formatRange = (low, high, currency) => {
    if (low == null && high == null) return '-';
    if (low == null || high == null || Number(low) === Number(high)) return formatMoney(low ?? high, currency);
    return `${formatMoney(low, currency)} - ${formatMoney(high, currency)}`;
  };

  // ---------------------------------------------------------------- load

  // Debounced, so typing a quantity does not fire a request per key
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get(`${base}bom/${partId}/?${params}`)
        .then((response) => {
          if (cancelled) return;
          setResult(response.data);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setResult(null);
          setError(err?.response?.data?.error || err?.response?.data || err?.message || String(err));
        })
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, base, partId, params, reloadKey]);

  const withStock = !!result?.with_stock;
  const allRows = useMemo(() => result?.rows || [], [result]);

  // ------------------------------------------------------------- columns

  const allColumns = useMemo(() => {
    const cols = [
      { accessor: 'display_name', title: t.part, sortable: true, switchable: false },
      { accessor: 'ipn', title: t.ipn, sortable: true },
      { accessor: 'category', title: t.category, sortable: true },
      { accessor: 'description', title: t.description, sortable: true },
      { accessor: 'reference', title: t.reference, sortable: true },
      { accessor: 'required', title: t.required, sortable: true, numeric: true },
      { accessor: 'unit_price', title: t.unitPrice, sortable: true, numeric: true, sortKey: 'unit_price_min' },
      { accessor: 'total_price', title: t.totalPrice, sortable: true, numeric: true, sortKey: 'total_price_min' },
    ];
    if (withStock) {
      cols.push(
        { accessor: 'in_stock', title: t.inStock, sortable: true, numeric: true },
        { accessor: 'available', title: t.available, sortable: true, numeric: true, hint: t.availableHint },
        { accessor: 'on_order', title: t.onOrder, sortable: true, numeric: true },
        { accessor: 'shortage', title: t.shortage, sortable: true, numeric: true, hint: t.shortageHint },
        { accessor: 'shortage_after_orders', title: t.shortageOrders, sortable: true, numeric: true, hint: t.shortageOrdersHint }
      );
    }
    cols.push({ accessor: 'sources', title: t.usedIn, sortable: false });
    return cols;
  }, [t, withStock]);

  const columns = allColumns.filter((c) => c.switchable === false || !hiddenColumns.includes(c.accessor));

  const toggleColumn = (accessor) => {
    setHiddenColumns((hidden) => {
      const next = hidden.includes(accessor) ? hidden.filter((a) => a !== accessor) : [...hidden, accessor];
      saveHiddenColumns(next);
      return next;
    });
  };

  // ------------------------------------------------------------- filters

  const filterDefs = useMemo(() => {
    const yesNo = [{ value: 'true', label: t.yes }, { value: 'false', label: t.no }];
    const categories = new Map();
    allRows.forEach((r) => r.category_pk && categories.set(String(r.category_pk), r.category_path || r.category));
    const defs = [
      {
        key: 'category',
        label: t.category,
        choices: [...categories.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
        test: (r, v) => String(r.category_pk) === v,
      },
    ];
    if (withStock) {
      defs.push(
        { key: 'has_shortage', label: t.fHasShortage, choices: yesNo, test: (r, v) => (num(r.shortage) > 0) === (v === 'true') },
        { key: 'has_shortage_orders', label: t.fHasShortageOrders, choices: yesNo, test: (r, v) => (num(r.shortage_after_orders) > 0) === (v === 'true') },
        { key: 'available', label: t.fAvailable, choices: yesNo, test: (r, v) => (num(r.available) > 0) === (v === 'true') }
      );
    }
    defs.push(
      { key: 'has_pricing', label: t.fHasPricing, choices: yesNo, test: (r, v) => (r.unit_price_min != null || r.unit_price_max != null) === (v === 'true') },
      { key: 'has_reference', label: t.fHasReference, choices: yesNo, test: (r, v) => !!r.reference === (v === 'true') },
      { key: 'optional', label: t.fOptional, choices: yesNo, test: (r, v) => !!r.optional === (v === 'true') },
      { key: 'consumable', label: t.fConsumable, choices: yesNo, test: (r, v) => !!r.consumable === (v === 'true') },
      { key: 'virtual', label: t.fVirtual, choices: yesNo, test: (r, v) => !!r.virtual === (v === 'true') }
    );
    return defs;
  }, [t, withStock, allRows]);

  // Filters which no longer apply (e.g. stock filters without stock data) are ignored
  const activeFilters = useMemo(() => filters.filter((f) => filterDefs.some((d) => d.key === f.key)), [filters, filterDefs]);

  // ---------------------------------------------------------------- rows

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = allRows;
    if (term) {
      list = list.filter((r) =>
        [r.ipn, r.display_name, r.description, r.category, r.reference].some((v) => String(v || '').toLowerCase().includes(term))
      );
    }
    for (const f of activeFilters) {
      const def = filterDefs.find((d) => d.key === f.key);
      list = list.filter((r) => def.test(r, f.value));
    }

    const col = allColumns.find((c) => c.accessor === sort.column);
    if (!col) return list;
    const key = col.sortKey || col.accessor;
    const dir = sort.direction === 'desc' ? -1 : 1;
    const value = (r) => (col.numeric ? num(r[key]) ?? -Infinity : String(r[key] || '').toLowerCase());
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [allRows, search, activeFilters, filterDefs, sort, allColumns]);

  const isFiltered = rows.length !== allRows.length;
  const shortCount = rows.filter((r) => num(r.shortage) > 0).length;

  const totalCost = useMemo(() => {
    let low = 0;
    let high = 0;
    let missing = 0;
    let currency = '';
    for (const r of rows) {
      if (r.total_price_min == null && r.total_price_max == null) {
        missing += 1;
        continue;
      }
      low += Number(r.total_price_min ?? r.total_price_max);
      high += Number(r.total_price_max ?? r.total_price_min);
      currency = currency || r.currency;
    }
    return { low, high, missing, currency, any: rows.length > missing };
  }, [rows]);

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setSort((s) =>
      s.column === col.accessor
        ? { column: col.accessor, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { column: col.accessor, direction: col.numeric ? 'desc' : 'asc' }
    );
  };

  // ---------------------------------------------------------- navigation

  const navigateToPart = (row) => {
    if (context.navigate) context.navigate(`/part/${row.pk}/`);
    else window.location.href = row.url;
  };

  // Left click: open the part (Ctrl / Cmd: new tab); middle click: new tab
  const openPart = (row, event) => {
    if (event.ctrlKey || event.metaKey || event.button === 1) window.open(row.url, '_blank');
    else navigateToPart(row);
  };

  const onRowAuxClick = (row, event) => {
    if (event.button === 1) openPart(row, event); // right click is handled by onContextMenu
  };

  const onRowContextMenu = (row, event) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, row });
  };

  // ---------------------------------------------------------------- cells

  const units = (row) => (row.units ? ` ${row.units}` : '');

  function renderCell(col, row) {
    switch (col.accessor) {
      case 'display_name':
        return h(
          M.Group,
          { gap: 'xs', wrap: 'nowrap', justify: 'space-between' },
          h(
            M.Group,
            { gap: 'xs', wrap: 'nowrap' },
            h(M.Image, { src: row.thumbnail, w: 20, h: 20, radius: 'xs', fit: 'contain' }),
            h(M.Text, { size: 'sm' }, row.display_name)
          ),
          h(
            M.Group,
            { gap: 4, wrap: 'nowrap' },
            row.optional && h(M.Badge, { size: 'xs', color: 'yellow', variant: 'light' }, t.flagOptional),
            row.consumable && h(M.Badge, { size: 'xs', color: 'blue', variant: 'light' }, t.flagConsumable),
            row.virtual && h(M.Badge, { size: 'xs', color: 'grape', variant: 'light' }, t.flagVirtual),
            row.empty_bom && h(M.Badge, { size: 'xs', color: 'orange', variant: 'filled' }, t.flagEmptyBom)
          )
        );
      case 'category':
        return h(
          M.Tooltip,
          { label: row.category_path || '-', withinPortal: true, disabled: !row.category_path },
          h(M.Text, { size: 'sm' }, row.category || '-')
        );
      case 'reference':
        return h(M.Text, { size: 'sm', style: { wordBreak: 'break-word' } }, row.reference || '');
      case 'required':
        return h(M.Text, { size: 'sm', fw: 700 }, formatNumber(row.required) + units(row));
      case 'unit_price':
        return h(M.Text, { size: 'sm' }, formatRange(row.unit_price_min, row.unit_price_max, row.currency));
      case 'total_price':
        return h(M.Text, { size: 'sm' }, formatRange(row.total_price_min, row.total_price_max, row.currency));
      case 'in_stock':
      case 'available':
        if (num(row[col.accessor]) === 0 && !row.virtual) {
          return h(M.Text, { size: 'sm', c: 'orange', fs: 'italic' }, t.noStock);
        }
        return h(M.Text, { size: 'sm' }, row.virtual ? '-' : formatNumber(row[col.accessor]) + units(row));
      case 'on_order':
        return h(M.Text, { size: 'sm', c: num(row.on_order) ? undefined : 'dimmed' }, row.virtual ? '-' : formatNumber(row.on_order));
      case 'shortage':
      case 'shortage_after_orders': {
        const value = num(row[col.accessor]);
        if (value === null) return h(M.Text, { size: 'sm', c: 'dimmed' }, '-');
        return value > 0
          ? h(M.Text, { size: 'sm', c: 'red', fw: 700 }, formatNumber(value) + units(row))
          : h(M.Text, { size: 'sm', c: 'green' }, '0');
      }
      case 'sources':
        return h(
          M.Stack,
          { gap: 0 },
          row.sources.map((s) =>
            h(M.Text, { key: s.pk, size: 'xs', style: { whiteSpace: 'nowrap' } }, `${s.name}: ${formatNumber(s.quantity)}${units(row)}`)
          )
        );
      default:
        return h(M.Text, { size: 'sm' }, row[col.accessor] || '');
    }
  }

  // ------------------------------------------------------------- toolbar

  const columnsMenu = h(
    M.Menu,
    { position: 'bottom-end', withinPortal: true, closeOnItemClick: false, shadow: 'md' },
    h(
      M.Menu.Target,
      {},
      h(M.ActionIcon, { variant: 'transparent', 'aria-label': t.columns, title: t.columns }, h(IconColumns))
    ),
    h(
      M.Menu.Dropdown,
      {},
      h(M.Menu.Label, {}, t.columns),
      allColumns
        .filter((c) => c.switchable !== false)
        .map((c) =>
          h(
            M.Menu.Item,
            { key: c.accessor, onClick: () => toggleColumn(c.accessor) },
            h(M.Checkbox, {
              size: 'xs',
              label: c.title,
              checked: !hiddenColumns.includes(c.accessor),
              readOnly: true,
              style: { pointerEvents: 'none' },
            })
          )
        )
    )
  );

  const filterButton = h(
    M.Indicator,
    { label: activeFilters.length, size: 16, disabled: activeFilters.length === 0, offset: 4, inline: true },
    h(
      M.ActionIcon,
      { variant: 'transparent', onClick: () => setFiltersOpen(true), 'aria-label': t.filters, title: t.filters },
      h(IconFilter)
    )
  );

  const toolbar = h(
    M.Group,
    { justify: 'space-between', wrap: 'wrap', gap: 'sm' },
    h(
      M.Group,
      { gap: 'md', wrap: 'wrap' },
      h(
        M.Group,
        { gap: 6, wrap: 'nowrap' },
        h(M.Text, { size: 'sm' }, `${t.quantity}:`),
        h(M.NumberInput, {
          size: 'xs',
          w: 110,
          min: 0,
          decimalScale: 6,
          allowNegative: false,
          'aria-label': t.quantity,
          value: quantity,
          onChange: setQuantity,
        })
      ),
      h(M.Switch, {
        size: 'xs',
        label: t.optional,
        checked: includeOptional,
        onChange: (e) => setIncludeOptional(e.currentTarget.checked),
      })
    ),
    h(
      M.Group,
      { gap: 4, wrap: 'nowrap' },
      h(M.TextInput, {
        size: 'xs',
        w: 200,
        placeholder: t.search,
        leftSection: h(IconSearch),
        value: search,
        onChange: (e) => setSearch(e.currentTarget.value),
      }),
      h(
        M.Tooltip,
        { label: t.refresh, withinPortal: true },
        h(M.ActionIcon, { variant: 'transparent', onClick: () => setReloadKey((k) => k + 1), 'aria-label': t.refresh }, h(IconRefresh))
      ),
      columnsMenu,
      filterButton,
      h(
        M.Tooltip,
        { label: t.download, withinPortal: true },
        h(M.ActionIcon, { variant: 'transparent', onClick: () => setExportOpen(true), 'aria-label': t.download }, h(IconDownload))
      )
    )
  );

  // --------------------------------------------------------------- table

  const header = h(
    M.Table.Tr,
    {},
    columns.map((col) =>
      h(
        M.Table.Th,
        {
          key: col.accessor,
          onClick: () => toggleSort(col),
          style: { cursor: col.sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' },
        },
        h(
          M.Group,
          { gap: 4, wrap: 'nowrap', justify: 'space-between' },
          col.hint
            ? h(M.Tooltip, { label: col.hint, withinPortal: true, multiline: true, w: 260 }, h('span', {}, col.title))
            : h('span', {}, col.title),
          col.sortable &&
            h(
              M.Text,
              { span: true, c: sort.column === col.accessor ? undefined : 'dimmed', style: { display: 'flex' } },
              IconSort(sort.column === col.accessor ? sort.direction : null)
            )
        )
      )
    )
  );

  let body;
  if (!rows.length) {
    body = h(
      M.Table.Tr,
      {},
      h(
        M.Table.Td,
        { colSpan: columns.length },
        h(M.Text, { c: 'dimmed', ta: 'center', py: 'xl', size: 'sm' }, loading ? '' : allRows.length ? t.noRows : t.empty)
      )
    );
  } else {
    body = rows.map((row) =>
      h(
        M.Table.Tr,
        {
          key: row.pk,
          style: { cursor: 'pointer' },
          onClick: (e) => openPart(row, e),
          onAuxClick: (e) => onRowAuxClick(row, e),
          onContextMenu: (e) => onRowContextMenu(row, e),
        },
        columns.map((col) => h(M.Table.Td, { key: col.accessor }, renderCell(col, row)))
      )
    );
  }

  const table = h(
    M.Box,
    { pos: 'relative' },
    h(M.LoadingOverlay, { visible: loading, loaderProps: { type: 'dots' }, overlayProps: { blur: 0, opacity: 0.4 } }),
    h(
      M.Table.ScrollContainer,
      { minWidth: 900 },
      h(
        M.Table,
        { withTableBorder: true, withColumnBorders: true, striped: true, highlightOnHover: true, verticalSpacing: 'xs', fz: 'sm' },
        h(M.Table.Thead, {}, header),
        h(M.Table.Tbody, {}, body)
      )
    )
  );

  const footer = h(
    M.Group,
    { justify: 'space-between' },
    h(
      M.Group,
      { gap: 'xs' },
      h(M.Text, { size: 'sm' }, allRows.length ? `${rows.length} / ${allRows.length}` : ''),
      allRows.length > 0 && h(M.Badge, { variant: 'light', color: 'blue' }, fmt(t.parts, { n: rows.length })),
      withStock && rows.length > 0 &&
        h(M.Badge, { variant: shortCount ? 'filled' : 'light', color: shortCount ? 'red' : 'green' }, fmt(t.withShortage, { n: shortCount })),
      totalCost.any &&
        h(M.Badge, { variant: 'light', color: 'teal' }, fmt(t.totalCost, { value: formatRange(totalCost.low, totalCost.high, totalCost.currency) })),
      totalCost.any && totalCost.missing > 0 &&
        h(M.Badge, { variant: 'light', color: 'orange' }, fmt(t.missingPrices, { n: totalCost.missing }))
    ),
    h(M.Text, { size: 'xs', c: 'dimmed' }, `v${ctx.version || ''}`)
  );

  // -------------------------------------------------------- context menu

  // Rendered in a portal, so fixed coordinates are exact
  const rowMenu =
    contextMenu &&
    h(
      M.Portal,
      {},
      h(
        M.Menu,
        {
          key: `${contextMenu.x}-${contextMenu.y}`,
          opened: true,
          onChange: (opened) => !opened && setContextMenu(null),
          position: 'bottom-start',
          offset: 2,
          shadow: 'md',
          withinPortal: false,
        },
        h(
          M.Menu.Target,
          {},
          h('div', { style: { position: 'fixed', left: contextMenu.x, top: contextMenu.y, width: 1, height: 1 } })
        ),
        h(
          M.Menu.Dropdown,
          {},
          h(
            M.Menu.Item,
            {
              leftSection: h(IconArrowRight),
              onClick: () => {
                const row = contextMenu.row;
                setContextMenu(null);
                navigateToPart(row);
              },
            },
            t.viewPart
          )
        )
      )
    );

  return h(
    M.Stack,
    { gap: 'sm' },
    rowMenu,
    h(FilterDrawer, {
      t,
      opened: filtersOpen,
      onClose: () => setFiltersOpen(false),
      defs: filterDefs,
      filters: activeFilters,
      setFilters,
    }),
    h(ExportModal, {
      t,
      opened: exportOpen,
      onClose: () => setExportOpen(false),
      withStock,
      isFiltered,
      filteredCount: rows.length,
      totalCount: allRows.length,
      buildUrl: (format, options, onlyFiltered) => {
        const query = new URLSearchParams(params);
        Object.entries(options).forEach(([key, value]) => query.set(key, value ? '1' : '0'));
        if (onlyFiltered) query.set('parts', rows.map((r) => r.pk).join(','));
        return `${base}bom/${partId}/export/${format}/?${query.toString()}`;
      },
    }),
    h(M.Text, { size: 'sm', c: 'dimmed' }, t.intro),
    toolbar,
    error && h(M.Alert, { color: 'red', title: t.loadFailed }, String(error)),
    table,
    footer
  );
}

// ------------------------------------------------------------- filter drawer

function FilterDrawer({ t, opened, onClose, defs, filters, setFilters }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [newValue, setNewValue] = useState(null);

  const unused = defs.filter((d) => !filters.some((f) => f.key === d.key));
  const newDef = defs.find((d) => d.key === newKey);

  const resetAdd = () => {
    setAdding(false);
    setNewKey(null);
    setNewValue(null);
  };

  const describe = (f) => {
    const def = defs.find((d) => d.key === f.key);
    const choice = def?.choices.find((c) => c.value === f.value);
    return [def?.label || f.key, choice?.label || f.value];
  };

  return h(
    M.Drawer,
    {
      opened,
      onClose: () => {
        resetAdd();
        onClose();
      },
      position: 'right',
      size: 'sm',
      title: h(M.Text, { size: 'xl', fw: 700, c: 'var(--mantine-primary-color-filled)' }, t.filters),
    },
    h(
      M.Stack,
      { gap: 'xs' },
      h(M.Divider, {}),
      filters.length === 0 && !adding && h(M.Text, { size: 'sm', c: 'dimmed', fs: 'italic' }, t.noFilters),
      filters.map((f) => {
        const [name, value] = describe(f);
        return h(
          M.Paper,
          { key: f.key, withBorder: true, p: 'sm', shadow: 'xs' },
          h(
            M.Group,
            { justify: 'space-between', wrap: 'nowrap' },
            h(M.Stack, { gap: 0 }, h(M.Text, { size: 'sm', fw: 700 }, name), h(M.Text, { size: 'xs' }, value)),
            h(
              M.ActionIcon,
              {
                variant: 'transparent',
                color: 'red',
                onClick: () => setFilters((list) => list.filter((x) => x.key !== f.key)),
                'aria-label': 'remove',
              },
              h(IconX)
            )
          )
        );
      }),
      adding &&
        h(
          M.Paper,
          { withBorder: true, p: 'sm', shadow: 'xs' },
          h(
            M.Stack,
            { gap: 'xs' },
            h(M.Select, {
              label: t.filter,
              placeholder: t.selectFilter,
              data: unused.map((d) => ({ value: d.key, label: d.label })),
              value: newKey,
              onChange: (value) => {
                setNewKey(value);
                setNewValue(null);
              },
              searchable: true,
              comboboxProps: { withinPortal: true },
            }),
            newDef &&
              h(M.Select, {
                label: t.value,
                placeholder: t.selectValue,
                data: newDef.choices,
                value: newValue,
                onChange: setNewValue,
                searchable: newDef.choices.length > 6,
                comboboxProps: { withinPortal: true },
              }),
            h(
              M.Group,
              { justify: 'flex-end', gap: 'xs' },
              h(M.Button, { size: 'xs', variant: 'outline', onClick: resetAdd }, t.cancel),
              h(
                M.Button,
                {
                  size: 'xs',
                  disabled: !newKey || newValue === null,
                  onClick: () => {
                    setFilters((list) => [...list.filter((x) => x.key !== newKey), { key: newKey, value: newValue }]);
                    resetAdd();
                  },
                },
                t.add
              )
            )
          )
        ),
      h(M.Divider, {}),
      h(
        M.Group,
        { justify: 'space-between' },
        h(
          M.Button,
          { size: 'xs', variant: 'light', color: 'red', disabled: filters.length === 0, onClick: () => setFilters([]) },
          t.clearFilters
        ),
        h(
          M.Button,
          { size: 'xs', variant: 'light', leftSection: h(IconPlus), disabled: adding || unused.length === 0, onClick: () => setAdding(true) },
          t.addFilter
        )
      )
    )
  );
}

// -------------------------------------------------------------- export modal

const EXPORT_SWITCHES = [
  { key: 'stock', label: 'exportStock', hint: 'exportStockHint', needsStock: true },
  { key: 'pricing', label: 'exportPricing', hint: 'exportPricingHint' },
  { key: 'supplier', label: 'exportSupplier', hint: 'exportSupplierHint' },
  { key: 'manufacturer', label: 'exportManufacturer', hint: 'exportManufacturerHint' },
  { key: 'substitutes', label: 'exportSubstitutes', hint: 'exportSubstitutesHint' },
  { key: 'parameters', label: 'exportParameters', hint: 'exportParametersHint' },
  { key: 'used_in', label: 'exportUsedIn', hint: 'exportUsedInHint' },
];

function ExportModal({ t, opened, onClose, withStock, isFiltered, filteredCount, totalCount, buildUrl }) {
  const [format, setFormat] = useState('csv');
  const [options, setOptions] = useState(() => Object.fromEntries(EXPORT_SWITCHES.map((s) => [s.key, true])));
  const [onlyFiltered, setOnlyFiltered] = useState(true);

  const doExport = () => {
    const link = document.createElement('a');
    link.href = buildUrl(format, options, isFiltered && onlyFiltered);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    onClose();
  };

  const switchRow = (key, label, hint, checked, onChange) =>
    h(M.Switch, { key, label, description: hint, checked, onChange: (e) => onChange(e.currentTarget.checked) });

  return h(
    M.Modal,
    {
      opened,
      onClose,
      size: 'lg',
      title: h(M.Text, { size: 'xl', fw: 700, c: 'var(--mantine-primary-color-filled)' }, t.exportTitle),
    },
    h(
      M.Stack,
      { gap: 'md' },
      h(M.Divider, {}),
      h(M.Select, {
        label: t.exportFormat,
        description: t.exportFormatHint,
        required: true,
        allowDeselect: false,
        data: [
          { value: 'csv', label: 'CSV' },
          { value: 'xlsx', label: 'Excel (.xlsx)' },
        ],
        value: format,
        onChange: (value) => value && setFormat(value),
        comboboxProps: { withinPortal: true },
      }),
      isFiltered &&
        switchRow('filtered', t.exportFiltered, fmt(t.exportFilteredHint, { n: filteredCount, total: totalCount }), onlyFiltered, setOnlyFiltered),
      EXPORT_SWITCHES.filter((s) => !s.needsStock || withStock).map((s) =>
        switchRow(s.key, t[s.label], t[s.hint], options[s.key], (value) => setOptions((o) => ({ ...o, [s.key]: value })))
      ),
      h(M.Divider, {}),
      h(
        M.Group,
        { justify: 'flex-end' },
        h(M.Button, { variant: 'outline', onClick: onClose }, t.cancel),
        h(M.Button, { color: 'green', onClick: doExport }, t.export)
      )
    )
  );
}

/** Entry point: InvenTree renders the returned element in its own React tree. */
export function renderPanel(context) {
  return h(FlatBomPanel, { context });
}
