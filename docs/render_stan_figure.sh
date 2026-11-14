#!/usr/bin/env bash
# Rebuild the STAN architecture figures:
#   stan_architecture.svg/.png/.pdf       full figure + tensor/param panels
#   stan_architecture_slide.svg/.png/.pdf compact slide banner
#
# Needs XeLaTeX (fontspec/Times New Roman) and poppler-utils (pdftocairo):
#   Debian: apt-get install texlive-xetex texlive-fonts-recommended poppler-utils
set -euo pipefail

cd "$(dirname "$0")"

for name in stan_architecture stan_architecture_slide; do
  xelatex -interaction=nonstopmode -halt-on-error "$name.tex"
  pdftocairo -svg "$name.pdf" "$name.svg"
  pdftocairo -png -r 300 -singlefile "$name.pdf" "$name"
  rm -f "$name.aux" "$name.log" "$name.out"
  echo "wrote $name.svg, $name.png, $name.pdf"
done
