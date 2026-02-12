#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_HTML="$ROOT_DIR/docs/curated-car-rentals-proposal.html"
OUTPUT_DOCX="$ROOT_DIR/docs/curated-car-rentals-proposal.docx"
PUBLIC_HTML="$ROOT_DIR/public/curated-car-rentals-proposal.html"
PUBLIC_DOCX="$ROOT_DIR/public/curated-car-rentals-proposal.docx"

if [[ ! -f "$INPUT_HTML" ]]; then
  echo "Missing input file: $INPUT_HTML" >&2
  exit 1
fi

textutil -convert docx "$INPUT_HTML" -output "$OUTPUT_DOCX" \
  -title "Curated Car Rentals - Website Proposal" \
  -subject "Website proposal and pricing overview" \
  -timeout 30 -noload -nostore

echo "Wrote: $OUTPUT_DOCX"

cp -f "$INPUT_HTML" "$PUBLIC_HTML"
cp -f "$OUTPUT_DOCX" "$PUBLIC_DOCX"
echo "Synced to Next.js public/: $PUBLIC_HTML"
echo "Synced to Next.js public/: $PUBLIC_DOCX"
