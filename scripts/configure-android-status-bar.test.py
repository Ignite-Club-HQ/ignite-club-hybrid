"""Regression checks against the installed Capacitor Android scaffold."""
import importlib.util
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("statusbar", ROOT / "scripts/configure-android-status-bar.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load Android configuration helper")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AndroidStatusBarTests(unittest.TestCase):
    def test_actual_scaffold_uses_matching_backdrop_in_every_activity_theme(self):
        with tempfile.TemporaryDirectory() as tmp:
            frontend = Path(tmp)
            with tarfile.open(ROOT / "frontend/node_modules/@capacitor/cli/assets/android-template.tar.gz") as archive:
                for name in ["app/src/main/res/values/styles.xml", "app/src/main/java/com/getcapacitor/myapp/MainActivity.java"]:
                    member = archive.extractfile(name)
                    self.assertIsNotNone(member)
                    if member is None:
                        raise RuntimeError(name)
                    dest = frontend / "android" / name.replace("com/getcapacitor/myapp", "com/igniteclubhq/app")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(member.read())
            (frontend / "native/android").mkdir(parents=True)
            shutil.copyfile(ROOT / "frontend/native/android/StatusBarBackdropPlugin.java", frontend / "native/android/StatusBarBackdropPlugin.java")
            MODULE.configure(frontend)
            MODULE.configure(frontend)
            styles = ET.parse(frontend / "android/app/src/main/res/values/styles.xml").getroot().findall("style")
            self.assertEqual(len(styles), 3)
            for style in styles:
                items = {i.get("name"): i.text for i in style.findall("item")}
                self.assertEqual(items["android:windowBackground"], "#f5f7f6")
                self.assertEqual(items["android:windowLightStatusBar"], "true")
            activity = (frontend / "android/app/src/main/java/com/igniteclubhq/app/MainActivity.java").read_text()
            self.assertEqual(activity.count("registerPlugin(StatusBarBackdropPlugin.class)"), 1)
            self.assertLess(activity.index("registerPlugin("), activity.index("super.onCreate("))
            self.assertTrue((frontend / "android/app/src/main/java/com/igniteclubhq/app/StatusBarBackdropPlugin.java").is_file())

    def test_both_android_builds_run_shared_configuration(self):
        workflow = (ROOT / "codemagic.yaml").read_text()
        for name, next_name in [("android-debug", "android-release"), ("android-release", "ios-debug")]:
            section = workflow.split("  " + name + ":", 1)[1].split("  " + next_name + ":", 1)[0]
            self.assertIn("python3 ../scripts/configure-android-status-bar.py", section)


if __name__ == "__main__":
    unittest.main()