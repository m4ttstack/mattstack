/**
 * The folders of an org repo a member's clone checks out. The org repo may
 * also hold an app's code, docs or scripts, none of which rt reads, so join
 * makes a sparse clone in cone mode. Cone mode always keeps the top-level
 * files too, which rt needs: `.sops.yaml` holds the rules sops encrypts the
 * org secrets with.
 */
export const ORG_CLONE_FOLDERS: readonly string[] = [".claude-plugin", "mattstack"];
