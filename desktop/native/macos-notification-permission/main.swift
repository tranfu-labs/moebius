import Foundation
import UserNotifications

let usage = "usage: macos-notification-permission <status|request>\n"

func settingValue(_ setting: UNNotificationSetting) -> String {
  switch setting {
  case .notSupported:
    return "notSupported"
  case .disabled:
    return "disabled"
  case .enabled:
    return "enabled"
  @unknown default:
    return "unknown"
  }
}

func authorizationValue(_ status: UNAuthorizationStatus) -> String {
  switch status {
  case .notDetermined:
    return "notDetermined"
  case .denied:
    return "denied"
  case .authorized:
    return "authorized"
  case .provisional:
    return "provisional"
  @unknown default:
    return "unknown"
  }
}

func permissionJSON(_ settings: UNNotificationSettings) -> String {
  let authorization = authorizationValue(settings.authorizationStatus)
  let alert = settingValue(settings.alertSetting)
  let sound = settingValue(settings.soundSetting)
  let badge = settingValue(settings.badgeSetting)
  return "{\"authorizationStatus\":\"\(authorization)\",\"alert\":\"\(alert)\",\"sound\":\"\(sound)\",\"badge\":\"\(badge)\"}"
}

let arguments = CommandLine.arguments
guard arguments.count == 2, arguments[1] == "status" || arguments[1] == "request" else {
  FileHandle.standardError.write(usage.data(using: .utf8)!)
  exit(2)
}
let mode = arguments[1]
let semaphore = DispatchSemaphore(value: 0)
var result = ""

func readSettings() {
  UNUserNotificationCenter.current().getNotificationSettings { settings in
    result = permissionJSON(settings)
    semaphore.signal()
  }
}

if mode == "request" {
  UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
    if let error = error {
      result = "{\"error\": \"\(error.localizedDescription)\"}"
      semaphore.signal()
      return
    }
    readSettings()
  }
} else {
  readSettings()
}

semaphore.wait()
print(result)
exit(result.hasPrefix("{\"error\"") ? 1 : 0)
