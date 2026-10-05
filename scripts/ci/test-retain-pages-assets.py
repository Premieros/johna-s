import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('retain-pages-assets.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / 'dist'
        (self.output / 'assets').mkdir(parents=True)
        (self.output / 'index.html').write_text('CURRENT HTML')
        (self.output / 'assets/current.js').write_bytes(b'current JS')
        self.archive = self.root / 'artifact.tar'
        self.now = 2000000000

    def archive_files(self, files, link=None):
        with tarfile.open(self.archive, 'w') as tar:
            for name, value in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(value)
                tar.addfile(info, io.BytesIO(value))
            if link:
                info = tarfile.TarInfo(link)
                info.type = tarfile.SYMTYPE
                info.linkname = '../index.html'
                tar.addfile(info)

    def run_retention(self):
        module.retain(self.output, self.archive, self.now)

    def test_preserves_old_assets_and_current_html(self):
        self.archive_files({'./assets/old.js': b'old JS', './index.html': b'OLD HTML'})
        self.run_retention()
        self.assertEqual((self.output / 'assets/old.js').read_bytes(), b'old JS')
        self.assertEqual((self.output / 'assets/current.js').read_bytes(), b'current JS')
        self.assertEqual((self.output / 'index.html').read_text(), 'CURRENT HTML')

    def test_retains_unexpired_assets_and_prunes_expired_assets(self):
        manifest = {'assets/recent.js': self.now - 100, 'assets/expired.js': self.now - module.RETENTION_SECONDS - 1}
        self.archive_files({'assets/recent.js': b'recent', 'assets/expired.js': b'expired', module.MANIFEST: json.dumps(manifest).encode()})
        self.run_retention()
        self.assertTrue((self.output / 'assets/recent.js').exists())
        self.assertFalse((self.output / 'assets/expired.js').exists())
        self.assertEqual(json.loads((self.output / module.MANIFEST).read_text())['assets/recent.js'], self.now - 100)

    def test_rejects_collision_before_copying(self):
        self.archive_files({'assets/old.js': b'old', 'assets/current.js': b'WRONG'})
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.run_retention()
        self.assertFalse((self.output / 'assets/old.js').exists())
        self.assertEqual((self.output / 'assets/current.js').read_bytes(), b'current JS')

    def test_normalizes_paths_before_collision_check(self):
        self.archive_files({'./assets/./current.js': b'WRONG'})
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.run_retention()

    def test_rejects_traversal(self):
        self.archive_files({'assets/../../escape.js': b'escape'})
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.run_retention()
        self.assertFalse((self.root / 'escape.js').exists())

    def test_rejects_symlink_assets(self):
        self.archive_files({}, link='assets/link.js')
        with self.assertRaisesRegex(ValueError, 'regular'):
            self.run_retention()

    def test_accepts_identical_existing_assets(self):
        self.archive_files({'assets/current.js': b'current JS'})
        self.run_retention()
        self.assertEqual((self.output / 'assets/current.js').read_bytes(), b'current JS')

    def test_fails_closed_on_size_limit(self):
        self.archive_files({'assets/old.js': b'1234567890'})
        original = module.MAX_BYTES
        try:
            module.MAX_BYTES = 12
            with self.assertRaisesRegex(ValueError, 'Combined'):
                self.run_retention()
        finally:
            module.MAX_BYTES = original
        self.assertFalse((self.output / 'assets/old.js').exists())


if __name__ == '__main__':
    unittest.main()
