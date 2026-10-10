#!/usr/bin/env bash
# Wires Firebase push into the freshly scaffolded Capacitor iOS project.
# Run from frontend/ after `npx cap sync ios`. Needs GOOGLE_SERVICE_INFO_PLIST
# (base64); without it the app builds with notifications switched off.
set -euo pipefail
APP=ios/App/App

if [ -z "${GOOGLE_SERVICE_INFO_PLIST:-}" ]; then
  echo "GOOGLE_SERVICE_INFO_PLIST not set - building without push"
  exit 0
fi

echo "$GOOGLE_SERVICE_INFO_PLIST" | base64 --decode > "$APP/GoogleService-Info.plist"

# Push entitlement (production APNs for App Store / TestFlight builds).
cat > "$APP/App.entitlements" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>aps-environment</key><string>production</string>
</dict></plist>
EOF

# Background mode so notifications arrive while the app is closed.
PL="$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$PL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string remote-notification" "$PL" || true
/usr/libexec/PlistBuddy -c "Add :FirebaseAppDelegateProxyEnabled bool false" "$PL" 2>/dev/null || true

# Add the Firebase plist to the app target and point signing at the entitlements.
ruby - <<'RUBY'
require 'xcodeproj'
proj = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = proj.targets.find { |t| t.name == 'App' }
group = proj.main_group.find_subpath('App', false) || proj.main_group
unless group.files.any? { |f| f.path == 'GoogleService-Info.plist' }
  ref = group.new_file('GoogleService-Info.plist')
  target.resources_build_phase.add_file_reference(ref)
end
target.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
proj.save
RUBY

# Start Firebase and hand Apple's device token to it (Capacitor plugins listen
# for these notifications).
python3 - <<'PY'
p = "ios/App/App/AppDelegate.swift"
s = open(p).read()
if "FirebaseCore" not in s:
    s = s.replace("import Capacitor", "import Capacitor\nimport FirebaseCore\nimport FirebaseMessaging", 1)
    s = s.replace("        return true", "        FirebaseApp.configure()\n        return true", 1)
    extra = '''
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
'''
    i = s.rstrip().rfind("}")
    s = s[:i] + extra + "}\n"
    open(p, "w").write(s)
PY
echo "iOS push wired"
