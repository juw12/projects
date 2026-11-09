# keyin macOS keyboard hook (placeholder)
#
# Full implementation will use CGEventTapCreate from CoreGraphics,
# gated by Accessibility permission. For v1 we ship a stub that exits
# cleanly so the Node side knows the platform is supported but the
# helper is not yet wired up.

import Foundation
import CoreGraphics

print("{\"type\":\"info\",\"message\":\"macOS hook requires Accessibility permission; not yet implemented.\"}")
fflush(stdout)

RunLoop.main.run()
