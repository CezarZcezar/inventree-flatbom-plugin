# InvenTree Flat BOM Plugin

[![InvenTree Plugin](https://img.shields.io/badge/InvenTree-Plugin-blue.svg)](https://inventree.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A plugin for [InvenTree](https://inventree.org) which adds two panels to assembly parts:

- **Flat BOM** – the *bottom-level* parts of the whole multi-level BOM, with the quantities of the same
  part coming from different sub-assemblies **summed**. Sub-assemblies themselves are not listed.
- **BOM Compare** – compares the BOM with another assembly (e.g. another revision or variant), including
  **the inside of sub-assemblies which were replaced** by another revision / variant (see below).

```
Assembly A                          Flat BOM of A
├── 2× PCB-1                        R1   2·10 + 1·5 = 25
│   └── 10× R1           ──►        C1   2·4        = 8
│   └──  4× C1
└── 1× PCB-2
    └──  5× R1
```

---

## Features

- **Panel on assembly parts** (only shown for parts marked *Assembly*), styled like the native InvenTree tables
  (it uses the React and Mantine components which InvenTree exposes to plugins – no build step needed).
- **Columns**: Component, IPN, Category, Description, **Reference** (designators merged from all BOM lines
  of the part, in every sub-assembly), Quantity, Unit Price, Total Price, In Stock, Available Stock, On Order,
  Shortage, Shortage incl. On Order, Used In.
- **Select columns** (remembered in the browser) and **table filters**: category, has shortage, has shortage incl.
  on order, has available stock, has pricing, has reference, optional, consumable, virtual. Plus search and sorting.
- **Build quantity**: all quantities are multiplied by the number of assemblies to build.
- **Stock and shortages**:
  - *Available Stock* – in stock minus stock allocated to build and sales orders
  - *Shortage* = quantity − available (never negative), *Shortage incl. On Order* also subtracts open purchase orders
- **Pricing**: the cached part pricing of InvenTree (min – max, in the default currency); the footer shows the total cost.
- **Used In**: from which sub-assemblies the quantity comes (e.g. `PCB-1: 20; PCB-2: 5`).
- **Context menu** (right click) with *View Part*; click a row to open the part.
- **Export** (CSV / XLSX) with the same switches as the InvenTree BOM exporter: Stock, Pricing, Supplier,
  Manufacturer, Substitute and Parameter data (+ Used In), optionally only the filtered rows.
- **Permissions**: *Parts: View* role; stock data needs the *Stock Items: View* role.

### How quantities are calculated

- Each BOM line quantity is multiplied by the quantities of all levels above it.
- A sub-assembly which has a BOM is expanded; its own BOM is loaded once even when it is used in many places.
- BOM items inherited from template parts are included (same as the InvenTree BOM table).
- An optional / consumable line marks everything below it as optional / consumable.
- Only the part entered in the BOM is counted – substitutes and variants are not added up
  (substitutes are listed in the export).
- Reference designators are merged without duplicates (`R1, R2` + `R1, R5` → `R1, R2, R5`).
- *Setup quantity*, *attrition* and *rounding multiple* are **not** applied (pure BOM quantities).
- A BOM loop (A → B → A) or a BOM deeper than 50 levels is reported as an error.

## BOM Compare

The built-in *Compare Bill of Materials* of InvenTree shows a sub-assembly which was replaced by another
part (e.g. `PCB rev A` → `PCB rev B`) only as *removed* + *added*, and its *Show different parts* mode
lists only added / removed parts – a changed quantity of a part present in both BOMs is not shown.
The **BOM Compare** panel (A = this part, B = the selected assembly) adds:

- **Quick picks** for the other revisions and variants of the part, or search for any assembly.
- **Structure view** – a level-by-level, expandable tree:
  - same part in A and B: compared field by field (quantity, reference, optional, consumable,
    allow variants, inherited, setup quantity, attrition, rounding, note) → *Changed* / *Unchanged*;
  - a part only in A and a **related** part only in B are paired as *Replaced* and – for assemblies –
    **compared inside** (recursively). Related means: another revision (`revision_of`), a variant of the
    same template, the same IPN, or optionally a **similar BOM** (Jaccard index of the bottom-level parts,
    revisions counted as the same part; adjustable threshold);
  - reference designators are compared one by one (`+R5`, ~~`R7`~~);
  - a part used twice in one BOM is paired by its reference designators.
- **Flat view** – the two Flat BOMs side by side: quantity A / B / Δ, cost Δ, available stock and
  the shortage for B, references and *Used In* for both (honours build quantity and optional items).
- **Display Mode**: all, *differences* (incl. quantity / field changes), changed, replaced,
  only in B, only in A, unchanged. Parents of matching rows are kept (dimmed) for context.
- Status counters (click to filter), search, expand / collapse all, context menu (*View Part A / B*).
- **Export** (CSV / XLSX) of the structure (with level and path) or the flat comparison, optionally
  only the differences.

Requires InvenTree 1.0+ (React UI) with **Settings → Plugins → Enable interface integration** and **Enable URL integration** turned on.

---

## Installation

### Local Docker deployment

```bash
./deploy.sh            # copies the plugin to ../inventree-data/plugins/flat_bom and restarts InvenTree
```

Then activate the plugin under **Settings → Plugins**.

### Via Git / `plugins.txt`

```
inventree-flat-bom@git+https://github.com/CezarZcezar/inventree-flat-bom.git
```

---

## Endpoints

| URL | Result |
|-----|--------|
| `/plugin/flat_bom/bom/<part id>/` | JSON (used by the panel) |
| `/plugin/flat_bom/bom/<part id>/export/csv/` | CSV |
| `/plugin/flat_bom/bom/<part id>/export/xlsx/` | XLSX |
| `/plugin/flat_bom/compare/<A>/<B>/` | comparison JSON (tree + flat) |
| `/plugin/flat_bom/compare/<A>/<B>/export/<csv\|xlsx>/` | comparison export (`view=tree\|flat`, `only_diff=1`) |
| `/plugin/flat_bom/related/<part id>/` | other revisions and variants |

Parameters: `?quantity=<n>` (default 1), `&optional=0` to skip optional BOM items.
Export only: `stock`, `pricing`, `supplier`, `manufacturer`, `substitutes`, `parameters`, `used_in` (`1` / `0`, default `1`)
and `parts=<id>,<id>` to export only some parts.

---

## Tests

The flattening and comparison logic has no InvenTree dependency and is tested on its own:

```bash
python -m unittest discover -s tests -v
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
