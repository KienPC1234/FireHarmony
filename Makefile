# AlphaCentauriAB — commands for the FIRMS calendar.
PY      := .venv/bin/python
BACKEND := backend
PORT    ?= 8000

.PHONY: help install install-dev venv sample fetch fetch-missing ingest test-backend test-clean test-full test agent-check check-fast check-release e2e dev demo build pm2-start pm2-anubis-start pm2-anubis-stop clean demo-pack demo-verify demo-install rebuild-subset prewarm

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: venv  ## full python (torch/CUDA) + frontend deps; release/demo only
	$(PY) -m pip install -r $(BACKEND)/requirements.txt
	cd frontend && npm install

install-dev: venv  ## agent stack: serving + tests + dataframes, no torch
	$(PY) -m pip install -r $(BACKEND)/requirements-dev.txt
	cd frontend && npm install

venv:
	@test -x .venv/bin/python || python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip

fetch:  ## download real FIRMS CSVs (needs FIRMS_MAP_KEY; vars: AOI_BBOX SOURCES DAYS AOI)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.fetch_firms --bbox "$${AOI_BBOX:-104,10,109,16}" --days $${DAYS:-5} --sources "$${SOURCES:-VIIRS_SNPP_NRT,MODIS_NRT}" --aoi "$${AOI:-custom}"

fetch-missing:  ## fetch only manifest-missing days (vars: AOI START_YEAR END_YEAR BBOX SOURCES MAX_REQUESTS DELAY DRY_RUN)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.fetch_missing --aoi "$${AOI:-vietnam}" --start-year "$${START_YEAR:-2019}" --end-year "$${END_YEAR:-2025}" --workers 2 $${BBOX:+--bbox $$BBOX} $${SOURCES:+--sources $$SOURCES} $${MAX_REQUESTS:+--max-requests $$MAX_REQUESTS} $${DELAY:+--delay $$DELAY} $${DRY_RUN:+--dry-run}

ingest:  ## ingest a FIRMS CSV server-side (vars: FILE AOI=custom SOURCE=file)
	curl -fsS -X POST "http://127.0.0.1:$(PORT)/api/firms/ingest?aoi=$${AOI:-custom}&source=$${SOURCE:-file}" -F "file=@$(FILE)"

sample:  ## generate the deterministic FIRMS sample CSV
	$(PY) backend/scripts/firms/make_sample.py

demo-pack:  ## build a small real FIRMS demo pack from the local raw pull (vars: AOI FROM TO)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.demo_pack build --aoi "$${AOI:-vietnam}" --from "$${FROM:-2024-01}" --to "$${TO:-2025-12}" --force
	cd $(BACKEND) && ../$(PY) -m scripts.firms.demo_pack verify

demo-verify:  ## verify the demo pack checksums/row counts
	cd $(BACKEND) && ../$(PY) -m scripts.firms.demo_pack verify

demo-install:  ## copy the verified demo pack into data/firms/raw (real NASA subset)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.demo_pack install

prewarm:  ## warm raw calendar caches and print measured request costs
	cd $(BACKEND) && ../$(PY) -m scripts.firms.prewarm --base "$${BASE:-http://127.0.0.1:$(PORT)}" $${AOI:+--aoi $$AOI}

test-backend:  ## dev loop: clean-source tests (~70 s; raw/SPA skipped)
	cd $(BACKEND) && FIRMS_SKIP_RAW=1 FIRMS_SKIP_DIST=1 ../$(PY) -m pytest tests/test_firms.py -q

test-clean:  ## alias of test-backend
	$(MAKE) test-backend

test-full:  ## release-only: real raw data + SPA build (can take ~40 min)
	cd $(BACKEND) && FIRMS_RUN_RAW=1 ../$(PY) -m pytest -q

check-fast:  ## alias of test-backend (kept for muscle memory)
	$(MAKE) test-backend

agent-check:  ## one gate for agents: backend clean + frontend lint/unit/build (~90 s)
	cd $(BACKEND) && FIRMS_SKIP_RAW=1 FIRMS_SKIP_DIST=1 ../$(PY) -m pytest tests/test_firms.py -q
	cd frontend && npm run lint
	cd frontend && npm run test
	cd frontend && npm run build

rebuild-subset:  ## verify the committed 4.3 MB raw fixture (fast raw path)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.rebuild_subset

check-release:  ## release gate (slow; runs pytest once inside check_release)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.check_release

e2e:  ## HTTP smoke against a running server (vars: BASE)
	cd $(BACKEND) && ../$(PY) -m scripts.e2e_smoke --base "$${BASE:-http://127.0.0.1:8000}"

test:  ## alias of agent-check (never a 40-min surprise)
	$(MAKE) agent-check

dev:  ## API :$(PORT) + Vite :5173
	@echo "API  -> http://127.0.0.1:$(PORT)/docs"
	@echo "App  -> http://127.0.0.1:5173"
	@cd $(BACKEND) && ../$(PY) -m uvicorn app.main:app --reload --port $(PORT) & \
	 cd frontend && npm run dev & \
	 wait

demo: build  ## build SPA, serve API + dashboard on :$(PORT)
	@echo "Dashboard -> http://127.0.0.1:$(PORT)/"
	cd $(BACKEND) && ../$(PY) -m uvicorn app.main:app --port $(PORT)

build:  ## build the dashboard into frontend/dist
	cd frontend && npm run build

pm2-start: build  ## start the API under PM2
	pm2 start ecosystem.config.cjs

pm2-anubis-start:  ## start the opt-in Anubis bot-guard in front of :8000 (see docs/ANUBIS.md)
	pm2 start anubis.ecosystem.config.cjs

pm2-anubis-stop:  ## stop the Anubis bot-guard (traffic goes direct again)
	pm2 stop anubis || true

clean:  ## drop build output and caches
	rm -rf frontend/dist .pytest_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
