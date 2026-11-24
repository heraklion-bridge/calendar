#!/bin/sh
command -v node >/dev/null || { printf '%s\n' 'Εγκαταστήστε Node.js 24.'; exit 1; }
exec node "$(dirname "$0")/main.js"
