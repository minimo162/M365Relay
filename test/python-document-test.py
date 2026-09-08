"""Storage invariants; standard library only, no Office or third-party imports."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("document_runtime", Path(__file__).resolve().parents[1] / "python/document_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_new_output_is_complete_and_staging_is_removed(self):
        target = self.root / "new.bin"
        runtime.publish(target, lambda p: p.write_bytes(b"complete"))
        self.assertEqual(target.read_bytes(), b"complete")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_failed_writer_leaves_no_final_or_staging(self):
        def fail(p):
            p.write_bytes(b"partial")
            raise RuntimeError("fixture")
        with self.assertRaises(RuntimeError):
            runtime.publish(self.root / "result.bin", fail)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_existing_file_and_creation_race_preserve_other_writer(self):
        target = self.root / "existing.bin"
        target.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            runtime.publish(target, lambda p: self.fail("must not call writer"))
        self.assertEqual(target.read_bytes(), b"existing")
        other = self.root / "raced.bin"
        def race(p):
            p.write_bytes(b"ours")
            other.write_bytes(b"other writer")
        with self.assertRaises(FileExistsError):
            runtime.publish(other, race)
        self.assertEqual(other.read_bytes(), b"other writer")
        self.assertEqual(len(list(self.root.iterdir())), 2)

    def test_dangling_symlink_cannot_redirect_output(self):
        destination = self.root / "not-requested.bin"
        link = self.root / "requested.bin"
        try:
            link.symlink_to(destination)
        except OSError as error:
            self.skipTest(f"Symlink creation unavailable: {error}")
        with self.assertRaises(FileExistsError):
            runtime.publish(link, lambda p: p.write_bytes(b"unexpected"))
        self.assertFalse(destination.exists())
        self.assertTrue(link.is_symlink())


if __name__ == "__main__":
    unittest.main()
