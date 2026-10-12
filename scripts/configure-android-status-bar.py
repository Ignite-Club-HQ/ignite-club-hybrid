"""Configure generated Android projects without changing inset/keyboard ownership."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET


def configure(frontend: Path):
    styles_path = frontend / "android/app/src/main/res/values/styles.xml"
    tree = ET.parse(styles_path)
    # NoActionBar does NOT inherit AppTheme; launch uses a third theme.
    for style in tree.getroot().findall("style"):
        if style.get("name") not in {"AppTheme", "AppTheme.NoActionBar", "AppTheme.NoActionBarLaunch"}:
            continue
        for name, value in {
            "android:windowBackground": "#f5f7f6",
            "android:statusBarColor": "#f5f7f6",
            "android:windowLightStatusBar": "true",
        }.items():
            item = next((i for i in style.findall("item") if i.get("name") == name), None)
            if item is None:
                item = ET.SubElement(style, "item", {"name": name})
            item.text = value
    tree.write(styles_path, encoding="utf-8", xml_declaration=True)

    activity = frontend / "android/app/src/main/java/com/igniteclubhq/app/MainActivity.java"
    source = activity.read_text()
    registration = "registerPlugin(StatusBarBackdropPlugin.class);"
    if registration not in source:
        # Scaffold is deliberately recreated in CI; fail rather than silently
        # omit registration if a future Capacitor template changes.
        template = "public class MainActivity extends BridgeActivity {}"
        if template not in source:
            raise RuntimeError("Unexpected MainActivity template; backdrop plugin not registered")
        source = source.replace(template, """public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(StatusBarBackdropPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(android.graphics.Color.parseColor("#f5f7f6"));
    }
}""")
        activity.write_text(source)
    shutil.copyfile(frontend / "native/android/StatusBarBackdropPlugin.java", activity.with_name("StatusBarBackdropPlugin.java"))


if __name__ == "__main__":
    configure(Path.cwd())