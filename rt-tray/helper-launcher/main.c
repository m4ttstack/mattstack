// Contents/Helpers/<name> for an app built from this checkout: runs the app's
// JS bundle (Helpers/<name>-app/main.js) on the one bundled Helpers/bun.
// scripts/build-apps.ts compiles one per app and arch with HELPER_NAME and
// HELPER_DOTENV set.
//
// A Mach-O rather than a shell script: launchd's BundleProgram, the deck
// shim and check-bundle all treat Helpers/<name> as signed code carrying the
// com.mattstack.helper.<name> identifier.
//
// The launcher's own path rides in as argv0 (process.argv0 in the app), so a
// bundled app can hand out the command that runs it again.
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef HELPER_NAME
#error "HELPER_NAME must be defined"
#endif
#ifndef HELPER_DOTENV
#error "HELPER_DOTENV must be defined (1 or 0)"
#endif

static int join(char *out, size_t cap, const char *dir, const char *rest) {
    int n = snprintf(out, cap, "%s/%s", dir, rest);
    return n > 0 && (size_t)n < cap;
}

int main(int argc, char **argv) {
    char raw[PATH_MAX];
    uint32_t rawSize = sizeof raw;
    if (_NSGetExecutablePath(raw, &rawSize) != 0) {
        fprintf(stderr, "%s: executable path too long\n", HELPER_NAME);
        return 127;
    }
    // Resolved so a symlink on PATH (rt links helpers into ~/.local/bin)
    // still finds the bundle beside the real file.
    char self[PATH_MAX];
    if (realpath(raw, self) == NULL) {
        fprintf(stderr, "%s: cannot resolve %s: %s\n", HELPER_NAME, raw, strerror(errno));
        return 127;
    }
    char dir[PATH_MAX];
    strlcpy(dir, self, sizeof dir);
    char *slash = strrchr(dir, '/');
    if (slash == NULL) return 127;
    *slash = '\0';

    char bun[PATH_MAX], entry[PATH_MAX], config[PATH_MAX], configFlag[PATH_MAX + 16];
    if (!join(bun, sizeof bun, dir, "bun") ||
        !join(entry, sizeof entry, dir, HELPER_NAME "-app/main.js") ||
        !join(config, sizeof config, dir, HELPER_NAME "-app/bunfig.toml")) {
        fprintf(stderr, "%s: bundle path too long\n", HELPER_NAME);
        return 127;
    }
    if (access(entry, R_OK) != 0) {
        fprintf(stderr, "%s: app bundle missing at %s\n", HELPER_NAME, entry);
        return 127;
    }
    // An explicit, empty bunfig: bun would otherwise read bunfig.toml (and
    // its preload) from whatever cwd the caller left it in. BUN_OPTIONS is
    // the same door through the caller's environment.
    snprintf(configFlag, sizeof configFlag, "--config=%s", config);
    unsetenv("BUN_OPTIONS");

    char **args = calloc((size_t)argc + 6, sizeof *args);
    if (args == NULL) return 127;
    int i = 0;
    args[i++] = self;
    args[i++] = "--no-install";
#if !HELPER_DOTENV
    args[i++] = "--no-env-file";
#endif
    args[i++] = configFlag;
    args[i++] = entry;
    for (int a = 1; a < argc; a++) args[i++] = argv[a];
    args[i] = NULL;

    execv(bun, args);
    fprintf(stderr, "%s: cannot run %s: %s\n", HELPER_NAME, bun, strerror(errno));
    return 127;
}
