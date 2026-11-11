"""Verify deployed imports without access to the source checkout."""

import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.build_sparkedhost_bundle import build_bundle


class PackageImportTests(unittest.TestCase):
    def test_isolated_deployment_imports_every_module_and_runs_canary_help(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            archive_path = output / 'bot.zip'
            build_bundle(root, archive_path)
            deployed = output / 'deployed'
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(deployed)
            environment = dict(os.environ)
            environment.pop('PYTHONPATH', None)
            probe = '''
import importlib
import pkgutil
import main
import fixembed

for module in pkgutil.walk_packages(fixembed.__path__, 'fixembed.'):
    importlib.import_module(module.name)
from fixembed.runtime import client
assert len(client.tree.get_commands()) == 13
print('Package imports complete')
'''
            result = subprocess.run(
                [sys.executable, '-c', probe], cwd=deployed, env=environment,
                capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Package imports complete', result.stdout)
            canary = subprocess.run(
                [sys.executable, '-m', 'fixembed.conformance', '--help'],
                cwd=deployed, env=environment, capture_output=True, text=True,
                timeout=30,
            )
            self.assertEqual(canary.returncode, 0, canary.stderr)
            self.assertIn('--manifest', canary.stdout)
