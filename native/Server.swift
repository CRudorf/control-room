// What launchd runs: execs the Bun server, so the login item belongs to Control Room.
// argv[1...] is the command to run (bun and its arguments), passed through from the LaunchAgent.
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
  FileHandle.standardError.write("usage: control-room-server <program> [args...]\n".data(using: .utf8)!)
  exit(2)
}
let cargs = args.map { strdup($0) } + [nil]
execv(args[0], cargs)
perror("execv \(args[0])")
exit(1)
