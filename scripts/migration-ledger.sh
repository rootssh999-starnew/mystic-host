#!/usr/bin/env bash
set -euo pipefail

# Apply every migration in lexical/numeric filename order and record successful runs.
# Existing installations created before the ledger are bootstrapped only when their
# complete legacy schema sentinel is present; unknown migrations are always executed.

migration_schema_exists() {
  local database=$1
  local kind=$2
  local name=$3
  if [[ "$kind" == table ]]; then
    mysql --batch --skip-column-names "$database" -e \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='$name'" | grep -qx '1'
  else
    local table=$4
    mysql --batch --skip-column-names "$database" -e \
      "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='$table' AND column_name='$name'" | grep -qx '1'
  fi
}

legacy_migration_complete() {
  local database=$1
  local migration=$2
  case "$migration" in
    0000_*.sql)
      migration_schema_exists "$database" table users
      ;;
    0001_*.sql)
      migration_schema_exists "$database" table database_hosts &&
        migration_schema_exists "$database" table server_databases &&
        mysql --batch --skip-column-names "$database" -e \
          "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='schedules' AND column_name='lastRunAt'" | grep -qx '1'
      ;;
    0002_*.sql) migration_schema_exists "$database" table jobs ;;
    0003_*.sql)
      migration_schema_exists "$database" column installScript servers &&
        migration_schema_exists "$database" column variablesJson servers
      ;;
    0004_*.sql)
      migration_schema_exists "$database" column progress jobs &&
        migration_schema_exists "$database" column message jobs
      ;;
    0005_*.sql) migration_schema_exists "$database" table api_keys ;;
    0006_*.sql)
      migration_schema_exists "$database" column timezone schedules &&
        migration_schema_exists "$database" table schedule_runs
      ;;
    0007_*.sql) migration_schema_exists "$database" table invitations ;;
    0008_*.sql)
      migration_schema_exists "$database" column sessionVersion users &&
        migration_schema_exists "$database" table password_resets
      ;;
    0009_*.sql)
      migration_schema_exists "$database" column totpSecretEncrypted users &&
        migration_schema_exists "$database" column totpEnabled users &&
        migration_schema_exists "$database" column recoveryCodesHash users
      ;;
    0010_*.sql)
      migration_schema_exists "$database" table teams &&
        migration_schema_exists "$database" table team_members
      ;;
    0011_*.sql) migration_schema_exists "$database" column disabled users ;;
    0012_*.sql) migration_schema_exists "$database" table audit_events ;;
    *) return 1 ;;
  esac
}

apply_migration_ledger() {
  local database=${1:-mystic_host}
  local migration_dir=${2:-drizzle}
  local ledger_table=${MIGRATION_LEDGER_TABLE:-schema_migrations}
  [[ "$ledger_table" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Invalid migration ledger table name" >&2; return 1; }

  [[ -d "$migration_dir" ]] || { echo "Migration directory not found: $migration_dir" >&2; return 1; }
  mysql "$database" -e "CREATE TABLE IF NOT EXISTS $ledger_table (version varchar(255) NOT NULL, appliedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (version))"

  local migration version
  while IFS= read -r migration; do
    version=$(basename "$migration")
    if mysql --batch --skip-column-names "$database" -e \
      "SELECT version FROM $ledger_table WHERE version='$version' LIMIT 1" | grep -Fxq "$version"; then
      continue
    fi

    if legacy_migration_complete "$database" "$version"; then
      mysql "$database" -e "INSERT INTO $ledger_table (version) VALUES ('$version')"
      printf 'migration_bootstrapped=%s\n' "$version"
      continue
    fi

    printf 'migration_applying=%s\n' "$version"
    mysql "$database" < "$migration"
    mysql "$database" -e "INSERT INTO $ledger_table (version) VALUES ('$version')"
    printf 'migration_applied=%s\n' "$version"
  done < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' -print | sort)
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  apply_migration_ledger "${1:-mystic_host}" "${2:-drizzle}"
fi
