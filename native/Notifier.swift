// Control Room's notifier. The server runs it with --title/--body/--url[/--sound] to post one
// notification; macOS relaunches it with no arguments when the user clicks one, and it opens the URL.
import AppKit
import UserNotifications

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let center = UNUserNotificationCenter.current()

  func applicationDidFinishLaunching(_ note: Notification) {
    let args = parse(CommandLine.arguments.dropFirst())
    guard let title = args["title"] else { return quit(after: 10) }  // launched by a click: wait for it
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted else { return self.quit(after: 0) }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = args["body"] ?? ""
      if args["sound"] != nil { content.sound = .default }
      if let url = args["url"] { content.userInfo = ["url": url] }
      if let thread = args["thread"] { content.threadIdentifier = thread }
      let id = args["id"] ?? UUID().uuidString
      self.center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { _ in
        self.quit(after: 1)
      }
    }
  }

  // A click, whether this process posted the notification or macOS launched it for the click.
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    if let s = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) {
      NSWorkspace.shared.open(url)
    }
    done()
    quit(after: 0.5)
  }

  // Banners show even while Control Room is frontmost (notification rules: multiple monitors).
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  func parse(_ argv: ArraySlice<String>) -> [String: String] {
    var out: [String: String] = [:]
    var it = argv.makeIterator()
    while let a = it.next() {
      guard a.hasPrefix("--") else { continue }
      let key = String(a.dropFirst(2))
      out[key] = key == "sound" ? "1" : (it.next() ?? "")
    }
    return out
  }

  func quit(after seconds: Double) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { NSApp.terminate(nil) }
  }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
UNUserNotificationCenter.current().delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
