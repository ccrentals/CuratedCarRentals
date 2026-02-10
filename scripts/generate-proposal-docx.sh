#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_HTML="$ROOT_DIR/docs/curated-car-rentals-proposal.html"
OUTPUT_DOCX="$ROOT_DIR/docs/curated-car-rentals-proposal.docx"

if [[ ! -f "$INPUT_HTML" ]]; then
  echo "Missing input file: $INPUT_HTML" >&2
  exit 1
fi

textutil -convert docx "$INPUT_HTML" -output "$OUTPUT_DOCX" \
  -title "Curated Car Rentals - Website Proposal" \
  -subject "Website proposal and pricing overview" \
  -timeout 30 -noload -nostore

echo "Wrote: $OUTPUT_DOCX"
