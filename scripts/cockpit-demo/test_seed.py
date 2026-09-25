import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("seed.py")
SPEC = importlib.util.spec_from_file_location("cockpit_demo_seed", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {MODULE_PATH}")
SEED = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SEED)


class CockpitDemoSeedTest(unittest.TestCase):
    def test_writes_both_provider_trees_and_enables_retained_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            claude = root / "claude"
            codex = root / "codex"
            data = root / "data"

            self.assertEqual(SEED.seed(claude, codex), (5, 5))
            SEED.enable_retained_catalog(data)

            self.assertEqual(len(list(claude.rglob("*.jsonl"))), 5)
            self.assertEqual(len(list(codex.rglob("*.jsonl"))), 5)
            self.assertEqual(
                len(list((codex / "2026" / "09" / "24").glob("*.jsonl"))),
                5,
            )
            install = json.loads((data / "install.json").read_text())
            self.assertEqual(install["catalogFamilies"], ["claude", "codex"])
            self.assertTrue(install["catalogMetadataMigrationComplete"])

    def test_preserves_existing_install_identity_and_catalog_families(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            install_path = data / "install.json"
            install_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "installId": "existing-demo-install",
                        "createdAt": "2026-09-01T00:00:00Z",
                        "catalogFamilies": ["gemini", "claude"],
                        "catalogMetadataMigrationComplete": True,
                    }
                )
            )

            SEED.enable_retained_catalog(data)

            install = json.loads(install_path.read_text())
            self.assertEqual(install["installId"], "existing-demo-install")
            self.assertEqual(
                install["catalogFamilies"], ["gemini", "claude", "codex"]
            )


if __name__ == "__main__":
    unittest.main()
