import re
from pathlib import Path

import setuptools

HERE = Path(__file__).parent

long_description = (HERE / 'README.md').read_text(encoding='utf-8')
version = re.search(
    r"PLUGIN_VERSION = '([^']+)'",
    (HERE / 'inventree_flat_bom' / '__init__.py').read_text(encoding='utf-8'),
).group(1)

setuptools.setup(
    name='inventree-flat-bom',
    version=version,
    author='Cezary Ćwikowski',
    author_email='cwikowski.czarek123@gmail.com',
    description='An InvenTree plugin which shows a bottom-level (flattened) BOM with summed quantities, stock and shortages.',
    long_description=long_description,
    long_description_content_type='text/markdown',
    url='https://github.com/CezarZcezar/inventree-flat-bom',
    license='MIT',
    keywords=['inventree', 'plugin', 'export', 'bom', 'flat bom'],
    packages=setuptools.find_packages(exclude=['tests', 'tests.*']),
    include_package_data=True,
    package_data={'inventree_flat_bom': ['static/*.js']},
    classifiers=[
        'Programming Language :: Python :: 3',
        'License :: OSI Approved :: MIT License',
        'Operating System :: OS Independent',
        'Framework :: Django',
        'Framework :: InvenTree',
    ],
    python_requires='>=3.10',
    # tablib (with xlsx support) is already shipped with InvenTree
    install_requires=[],
    entry_points={
        'inventree_plugins': [
            'FlatBomPlugin = inventree_flat_bom.plugin:FlatBomPlugin',
        ]
    },
)
