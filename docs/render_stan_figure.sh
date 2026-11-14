#!/usr/bin/env bash
# Rebuild the STAN architecture figure (docs/stan_architecture.{svg,png,pdf}).
#
# Needs XeLaTeX (for fontspec/Times New Roman) and poppler-utils (pdftocairo).
#   Debian: apt-get install texlive-xetex texlive-fonts-recommended poppler-utils
set -euo pipefail

cd "$(dirname "$0")"

xelatex -interaction=nonstopmode -halt-on-error stan_architecture.tex
pdftocairo -svg  stan_architecture.pdf stan_architecture.svg
pdftocairo -png -r 300 -singlefile stan_architecture.pdf stan_architecture

rm -f stan_architecture.aux stan_architecture.log stan_architecture.out
echo "wrote stan_architecture.svg, stan_architecture.png, stan_architecture.pdf"
