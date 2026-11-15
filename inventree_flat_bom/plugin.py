"""Flat BOM plugin for InvenTree.

Adds two panels to assembly parts:
- "Flat BOM": the bottom-level parts of the whole (multi-level) BOM with summed quantities,
  stock, pricing and shortages, plus CSV / XLSX export.
- "BOM Compare": compares the BOM with another assembly (structure and flat), including the
  inside of sub-assemblies which were replaced by another revision / variant.
"""

from __future__ import annotations

from django.urls import path
from django.utils.translation import gettext_lazy as _

from plugin import InvenTreePlugin
from plugin.mixins import UrlsMixin, UserInterfaceMixin

from . import PLUGIN_VERSION, compare_views, views


class FlatBomPlugin(UserInterfaceMixin, UrlsMixin, InvenTreePlugin):
    """Bottom-level (flattened) BOM with stock and shortages."""

    NAME = 'FlatBOM'
    SLUG = 'flat_bom'
    TITLE = _('Flat BOM')
    DESCRIPTION = _('Bottom-level BOM: leaf parts of all sub-assemblies with summed quantities, stock and shortages')
    VERSION = PLUGIN_VERSION
    AUTHOR = 'Cezary Ćwikowski'
    PUBLISH_DATE = '2026-11-15'
    WEBSITE = 'https://github.com/CezarZcezar/inventree-flat-bom'
    LICENSE = 'MIT'
    MIN_VERSION = '1.0.0'

    def setup_urls(self):
        """URL endpoints of the plugin (mounted at /plugin/flat_bom/)."""
        return [
            path('bom/<int:pk>/', views.flat_bom_view, name='bom'),
            path('bom/<int:pk>/export/<str:fmt>/', views.export_view, name='export'),
            path('compare/<int:pk_a>/<int:pk_b>/', compare_views.compare_view, name='compare'),
            path('compare/<int:pk_a>/<int:pk_b>/export/<str:fmt>/', compare_views.compare_export_view, name='compare-export'),
            path('related/<int:pk>/', compare_views.related_view, name='related'),
            path('ui/<str:tag>/<str:name>', views.panel_script_view, name='panel-js'),
        ]

    @property
    def plugin_url(self) -> str:
        """Absolute URL prefix of the plugin endpoints, e.g. /plugin/flat_bom/."""
        return '/' + self.base_url.strip('/') + '/'

    def get_ui_panels(self, request, context: dict, **kwargs):
        """Add the panel to assembly part pages."""
        from part.models import Part

        if context.get('target_model') != 'part':
            return []

        try:
            part_id = int(context.get('target_id'))
        except (TypeError, ValueError):
            return []

        if not views.can_view_parts(getattr(request, 'user', None)):
            return []

        if not Part.objects.filter(pk=part_id, assembly=True).exists():
            return []

        context_data = {
            'base_url': self.plugin_url,
            'part_id': part_id,
            'version': self.VERSION,
        }

        return [
            {
                'key': 'flat-bom',
                'title': _('Flat BOM'),
                'description': _('Bottom-level parts of the whole BOM with stock and shortages'),
                'icon': 'ti:list-tree:outline',
                # Served through Django (see views.panel_script_view), so no
                # 'collectplugins' step is needed and it works behind any proxy
                'source': f'{self.plugin_url}ui/{views.panel_script_tag("flat_bom.js")}/flat_bom.js:renderPanel',
                'context': context_data,
            },
            {
                'key': 'bom-compare',
                'title': _('BOM Compare'),
                'description': _('Compare the BOM with another assembly, including the inside of changed sub-assemblies'),
                'icon': 'ti:git-compare:outline',
                'source': f'{self.plugin_url}ui/{views.panel_script_tag("bom_compare.js")}/bom_compare.js:renderPanel',
                'context': context_data,
            },
        ]
