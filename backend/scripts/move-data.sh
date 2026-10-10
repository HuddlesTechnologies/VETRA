#!/usr/bin/env bash
# One-time move of every row from the old database into the cPanel one.
#
#   Old (source): the DB_* values in backend/.env on this Mac, which
#                 point at the Clever Cloud database the live site uses.
#   New (target): the cPanel MySQL database. You're asked for its name,
#                 user and password; nothing is written to any file.
#
# Shows a dry run first (tables and row counts), asks before copying,
# and finishes by comparing row counts table by table
# (scripts/copy-data.js does the actual work).
#
# Before running: turn on Maintenance mode on the live site, and add
# this Mac's IP under cPanel > Remote MySQL. See backend/README.md,
# "Moving to cPanel", step 8.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "backend/.env not found. It should hold the old database's DB_* settings."
  exit 1
fi

# Value of KEY from .env, without surrounding quotes.
env_value() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

export SOURCE_DB_HOST="$(env_value DB_HOST)"
export SOURCE_DB_PORT="$(env_value DB_PORT)"
export SOURCE_DB_NAME="$(env_value DB_NAME)"
export SOURCE_DB_USER="$(env_value DB_USER)"
export SOURCE_DB_PASSWORD="$(env_value DB_PASSWORD)"
export SOURCE_DB_SSL="$(env_value DB_SSL)"

echo "Old database: ${SOURCE_DB_HOST}/${SOURCE_DB_NAME}"
echo

read -r -p "cPanel server [vetrahq.org]: " TARGET_HOST
read -r -p "cPanel database name [podopkbu_vetra]: " TARGET_NAME
read -r -p "cPanel database user [podopkbu_vetra]: " TARGET_USER
read -r -s -p "cPanel database password (hidden as you type): " TARGET_PASSWORD
echo
echo

export DB_HOST="${TARGET_HOST:-vetrahq.org}"
export DB_PORT="${TARGET_DB_PORT:-3306}"
export DB_NAME="${TARGET_NAME:-podopkbu_vetra}"
export DB_USER="${TARGET_USER:-podopkbu_vetra}"
export DB_PASSWORD="$TARGET_PASSWORD"
export DB_SSL=false

echo "== Dry run: what will be copied =="
node scripts/copy-data.js
echo

read -r -p "Copy everything now? This replaces whatever is in the cPanel database. Type yes to continue: " ANSWER
if [ "$ANSWER" != "yes" ]; then
  echo "Stopped, nothing was copied."
  exit 0
fi

node scripts/copy-data.js --yes
