# A small Swift notifier app delivers notifications

Notifications come from a ~100-line Swift `.app` built in this repo (UNUserNotificationCenter, ad-hoc signed), which the server invokes; a click opens the work item's URL, captured into the Chrome PWA window by its "open supported links" setting.

## Considered Options

- `terminal-notifier`: barely maintained, flaky on recent macOS, no control over click handling.
- PWA Web Notifications: nothing fires while Chrome is closed, which breaks "notify when the ball comes back".
