#!/bin/sh
# resolve-pipeline.sh -- resolve and validate this orchestrator's pipeline
# for one work type. Companion to the work skill; the chain check lives
# here or nowhere. Contract v1.1 (authoritative copy:
# references/convention.md in the parameterized-skills skill).
#   Invoke: "${CLAUDE_SKILL_DIR}/scripts/resolve-pipeline.sh" --work-type <t> [options]
#   Options: --manifest <path> --skills-dir <path> --plugin-list-cmd <cmd>
#            --seed "<field field ...>"   (default: "work-type ticket repo mode")
#   Exit 0: {"ok":true,"skill":...,"workType":...,"manifest":...,"seed":[...],"pipeline":[...]}
#   Exit 1: {"ok":false,"skill":...,"errors":[{stage,code,message,detail}]}
#   Exit 2: environment/usage error, same error shape with stage null.
# Requires: POSIX sh, awk, sed, jq. No bash-isms.
set -u

SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL_MD="$SKILL_DIR/SKILL.md"

SKILLS_DIR="${HOME}/.claude/skills"
PLUGIN_LIST_CMD="claude plugin list --json"
MANIFEST=""
WORK_TYPE=""
SEED="work-type ticket repo mode"

fail_env() { # $1=code $2=message
  printf '{"ok":false,"skill":"%s","errors":[{"stage":null,"code":"%s","message":"%s","detail":null}]}\n' \
    "${WRAPPER_NAME:-}" "$1" "$2"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --work-type)       WORK_TYPE="$2"; shift 2 ;;
    --manifest)        MANIFEST="$2"; shift 2 ;;
    --skills-dir)      SKILLS_DIR="$2"; shift 2 ;;
    --plugin-list-cmd) PLUGIN_LIST_CMD="$2"; shift 2 ;;
    --seed)            SEED="$2"; shift 2 ;;
    *) fail_env usage "unknown option; see convention.md for the pipeline contract" ;;
  esac
done

command -v jq > /dev/null 2>&1 || fail_env jq-missing "jq is required but not on PATH"
[ -f "$SKILL_MD" ] || fail_env skill-md-missing "no SKILL.md next to scripts/ (looked at its parent dir)"
[ -n "$WORK_TYPE" ] || fail_env usage "--work-type is required"

fm_top() { # $1=key -> top-level frontmatter value in $SKILL_MD
  awk -v key="$1" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && index($0, key ":") == 1 {
      val = substr($0, length(key) + 2)
      sub(/^[[:space:]]*/, "", val); sub(/^"/, "", val); sub(/"$/, "", val)
      print val; exit
    }
  ' "$SKILL_MD"
}
fm_meta() { # $1=SKILL.md path, $2=metadata key -> value
  awk -v key="$2" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && $0 == "metadata:" { meta = 1; next }
    meta && $0 !~ /^[[:space:]]/ { meta = 0 }
    meta {
      line = $0; sub(/^[[:space:]]+/, "", line)
      if (index(line, key ":") == 1) {
        val = substr(line, length(key) + 2)
        sub(/^[[:space:]]*/, "", val); sub(/^"/, "", val); sub(/"$/, "", val)
        print val; exit
      }
    }
  ' "$1"
}

WRAPPER_NAME=$(fm_top name)
[ -n "$WRAPPER_NAME" ] || fail_env name-missing "SKILL.md frontmatter has no name:"

RES_FILE=$(mktemp "${TMPDIR:-/tmp}/resolve-pipeline.res.XXXXXX") || fail_env tmp-failed "mktemp failed"
ERR_FILE=$(mktemp "${TMPDIR:-/tmp}/resolve-pipeline.err.XXXXXX") || fail_env tmp-failed "mktemp failed"
trap 'rm -f "$RES_FILE" "$ERR_FILE"' EXIT

err() { # $1=stage-or-null $2=code $3=message [$4=detail-json]
  DETAIL=${4:-null}
  if [ "$1" = null ]; then
    jq -n --arg code "$2" --arg msg "$3" --argjson detail "$DETAIL" \
      '{stage: null, code: $code, message: $msg, detail: $detail}' >> "$ERR_FILE"
  else
    jq -n --arg stage "$1" --arg code "$2" --arg msg "$3" --argjson detail "$DETAIL" \
      '{stage: $stage, code: $code, message: $msg, detail: $detail}' >> "$ERR_FILE"
  fi
}
finish() { # emit and exit per ERR_FILE contents
  if [ -s "$ERR_FILE" ]; then
    jq -s --arg skill "$WRAPPER_NAME" '{ok: false, skill: $skill, errors: .}' "$ERR_FILE"
    exit 1
  fi
  SEED_JSON=$(printf '%s\n' $SEED | jq -R . | jq -sc .)
  jq -s --arg skill "$WRAPPER_NAME" --arg wt "$WORK_TYPE" --arg manifest "$MANIFEST" --argjson seed "$SEED_JSON" \
    '{ok: true, skill: $skill, workType: $wt, manifest: $manifest, seed: $seed, pipeline: .}' "$RES_FILE"
  exit 0
}

# --- manifest: same walk as resolve-args, but required here ---
if [ -z "$MANIFEST" ]; then
  d=$PWD
  while :; do
    [ "$d" = "$HOME" ] && break
    if [ -f "$d/.mattstack/skills.jsonc" ]; then MANIFEST="$d/.mattstack/skills.jsonc"; break; fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  if [ -z "$MANIFEST" ]; then
    # Per-repo manifest, keyed by the normalized origin remote.
    # Known limitation: an explicit port (ssh://host:2222/path) stays in
    # the slug; both writer and readers share this, so they agree.
    REPO_REMOTE=$(git remote get-url origin 2> /dev/null || true)
    if [ -n "$REPO_REMOTE" ]; then
      u=${REPO_REMOTE%.git}
      u=${u#ssh://}; u=${u#https://}; u=${u#http://}; u=${u#git://}
      u=${u#*@}
      u=$(printf %s "$u" | sed 's|:|/|')
      _host=${u%%/*}; _path=${u#*/}
      REPO_SLUG="$(printf %s "$_host" | tr 'A-Z' 'a-z')-$(printf %s "$_path" | tr '/' '-')"
      if [ -f "$HOME/.mattstack/repos/$REPO_SLUG/skills.jsonc" ]; then
        MANIFEST="$HOME/.mattstack/repos/$REPO_SLUG/skills.jsonc"
      fi
    fi
  fi
  if [ -z "$MANIFEST" ] && [ -f "$HOME/.mattstack/skills.jsonc" ]; then
    MANIFEST="$HOME/.mattstack/skills.jsonc"
  fi
fi
if [ -z "$MANIFEST" ] || [ ! -f "$MANIFEST" ]; then
  err null no-manifest "a pipeline needs a bindings manifest; no manifest: not in an upward .mattstack/skills.jsonc from $PWD (stopping before \$HOME), not in \$HOME/.mattstack/repos/<slug>/skills.jsonc for this repo's remote, not in \$HOME/.mattstack/skills.jsonc"
  finish
fi
if ! MANIFEST_JSON=$(sed 's|^[[:space:]]*//.*$||' "$MANIFEST" | jq -c . 2> /dev/null); then
  err null manifest-invalid "manifest is not valid JSONC: $MANIFEST"
  finish
fi

PIPELINE_JSON=$(printf '%s' "$MANIFEST_JSON" | jq -c --arg t "$WORK_TYPE" '.pipelines[$t] // empty')
if [ -z "$PIPELINE_JSON" ]; then
  err null no-pipeline "manifest $MANIFEST has no pipelines entry for work type \"$WORK_TYPE\""
  finish
fi
if ! printf '%s' "$PIPELINE_JSON" | jq -e 'type == "array" and length > 0 and all(.[]; type == "string")' > /dev/null; then
  err null pipeline-invalid "pipelines.$WORK_TYPE must be a non-empty array of skill names"
  finish
fi

PLUGIN_JSON=$($PLUGIN_LIST_CMD 2> /dev/null) || PLUGIN_JSON='[]'
printf '%s' "$PLUGIN_JSON" | jq -e . > /dev/null 2>&1 || PLUGIN_JSON='[]'

AVAILABLE=" $SEED "
CHAIN_TRUSTED=1
COUNT=$(printf '%s' "$PIPELINE_JSON" | jq 'length')
i=0
while [ "$i" -lt "$COUNT" ]; do
  NAME=$(printf '%s' "$PIPELINE_JSON" | jq -r ".[$i]")
  i=$((i + 1))

  INNER_DIR=""; SOURCE=""
  if [ -f "$SKILLS_DIR/$NAME/SKILL.md" ]; then
    INNER_DIR="$SKILLS_DIR/$NAME"; SOURCE=skills-dir
  else
    case "$NAME" in
      *:*)
        PLUGIN_NAME=${NAME%%:*}; INNER_SKILL=${NAME#*:}
        INSTALL_PATH=$(printf '%s' "$PLUGIN_JSON" | jq -r --arg p "$PLUGIN_NAME" \
          '[.[] | select(.enabled and (.id | startswith($p + "@")))][0].installPath // empty')
        if [ -n "$INSTALL_PATH" ]; then
          # Flat layout first, then one category level (a plugin whose
          # manifest lists skills/<category> dirs installs the categories).
          if [ -f "$INSTALL_PATH/skills/$INNER_SKILL/SKILL.md" ]; then
            INNER_DIR="$INSTALL_PATH/skills/$INNER_SKILL"; SOURCE=plugin
          else
            for CAT_DIR in "$INSTALL_PATH"/skills/*/"$INNER_SKILL"; do
              if [ -f "$CAT_DIR/SKILL.md" ]; then
                INNER_DIR="$CAT_DIR"; SOURCE=plugin
                break
              fi
            done
          fi
          # Unregistered stages (moved out of skills/ to drop the typed
          # slash menu entry) live under attachments/, same flat-then-
          # one-category-level shape.
          if [ -z "$INNER_DIR" ]; then
            if [ -f "$INSTALL_PATH/attachments/$INNER_SKILL/SKILL.md" ]; then
              INNER_DIR="$INSTALL_PATH/attachments/$INNER_SKILL"; SOURCE=attachments
            else
              for CAT_DIR in "$INSTALL_PATH"/attachments/*/"$INNER_SKILL"; do
                if [ -f "$CAT_DIR/SKILL.md" ]; then
                  INNER_DIR="$CAT_DIR"; SOURCE=attachments
                  break
                fi
              done
            fi
          fi
        fi
        ;;
    esac
  fi
  if [ -z "$INNER_DIR" ]; then
    err "$NAME" stage-not-installed "pipeline entry \"$NAME\" is not in $SKILLS_DIR, and no enabled plugin has it under skills/ or attachments/ (flat or one group level)"
    CHAIN_TRUSTED=0
    continue
  fi

  STAGE=$(fm_meta "$INNER_DIR/SKILL.md" stage)
  if [ -z "$STAGE" ]; then
    err "$NAME" not-a-stage "\"$NAME\" has no metadata.stage; it cannot appear in a pipeline"
    CHAIN_TRUSTED=0
    continue
  fi
  SC=$(fm_meta "$INNER_DIR/SKILL.md" stage-consumes)
  SP=$(fm_meta "$INNER_DIR/SKILL.md" stage-produces)
  if [ -z "$SC" ] || [ -z "$SP" ]; then
    err "$NAME" stage-decl-invalid "\"$NAME\" declares metadata.stage but lacks stage-consumes or stage-produces"
    CHAIN_TRUSTED=0
    continue
  fi

  if [ "$CHAIN_TRUSTED" = 1 ]; then
    for F in $SC; do
      [ "$F" = "-" ] && continue
      case "$AVAILABLE" in
        *" $F "*) : ;;
        *) err "$NAME" chain-broken "stage consumes \"$F\" but no earlier stage produces it and it is not in the seed" ;;
      esac
    done
  fi
  for F in $SP; do
    [ "$F" = "-" ] || AVAILABLE="$AVAILABLE$F "
  done

  SLOTS_DECL=$(fm_meta "$INNER_DIR/SKILL.md" slots)
  SLOTS_JSON=null
  if [ -n "$SLOTS_DECL" ]; then
    if [ ! -f "$INNER_DIR/scripts/resolve-args.sh" ]; then
      err "$NAME" resolver-missing "\"$NAME\" declares slots but ships no scripts/resolve-args.sh"
      continue
    fi
    INNER_OUT=$(sh "$INNER_DIR/scripts/resolve-args.sh" --manifest "$MANIFEST" \
      --skills-dir "$SKILLS_DIR" --plugin-list-cmd "$PLUGIN_LIST_CMD")
    INNER_STATUS=$?
    if [ "$INNER_STATUS" -eq 0 ]; then
      SLOTS_JSON=$(printf '%s' "$INNER_OUT" | jq -c '.resolved')
    else
      DETAIL=$(printf '%s' "$INNER_OUT" | jq -c '.errors // null' 2> /dev/null) || DETAIL=null
      [ -n "$DETAIL" ] || DETAIL=null
      err "$NAME" stage-unresolved "stage \"$NAME\" slot resolution failed (exit $INNER_STATUS)" "$DETAIL"
      continue
    fi
  fi

  jq -n --arg name "$NAME" --arg stage "$STAGE" --arg source "$SOURCE" \
    --arg path "$INNER_DIR" --arg sc "$SC" --arg sp "$SP" --argjson slots "$SLOTS_JSON" \
    '{name: $name, stage: $stage, source: $source, path: $path,
      consumes: ($sc | split(" ") | map(select(. != "" and . != "-"))),
      produces: ($sp | split(" ") | map(select(. != "" and . != "-"))),
      slots: $slots}' >> "$RES_FILE"
done

finish
