#!/usr/bin/env bash
# Prints the Authorization header for the SonarQube Cloud MCP server (see .mcp.json).
# The token is SONARQUBE_TOKEN from the environment, or else from the .env file at the repository root.
set -euo pipefail

token="${SONARQUBE_TOKEN:-}"

if [[ -z "$token" ]]; then
   env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"

   if [[ ! -f "$env_file" ]]; then
      echo "sonarqube-mcp-headers: SONARQUBE_TOKEN is not set and $env_file not found" >&2
      exit 1
   fi

   token="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?SONARQUBE_TOKEN[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -n 1)"
   token="${token%$'\r'}"
   token="${token#\"}"; token="${token%\"}"
   token="${token#\'}"; token="${token%\'}"
fi

if [[ -z "$token" ]]; then
   echo "sonarqube-mcp-headers: SONARQUBE_TOKEN is set neither in the environment nor in .env" >&2
   exit 1
fi

printf '{"Authorization": "Bearer %s"}\n' "$token"
