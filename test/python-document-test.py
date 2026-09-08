"""Storage invariants; standard library only, no Office or third-party imports."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

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


class XlsxInputTests(unittest.TestCase):
    def test_literal_formula_like_text_and_boundaries_are_retained(self):
        data = {"cells": {"A1": {"value": "=SUM(B1:B2)"}, "A2": "00123", "B1": "x"*32767,
                          "XFD1048576": {"formula": "=SUM(B2:B3)"}}}
        self.assertEqual(runtime.validate_xlsx_input(data), data)

    def test_long_text_is_rejected_instead_of_openpyxl_truncation(self):
        for value in ("x"*32768, "😀"*16384):
            with self.assertRaises(ValueError):
                runtime.validate_xlsx_input({"cells": {"A1": value}})

    def test_ambiguous_and_unsupported_cells_are_rejected(self):
        for entry in ({"value": "original", "formula": "1+1"}, {"value": "a", "typo": True},
                      ["a", "b"], float("nan"), {"formula": "==1+1"}, {"formula": "= "}):
            with self.assertRaises(ValueError):
                runtime.validate_xlsx_input({"cells": {"A1": entry}})
        for address in ("A1:B2", "XFE1", "A1048577", "A01"):
            with self.assertRaises(ValueError):
                runtime.validate_xlsx_input({"cells": {address: "data"}})

    def test_duplicate_json_is_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder)/"data.json", Path(folder)/"result.xlsx"
            source.write_text('{"cells":{"A1":"first","A1":"second"}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                runtime.xlsx_create(target, source)
            self.assertFalse(target.exists())



class PowerPointOrderTests(unittest.TestCase):
    def test_readback_follows_presentation_order_not_part_filenames(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"reordered.pptx"
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
                z.writestr("ppt/_rels/presentation.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>')
                for n in (1,2,3):
                    z.writestr(f"ppt/slides/slide{n}.xml", f'<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Slide {n}</a:t></a:r></a:p>')
            self.assertEqual([p["text"] for p in runtime.office_text(path)["parts"]], ["Slide 2", "Slide 1"])

if __name__ == "__main__":
    unittest.main()
