# AlphaCentauriAB — commands for the FIRMS calendar.
PY      := .venv/bin/python
BACKEND := backend
PORT    ?= 8000

.PHONY: help install sample fetch ingest test-backend test dev demo build pm2-start db-init db-health clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install:  ## python + frontend dependencies
	$(PY) -m pip install -r $(BACKEND)/requirements.txt
	cd frontend && npm install

fetch:  ## download real FIRMS CSVs (needs FIRMS_MAP_KEY; vars: AOI_BBOX SOURCES DAYS AOI)
	cd $(BACKEND) && ../$(PY) -m scripts.firms.fetch_firms --bbox "$${AOI_BBOX:-104,10,109,16}" --days $${DAYS:-7} --sources "$${SOURCES:-VIIRS_SNPP_NRT,MODIS_NRT}" --aoi "$${AOI:-custom}"

ingest:  ## ingest a FIRMS CSV server-side (vars: FILE AOI=custom SOURCE=file)
	curl -fsS -X POST "http://127.0.0.1:$(PORT)/api/firms/ingest?aoi=$${AOI:-custom}&source=$${SOURCE:-file}" -F "file=@$(FILE)"

sample:  ## generate the deterministic FIRMS sample CSV
	$(PY) backend/scripts/firms/make_sample.py

test-backend:  ## firms tests only (no network/GPU)
	cd $(BACKEND) && ../$(PY) -m pytest tests/test_firms.py -q

test:  ## backend tests + frontend lint/unit/build
	cd $(BACKEND) && ../$(PY) -m pytest tests -q
	cd frontend && npm run lint
	cd frontend && npm run test
	cd frontend && npm run build

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

db-init:  ## create PostgreSQL schema using backend/.env
	cd $(BACKEND) && ../$(PY) scripts/init_db.py

db-health:  ## ask the running API whether PostgreSQL is reachable
	curl -fsS http://127.0.0.1:$(PORT)/api/db/health

clean:  ## drop build output and caches
	rm -rf frontend/dist .pytest_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
