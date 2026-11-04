// Glow for Mac: the program inside Glow.app, GlowLead.app, GlowChat.app and GlowRoom.app.
// It only starts Contents/Resources/open-glow.sh with the system shell, which opens the right Glow page
// in its own app window (Chrome, Edge, Brave or Chromium, else the default browser). Being a real
// universal (Apple chip + Intel) program lets the whole app be signed like any other Mac app.
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    (void)argc;
    (void)argv;
    char executable[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0) {
        fprintf(stderr, "Glow: could not find its own location\n");
        return 1;
    }
    char resolved[PATH_MAX];
    if (realpath(executable, resolved) == NULL) {
        strncpy(resolved, executable, sizeof(resolved) - 1);
        resolved[sizeof(resolved) - 1] = '\0';
    }
    // .../Glow.app/Contents/MacOS/Glow  ->  .../Glow.app/Contents/Resources/open-glow.sh
    char macos_dir[PATH_MAX];
    strncpy(macos_dir, resolved, sizeof(macos_dir) - 1);
    macos_dir[sizeof(macos_dir) - 1] = '\0';
    char *contents_dir = dirname(dirname(macos_dir));
    char script[PATH_MAX];
    snprintf(script, sizeof(script), "%s/Resources/open-glow.sh", contents_dir);
    char *const shell_args[] = {"/bin/bash", script, NULL};
    execv("/bin/bash", shell_args);
    perror("Glow: could not start open-glow.sh");
    return 1;
}
