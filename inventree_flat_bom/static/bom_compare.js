/**
 * BOM Compare - panel for the InvenTree React UI (assembly part pages).
 *
 * Compares the BOM of this part (A) with another assembly (B):
 *  - Structure: level-by-level diff; sub-assemblies replaced by another revision /
 *    variant / same IPN (optionally: a similar BOM) are compared inside.
 *  - Flat: bottom-level parts with summed quantities, cost and stock.
 *
 * Uses the React and Mantine instances which InvenTree exposes to plugins
 * (window.React, window.MantineCore) - no build step is required.
 */

const React = window.React;
const M = window.MantineCore;
const h = React.createElement;
const { useEffect, useMemo, useState, useCallback } = React;

const STRINGS = {
  en: {
    intro: 'Compare the BOM of this part (A) with another assembly (B). Sub-assemblies replaced by another revision or variant are compared inside.',
    compareWith: 'Compare with (B)',
    selectPart: 'Search for an assembly…',
    revisions: 'Revisions',
    variants: 'Variants',
    noSelection: 'Select an assembly to compare with.',
    viewTree: 'Structure',
    viewFlat: 'Flat (bottom level)',
    displayMode: 'Display Mode',
    modeAll: 'Show all parts',
    modeDiff: 'Show differences',
    modeChanged: 'Changed',
    modeReplaced: 'Replaced',
    modeAdded: 'Only in B (added)',
    modeRemoved: 'Only in A (removed)',
    modeUnchanged: 'Unchanged',
    similarity: 'Pair by BOM similarity',
    similarityHint: 'Also pair sub-assemblies which are not revisions / variants, when their bottom-level parts are similar',
    threshold: 'Min. similarity',
    pairRelatives: 'Pair revisions / variants',
    quantity: 'Build quantity',
    optional: 'Include optional items',
    search: 'Search',
    refresh: 'Refresh',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    download: 'Download',
    loadFailed: 'Could not compare the BOMs',
    noRows: 'No rows match the display mode.',
    identical: 'The BOMs are identical.',
    component: 'Component',
    ipn: 'IPN',
    qtyA: 'Quantity A',
    qtyB: 'Quantity B',
    delta: 'Δ',
    reference: 'Reference',
    changes: 'Changes',
    pairing: 'Pairing',
    costDelta: 'Cost Δ',
    available: 'Available Stock',
    shortageB: 'Shortage B',
    usedIn: 'Used In (A / B)',
    status: {
      added: 'Only in B',
      removed: 'Only in A',
      changed: 'Changed',
      replaced: 'Replaced',
      unchanged: 'Unchanged',
    },
    reason: { revision: 'Revision', variant: 'Variant', ipn: 'Same IPN', similarity: 'Similar BOM' },
    fields: {
      quantity: 'Quantity',
      optional: 'Optional',
      consumable: 'Consumable',
      allow_variants: 'Allow variants',
      inherited: 'Inherited',
      setup_quantity: 'Setup quantity',
      attrition: 'Attrition',
      rounding_multiple: 'Rounding',
      note: 'Note',
    },
    yes: 'yes',
    no: 'no',
    viewPartA: 'View Part A',
    viewPartB: 'View Part B',
    // export
    exportTitle: 'Export Data',
    exportFormat: 'Export Format',
    exportFormatHint: 'Select export file format',
    exportView: 'Comparison',
    exportViewHint: 'Structure (all levels, with path) or flat (bottom-level parts)',
    exportOnlyDiff: 'Only differences',
    exportOnlyDiffHint: 'Skip unchanged rows',
    export: 'Export',
    cancel: 'Cancel',
  },
  pl: {
    intro: 'Porównaj BOM tej części (A) z innym złożeniem (B). Podzłożenia zamienione na inną rewizję lub wariant są porównywane w środku.',
    compareWith: 'Porównaj z (B)',
    selectPart: 'Wyszukaj złożenie…',
    revisions: 'Rewizje',
    variants: 'Warianty',
    noSelection: 'Wybierz złożenie do porównania.',
    viewTree: 'Struktura',
    viewFlat: 'Płaski (części bazowe)',
    displayMode: 'Tryb wyświetlania',
    modeAll: 'Wszystkie pozycje',
    modeDiff: 'Tylko różnice',
    modeChanged: 'Zmienione',
    modeReplaced: 'Zamienione',
    modeAdded: 'Tylko w B (dodane)',
    modeRemoved: 'Tylko w A (usunięte)',
    modeUnchanged: 'Bez zmian',
    similarity: 'Paruj po podobieństwie BOM',
    similarityHint: 'Paruj też podzłożenia, które nie są rewizjami / wariantami, jeśli mają podobne części bazowe',
    threshold: 'Min. podobieństwo',
    pairRelatives: 'Paruj rewizje / warianty',
    quantity: 'Ilość do zbudowania',
    optional: 'Uwzględnij pozycje opcjonalne',
    search: 'Szukaj',
    refresh: 'Odśwież',
    expandAll: 'Rozwiń wszystko',
    collapseAll: 'Zwiń wszystko',
    download: 'Pobierz',
    loadFailed: 'Nie udało się porównać BOM',
    noRows: 'Żadna pozycja nie pasuje do trybu wyświetlania.',
    identical: 'BOM-y są identyczne.',
    component: 'Komponent',
    ipn: 'IPN',
    qtyA: 'Ilość A',
    qtyB: 'Ilość B',
    delta: 'Δ',
    reference: 'Oznaczenia',
    changes: 'Zmiany',
    pairing: 'Parowanie',
    costDelta: 'Δ kosztu',
    available: 'Dostępne',
    shortageB: 'Brak dla B',
    usedIn: 'Użyte w (A / B)',
    status: {
      added: 'Tylko w B',
      removed: 'Tylko w A',
      changed: 'Zmieniona',
      replaced: 'Zamieniona',
      unchanged: 'Bez zmian',
    },
    reason: { revision: 'Rewizja', variant: 'Wariant', ipn: 'Ten sam IPN', similarity: 'Podobny BOM' },
    fields: {
      quantity: 'Ilość',
      optional: 'Opcjonalna',
      consumable: 'Zużywalna',
      allow_variants: 'Dozwolone warianty',
      inherited: 'Dziedziczona',
      setup_quantity: 'Ilość na ustawienie',
      attrition: 'Straty',
      rounding_multiple: 'Zaokrąglenie',
      note: 'Notatka',
    },
    yes: 'tak',
    no: 'nie',
    viewPartA: 'Pokaż część A',
    viewPartB: 'Pokaż część B',
    exportTitle: 'Eksport danych',
    exportFormat: 'Format eksportu',
    exportFormatHint: 'Wybierz format pliku',
    exportView: 'Porównanie',
    exportViewHint: 'Struktura (wszystkie poziomy, ze ścieżką) albo płaskie (części bazowe)',
    exportOnlyDiff: 'Tylko różnice',
    exportOnlyDiffHint: 'Pomiń pozycje bez zmian',
    export: 'Eksportuj',
    cancel: 'Anuluj',
  },
};

const STATUS_COLOR = { added: 'yellow', removed: 'red', changed: 'blue', replaced: 'violet', unchanged: 'green' };

const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
const splitRefs = (value) => String(value || '').split(/[,;\s]+/).filter(Boolean);

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
const IconSearch = () => icon([{ tag: 'circle', attrs: { cx: 10, cy: 10, r: 7 } }, 'M21 21l-6 -6'], 16);
const IconArrowRight = () => icon(['M5 12l14 0', 'M13 18l6 -6', 'M13 6l6 6'], 16);
const IconChevronRight = () => icon(['M9 6l6 6l-6 6'], 16);
const IconChevronDown = () => icon(['M6 9l6 6l6 -6'], 16);
const IconExpand = () => icon(['M4 8v-2a2 2 0 0 1 2 -2h2', 'M4 16v2a2 2 0 0 0 2 2h2', 'M16 4h2a2 2 0 0 1 2 2v2', 'M16 20h2a2 2 0 0 0 2 -2v-2']);
const IconCollapse = () => icon(['M5 9h4v-4', 'M3 3l6 6', 'M5 15h4v4', 'M3 21l6 -6', 'M19 9h-4v-4', 'M15 9l6 -6', 'M19 15h-4v4', 'M15 15l6 6']);
const STATUS_ICON = {
  added: () => icon(['M12 5l0 14', 'M5 12l14 0'], 14),
  removed: () => icon(['M5 12l14 0'], 14),
  changed: () => icon(['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'], 14),
  replaced: () => icon(['M7 10h14l-4 -4', 'M17 14h-14l4 4'], 14),
  unchanged: () => icon(['M5 12l5 5l10 -10'], 14),
};

// ------------------------------------------------------------------- panel

function BomComparePanel({ context }) {
  const ctx = context?.context || {};
  const api = context.api;
  const base = (ctx.base_url || '/plugin/flat_bom/').replace(/\/?$/, '/');
  const locale = context?.locale || navigator.language || 'en';
  const t = STRINGS[String(locale).toLowerCase().startsWith('pl') ? 'pl' : 'en'];
  const partId = ctx.part_id;

  const [compareId, setCompareId] = useState(null);
  const [compareOptions, setCompareOptions] = useState([]); // Select data
  const [searchValue, setSearchValue] = useState('');
  const [related, setRelated] = useState({ revisions: [], variants: [] });
  const [view, setView] = useState('tree');
  const [mode, setMode] = useState('diff');
  const [similarity, setSimilarity] = useState(false);
  const [threshold, setThreshold] = useState(50);
  const [pairRelatives, setPairRelatives] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [includeOptional, setIncludeOptional] = useState(true);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  const numberFormat = useMemo(() => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
    } catch {
      return new Intl.NumberFormat('en', { maximumFractionDigits: 6 });
    }
  }, [locale]);
  const formatNumber = useCallback((v) => (v === null || v === undefined || v === '' ? '' : numberFormat.format(Number(v))), [numberFormat]);
  const formatDelta = (v) => {
    const n = num(v);
    if (n === null) return '';
    return n > 0 ? `+${formatNumber(n)}` : formatNumber(n);
  };
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
          signDisplay: 'exceptZero',
        }).format(Number(value));
      } catch {
        return formatNumber(value);
      }
    },
    [locale, formatNumber]
  );

  // ---------------------------------------------------------- related parts

  useEffect(() => {
    api
      .get(`${base}related/${partId}/`)
      .then((response) => setRelated(response.data))
      .catch(() => setRelated({ revisions: [], variants: [] }));
  }, [api, base, partId]);

  const choose = (part) => {
    setCompareOptions((options) =>
      options.some((o) => o.value === String(part.pk)) ? options : [{ value: String(part.pk), label: part.full_name }, ...options]
    );
    setCompareId(String(part.pk));
  };

  // Search assemblies through the InvenTree API (debounced)
  useEffect(() => {
    const term = searchValue.trim();
    if (!term || compareOptions.some((o) => o.label === searchValue)) return undefined;
    const timer = setTimeout(() => {
      api
        .get('/api/part/', { params: { search: term, assembly: true, limit: 25 } })
        .then((response) => {
          const list = Array.isArray(response.data) ? response.data : response.data?.results || [];
          const options = list.filter((p) => p.pk !== partId).map((p) => ({ value: String(p.pk), label: p.full_name }));
          setCompareOptions((current) => {
            const selected = current.filter((o) => o.value === compareId);
            return [...selected, ...options.filter((o) => o.value !== compareId)];
          });
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [api, searchValue, partId, compareId]);

  // -------------------------------------------------------------- compare

  const params = useMemo(() => {
    const q = new URLSearchParams();
    q.set('quantity', Number(quantity) > 0 ? String(quantity) : '1');
    q.set('optional', includeOptional ? '1' : '0');
    q.set('similarity', similarity ? '1' : '0');
    q.set('threshold', String(Math.min(100, Math.max(1, Number(threshold) || 50)) / 100));
    q.set('pair', pairRelatives ? '1' : '0');
    return q;
  }, [quantity, includeOptional, similarity, threshold, pairRelatives]);

  useEffect(() => {
    if (!compareId) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get(`${base}compare/${partId}/${compareId}/?${params.toString()}`)
        .then((response) => {
          if (cancelled) return;
          setResult(response.data);
          setError(null);
          // Expand everything which contains differences
          const keys = new Set();
          const walk = (nodes) =>
            nodes.forEach((n) => {
              if (n.children.length && n.differs) keys.add(n.key);
              walk(n.children);
            });
          walk(response.data.tree || []);
          setExpanded(keys);
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
  }, [api, base, partId, compareId, params, reloadKey]);

  // ---------------------------------------------------------- filtering

  const term = search.trim().toLowerCase();
  const matchesSearch = (a, b) =>
    !term || [a, b].some((p) => p && [p.ipn, p.display_name, p.description].some((v) => String(v || '').toLowerCase().includes(term)));
  const matchesMode = (status) => mode === 'all' || (mode === 'diff' ? status !== 'unchanged' : status === mode);

  // Tree: keep a node if it matches, or something below it matches (shown for context)
  const visibleTree = useMemo(() => {
    const filter = (nodes) =>
      nodes
        .map((n) => {
          const children = filter(n.children);
          const self = matchesMode(n.status) && matchesSearch(n.part_a, n.part_b);
          return self || children.length ? { ...n, visibleChildren: children, contextOnly: !self } : null;
        })
        .filter(Boolean);
    return filter(result?.tree || []);
  }, [result, mode, term]);

  const visibleFlat = useMemo(
    () => (result?.flat || []).filter((r) => matchesMode(r.status) && matchesSearch(r.part_a, r.part_b)),
    [result, mode, term]
  );

  const flatRows = useMemo(() => {
    const rows = [];
    const walk = (nodes, level) =>
      nodes.forEach((n) => {
        rows.push({ node: n, level });
        if (n.visibleChildren.length && expanded.has(n.key)) walk(n.visibleChildren, level + 1);
      });
    walk(visibleTree, 0);
    return rows;
  }, [visibleTree, expanded]);

  const allKeys = useMemo(() => {
    const keys = [];
    const walk = (nodes) => nodes.forEach((n) => (n.children.length && keys.push(n.key), walk(n.children)));
    walk(result?.tree || []);
    return keys;
  }, [result]);

  const toggle = (key) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // ---------------------------------------------------------- navigation

  const navigateToPart = (part) => {
    if (!part) return;
    if (context.navigate) context.navigate(`/part/${part.pk}/`);
    else window.location.href = part.url;
  };

  const partLink = (part) =>
    h(
      M.Anchor,
      {
        href: part.url,
        size: 'sm',
        onClick: (e) => {
          if (e.ctrlKey || e.metaKey) return; // let the browser open a new tab
          e.preventDefault();
          e.stopPropagation();
          navigateToPart(part);
        },
      },
      part.display_name
    );

  const onRowContextMenu = (a, b, event) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, a, b });
  };

  // ---------------------------------------------------------------- cells

  const statusIcon = (status) =>
    h(
      M.Tooltip,
      { label: t.status[status], withinPortal: true },
      h(M.ThemeIcon, { size: 'sm', variant: 'light', color: STATUS_COLOR[status], radius: 'xl' }, h(STATUS_ICON[status]))
    );

  const componentCell = (a, b, status) => {
    const parts = [];
    if (a && b && a.pk !== b.pk) {
      parts.push(partLink(a), h(M.Text, { key: 'arrow', span: true, c: 'dimmed', style: { display: 'flex' } }, h(IconArrowRight)), partLink(b));
    } else {
      parts.push(partLink(a || b));
    }
    return h(
      M.Group,
      { gap: 6, wrap: 'nowrap' },
      statusIcon(status),
      h(M.Image, { src: (b || a).thumbnail, w: 20, h: 20, radius: 'xs', fit: 'contain' }),
      ...parts.map((p, i) => h(React.Fragment, { key: i }, p))
    );
  };

  const ipnCell = (a, b) => {
    const ia = a?.ipn || '';
    const ib = b?.ipn || '';
    if (a && b && ia !== ib) return h(M.Text, { size: 'sm' }, `${ia || '-'} → ${ib || '-'}`);
    return h(M.Text, { size: 'sm' }, ia || ib);
  };

  const deltaCell = (a, b, units) => {
    const qa = num(a) ?? 0;
    const qb = num(b) ?? 0;
    const d = qb - qa;
    if (d === 0) return h(M.Text, { size: 'sm', c: 'dimmed' }, '0');
    return h(M.Text, { size: 'sm', fw: 700, c: d > 0 ? 'orange' : 'teal' }, `${formatDelta(d)}${units ? ' ' + units : ''}`);
  };

  const referenceCell = (refA, refB) => {
    const a = splitRefs(refA);
    const b = splitRefs(refB);
    if (!a.length && !b.length) return null;
    const setA = new Set(a);
    const setB = new Set(b);
    const tokens = [
      ...b.map((r) => (setA.has(r) ? { r, kind: 'same' } : { r, kind: 'added' })),
      ...a.filter((r) => !setB.has(r)).map((r) => ({ r, kind: 'removed' })),
    ];
    return h(
      M.Text,
      { size: 'sm', style: { wordBreak: 'break-word' } },
      tokens.map((tok, i) =>
        h(
          'span',
          {
            key: i,
            style: {
              marginRight: 4,
              color: tok.kind === 'added' ? 'var(--mantine-color-green-text, green)' : tok.kind === 'removed' ? 'var(--mantine-color-red-text, red)' : undefined,
              fontWeight: tok.kind === 'same' ? 400 : 700,
              textDecoration: tok.kind === 'removed' ? 'line-through' : undefined,
            },
          },
          tok.kind === 'added' ? `+${tok.r}` : tok.r
        )
      )
    );
  };

  const fieldValue = (v) => (v === true ? t.yes : v === false ? t.no : v === null || v === '' || v === undefined ? '-' : String(v));

  const changesCell = (changes) =>
    h(
      M.Group,
      { gap: 4 },
      changes
        .filter((c) => c.field !== 'quantity')
        .map((c) =>
          h(
            M.Tooltip,
            { key: c.field, label: `${fieldValue(c.a)} → ${fieldValue(c.b)}`, withinPortal: true, multiline: true, maw: 360 },
            h(M.Badge, { size: 'sm', variant: 'light', color: 'blue' }, `${t.fields[c.field] || c.field}: ${fieldValue(c.a)} → ${fieldValue(c.b)}`.slice(0, 60))
          )
        )
    );

  const pairingCell = (reason, score) =>
    reason
      ? h(M.Badge, { size: 'sm', variant: 'outline', color: 'violet' }, reason === 'similarity' && score != null ? `${t.reason[reason]} ${Math.round(score * 100)}%` : t.reason[reason])
      : null;

  const th = (label, extra = {}) => h(M.Table.Th, { style: { whiteSpace: 'nowrap' }, ...extra }, label);

  // ---------------------------------------------------------------- tables

  function treeTable() {
    const header = h(
      M.Table.Tr,
      {},
      th(t.component),
      th(t.ipn),
      th(t.qtyA),
      th(t.qtyB),
      th(t.delta),
      th(t.reference),
      th(t.changes),
      th(t.pairing)
    );

    const body = flatRows.map(({ node, level }) => {
      const a = node.part_a;
      const b = node.part_b;
      const la = node.line_a || {};
      const lb = node.line_b || {};
      const units = (b || a).units;
      const hasChildren = node.visibleChildren.length > 0;
      const isOpen = expanded.has(node.key);
      return h(
        M.Table.Tr,
        {
          key: node.key,
          style: { opacity: node.contextOnly ? 0.6 : 1, cursor: hasChildren ? 'pointer' : 'default' },
          onClick: () => hasChildren && toggle(node.key),
          onContextMenu: (e) => onRowContextMenu(a, b, e),
        },
        h(
          M.Table.Td,
          {},
          h(
            M.Group,
            { gap: 4, wrap: 'nowrap', style: { paddingLeft: level * 22 } },
            hasChildren
              ? h(M.ActionIcon, { size: 'sm', variant: 'transparent', 'aria-label': 'toggle' }, isOpen ? h(IconChevronDown) : h(IconChevronRight))
              : h('span', { style: { display: 'inline-block', width: 22 } }),
            componentCell(a, b, node.status)
          )
        ),
        h(M.Table.Td, {}, ipnCell(a, b)),
        h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, la.quantity != null ? formatNumber(la.quantity) : '-')),
        h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, lb.quantity != null ? formatNumber(lb.quantity) : '-')),
        h(M.Table.Td, {}, deltaCell(la.quantity, lb.quantity, units)),
        h(M.Table.Td, {}, referenceCell(la.reference, lb.reference)),
        h(M.Table.Td, {}, changesCell(node.changes)),
        h(M.Table.Td, {}, pairingCell(node.reason, node.score))
      );
    });

    return { header, body, columns: 8 };
  }

  function flatTable() {
    const withStock = !!result?.with_stock;
    const header = h(
      M.Table.Tr,
      {},
      th(t.component),
      th(t.ipn),
      th(t.qtyA),
      th(t.qtyB),
      th(t.delta),
      th(t.costDelta),
      withStock && th(t.available),
      withStock && th(t.shortageB),
      th(t.reference),
      th(t.usedIn),
      th(t.pairing)
    );

    const sources = (list) => list.map((s) => `${s.name}: ${formatNumber(s.quantity)}`).join(', ');

    const body = visibleFlat.map((r) => {
      const a = r.part_a;
      const b = r.part_b;
      const units = (b || a).units;
      const costDelta =
        r.cost_delta_min == null && r.cost_delta_max == null
          ? '-'
          : num(r.cost_delta_min) === num(r.cost_delta_max) || r.cost_delta_max == null || r.cost_delta_min == null
            ? formatMoney(r.cost_delta_min ?? r.cost_delta_max, r.currency)
            : `${formatMoney(r.cost_delta_min, r.currency)} … ${formatMoney(r.cost_delta_max, r.currency)}`;
      const shortageB = num(r.shortage_b);
      return h(
        M.Table.Tr,
        { key: r.key, onContextMenu: (e) => onRowContextMenu(a, b, e) },
        h(M.Table.Td, {}, componentCell(a, b, r.status)),
        h(M.Table.Td, {}, ipnCell(a, b)),
        h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, a ? formatNumber(r.quantity_a) : '-')),
        h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, b ? formatNumber(r.quantity_b) : '-')),
        h(M.Table.Td, {}, deltaCell(r.quantity_a, r.quantity_b, units)),
        h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, costDelta)),
        withStock && h(M.Table.Td, {}, h(M.Text, { size: 'sm' }, formatNumber(r.available))),
        withStock &&
          h(
            M.Table.Td,
            {},
            shortageB === null
              ? h(M.Text, { size: 'sm', c: 'dimmed' }, '-')
              : h(M.Text, { size: 'sm', c: shortageB > 0 ? 'red' : 'green', fw: shortageB > 0 ? 700 : 400 }, formatNumber(shortageB))
          ),
        h(M.Table.Td, {}, referenceCell(r.references_a, r.references_b)),
        h(
          M.Table.Td,
          {},
          h(
            M.Stack,
            { gap: 0 },
            r.sources_a.length > 0 && h(M.Text, { size: 'xs' }, `A: ${sources(r.sources_a)}`),
            r.sources_b.length > 0 && h(M.Text, { size: 'xs' }, `B: ${sources(r.sources_b)}`)
          )
        ),
        h(M.Table.Td, {}, pairingCell(r.reason, null))
      );
    });

    return { header, body, columns: withStock ? 11 : 9 };
  }

  // ---------------------------------------------------------------- layout

  const relatedButtons = (title, parts) =>
    parts.length > 0 &&
    h(
      M.Group,
      { gap: 4 },
      h(M.Text, { size: 'xs', c: 'dimmed' }, `${title}:`),
      parts.map((p) =>
        h(
          M.Button,
          {
            key: p.pk,
            size: 'compact-xs',
            variant: String(p.pk) === compareId ? 'filled' : 'light',
            onClick: () => choose(p),
          },
          p.revision ? `${p.name} | ${p.revision}` : p.full_name
        )
      )
    );

  const picker = h(
    M.Stack,
    { gap: 4 },
    h(M.Select, {
      label: t.compareWith,
      placeholder: t.selectPart,
      searchable: true,
      clearable: true,
      data: compareOptions,
      value: compareId,
      onChange: (value) => setCompareId(value),
      searchValue,
      onSearchChange: setSearchValue,
      nothingFoundMessage: '…',
      filter: ({ options }) => options, // results already filtered by the API
      comboboxProps: { withinPortal: true },
      maw: 520,
    }),
    relatedButtons(t.revisions, related.revisions || []),
    relatedButtons(t.variants, related.variants || [])
  );

  const modeData = [
    { value: 'all', label: t.modeAll },
    { value: 'diff', label: t.modeDiff },
    { value: 'changed', label: t.modeChanged },
    { value: 'replaced', label: t.modeReplaced },
    { value: 'added', label: t.modeAdded },
    { value: 'removed', label: t.modeRemoved },
    { value: 'unchanged', label: t.modeUnchanged },
  ];

  const options = h(
    M.Group,
    { gap: 'md', wrap: 'wrap', align: 'flex-end' },
    h(M.SegmentedControl, {
      size: 'xs',
      value: view,
      onChange: setView,
      data: [
        { value: 'tree', label: t.viewTree },
        { value: 'flat', label: t.viewFlat },
      ],
    }),
    h(M.Select, {
      size: 'xs',
      w: 200,
      'aria-label': t.displayMode,
      value: mode,
      allowDeselect: false,
      onChange: (v) => v && setMode(v),
      data: modeData,
      comboboxProps: { withinPortal: true },
    }),
    view === 'tree'
      ? h(
          M.Group,
          { gap: 6, wrap: 'nowrap' },
          h(
            M.Tooltip,
            { label: t.similarityHint, withinPortal: true, multiline: true, w: 300 },
            h('div', {}, h(M.Switch, { size: 'xs', label: t.similarity, checked: similarity, onChange: (e) => setSimilarity(e.currentTarget.checked) }))
          ),
          similarity &&
            h(M.NumberInput, {
              size: 'xs',
              w: 90,
              min: 1,
              max: 100,
              suffix: '%',
              'aria-label': t.threshold,
              title: t.threshold,
              value: threshold,
              onChange: setThreshold,
            })
        )
      : h(
          M.Group,
          { gap: 'md', wrap: 'wrap' },
          h(
            M.Group,
            { gap: 6, wrap: 'nowrap' },
            h(M.Text, { size: 'sm' }, `${t.quantity}:`),
            h(M.NumberInput, { size: 'xs', w: 100, min: 0, decimalScale: 6, allowNegative: false, value: quantity, onChange: setQuantity })
          ),
          h(M.Switch, { size: 'xs', label: t.optional, checked: includeOptional, onChange: (e) => setIncludeOptional(e.currentTarget.checked) }),
          h(M.Switch, { size: 'xs', label: t.pairRelatives, checked: pairRelatives, onChange: (e) => setPairRelatives(e.currentTarget.checked) })
        )
  );

  const toolbarRight = h(
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
    view === 'tree' &&
      h(
        M.Tooltip,
        { label: t.expandAll, withinPortal: true },
        h(M.ActionIcon, { variant: 'transparent', onClick: () => setExpanded(new Set(allKeys)), 'aria-label': t.expandAll }, h(IconExpand))
      ),
    view === 'tree' &&
      h(
        M.Tooltip,
        { label: t.collapseAll, withinPortal: true },
        h(M.ActionIcon, { variant: 'transparent', onClick: () => setExpanded(new Set()), 'aria-label': t.collapseAll }, h(IconCollapse))
      ),
    h(
      M.Tooltip,
      { label: t.refresh, withinPortal: true },
      h(M.ActionIcon, { variant: 'transparent', disabled: !compareId, onClick: () => setReloadKey((k) => k + 1), 'aria-label': t.refresh }, h(IconRefresh))
    ),
    h(
      M.Tooltip,
      { label: t.download, withinPortal: true },
      h(M.ActionIcon, { variant: 'transparent', disabled: !result, onClick: () => setExportOpen(true), 'aria-label': t.download }, h(IconDownload))
    )
  );

  let content;
  if (!compareId) {
    content = h(M.Text, { c: 'dimmed', size: 'sm', ta: 'center', py: 'xl' }, t.noSelection);
  } else {
    const table = view === 'tree' ? treeTable() : flatTable();
    const counts = view === 'tree' ? result?.tree_counts || {} : result?.flat_counts || {};
    const differences = ['added', 'removed', 'changed', 'replaced'].reduce((sum, s) => sum + (counts[s] || 0), 0);
    const empty = view === 'tree' ? flatRows.length === 0 : visibleFlat.length === 0;

    content = h(
      M.Stack,
      { gap: 'xs' },
      result &&
        h(
          M.Group,
          { gap: 'xs' },
          h(M.Text, { size: 'sm' }, `A: ${result.part_a.full_name}`),
          h(M.Text, { size: 'sm', c: 'dimmed', style: { display: 'flex' } }, h(IconArrowRight)),
          h(M.Text, { size: 'sm' }, `B: ${result.part_b.full_name}`),
          ['removed', 'added', 'changed', 'replaced', 'unchanged'].map((s) =>
            h(
              M.Badge,
              {
                key: s,
                variant: mode === s ? 'filled' : 'light',
                color: STATUS_COLOR[s],
                style: { cursor: 'pointer' },
                onClick: () => setMode(mode === s ? 'diff' : s),
              },
              `${t.status[s]}: ${counts[s] || 0}`
            )
          )
        ),
      h(
        M.Box,
        { pos: 'relative' },
        h(M.LoadingOverlay, { visible: loading, loaderProps: { type: 'dots' }, overlayProps: { blur: 0, opacity: 0.4 } }),
        h(
          M.Table.ScrollContainer,
          { minWidth: 1000 },
          h(
            M.Table,
            { withTableBorder: true, withColumnBorders: true, striped: true, highlightOnHover: true, verticalSpacing: 'xs', fz: 'sm' },
            h(M.Table.Thead, {}, table.header),
            h(
              M.Table.Tbody,
              {},
              empty
                ? h(
                    M.Table.Tr,
                    {},
                    h(
                      M.Table.Td,
                      { colSpan: table.columns },
                      h(M.Text, { c: 'dimmed', ta: 'center', py: 'xl', size: 'sm' }, loading ? '' : result && differences === 0 && mode !== 'all' && mode !== 'unchanged' ? t.identical : t.noRows)
                    )
                  )
                : table.body
            )
          )
        )
      )
    );
  }

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
        h(M.Menu.Target, {}, h('div', { style: { position: 'fixed', left: contextMenu.x, top: contextMenu.y, width: 1, height: 1 } })),
        h(
          M.Menu.Dropdown,
          {},
          contextMenu.a &&
            h(
              M.Menu.Item,
              { leftSection: h(IconArrowRight), onClick: () => { const p = contextMenu.a; setContextMenu(null); navigateToPart(p); } },
              contextMenu.b && contextMenu.b.pk !== contextMenu.a.pk ? `${t.viewPartA}: ${contextMenu.a.display_name}` : t.viewPartA
            ),
          contextMenu.b &&
            (!contextMenu.a || contextMenu.b.pk !== contextMenu.a.pk) &&
            h(
              M.Menu.Item,
              { leftSection: h(IconArrowRight), onClick: () => { const p = contextMenu.b; setContextMenu(null); navigateToPart(p); } },
              contextMenu.a ? `${t.viewPartB}: ${contextMenu.b.display_name}` : t.viewPartB
            )
        )
      )
    );

  return h(
    M.Stack,
    { gap: 'sm' },
    rowMenu,
    h(ExportModal, {
      t,
      opened: exportOpen,
      onClose: () => setExportOpen(false),
      view,
      buildUrl: (format, exportView, onlyDiff) => {
        const q = new URLSearchParams(params);
        q.set('view', exportView);
        q.set('only_diff', onlyDiff ? '1' : '0');
        return `${base}compare/${partId}/${compareId}/export/${format}/?${q.toString()}`;
      },
    }),
    h(M.Text, { size: 'sm', c: 'dimmed' }, t.intro),
    picker,
    compareId && h(M.Group, { justify: 'space-between', wrap: 'wrap', gap: 'sm', align: 'flex-end' }, options, toolbarRight),
    error && h(M.Alert, { color: 'red', title: t.loadFailed }, String(error)),
    content,
    h(M.Text, { size: 'xs', c: 'dimmed', ta: 'right' }, `v${ctx.version || ''}`)
  );
}

// -------------------------------------------------------------- export modal

function ExportModal({ t, opened, onClose, view, buildUrl }) {
  const [format, setFormat] = useState('xlsx');
  const [exportView, setExportView] = useState(view);
  const [onlyDiff, setOnlyDiff] = useState(true);

  useEffect(() => {
    if (opened) setExportView(view);
  }, [opened, view]);

  const doExport = () => {
    const link = document.createElement('a');
    link.href = buildUrl(format, exportView, onlyDiff);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    onClose();
  };

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
        onChange: (v) => v && setFormat(v),
        comboboxProps: { withinPortal: true },
      }),
      h(M.Select, {
        label: t.exportView,
        description: t.exportViewHint,
        required: true,
        allowDeselect: false,
        data: [
          { value: 'tree', label: t.viewTree },
          { value: 'flat', label: t.viewFlat },
        ],
        value: exportView,
        onChange: (v) => v && setExportView(v),
        comboboxProps: { withinPortal: true },
      }),
      h(M.Switch, { label: t.exportOnlyDiff, description: t.exportOnlyDiffHint, checked: onlyDiff, onChange: (e) => setOnlyDiff(e.currentTarget.checked) }),
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
  return h(BomComparePanel, { context });
}
