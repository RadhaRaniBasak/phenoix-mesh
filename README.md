# Phoenix Mesh

A self-healing microservice mesh with autonomous sidecars, AI-powered Root Cause Analysis via [Ollama](https://ollama.ai), and automated Kubernetes rollback.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Phoenix Mesh Stack                      │
│                                                             │
│  ┌──────────────┐   probe    ┌─────────────┐               │
│  │   Sidecar    │──────────▶│   Service   │               │
│  │   Agent      │           │ (order/pay/ │               │
│  │  (metrics +  │           │  inventory) │               │
│  │   circuit    │           └─────────────┘               │
│  │   breaker)   │                                          │
│  └──────┬───────┘                                          │
│         │ failure/recovery event                           │
│         ▼                                                   │
│  ┌──────────────┐   RCA     ┌─────────────┐               │
│  │   Phoenix    │──────────▶│   Ollama    │               │
│  │  Controller  │           │  (mistral)  │               │
│  │              │◀──────────│             │               │
│  └──────┬───────┘   result  └─────────────┘               │
│         │                                                   │
│         ├──▶ Prometheus (metrics)                           │
│         ├──▶ Slack (notifications)                          │
│         └──▶ K8s API (rollback / traffic isolation)         │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- 4 GB RAM free (for Ollama + mistral model)

### 1. Clone and configure

```bash
git clone https://github.com/RadhaRaniBasak/phoenix-mesh.git
cd phoenix-mesh
cp .env.example .env
# Edit .env to set PHOENIX_SLACK_WEBHOOK_URL if you want Slack alerts
```

### 2. Start the stack

```bash
docker-compose up -d
```

### 3. Pull the Ollama model (first time only)

```bash
docker exec phoenix-ollama ollama pull mistral
```

### 4. Verify services are running

```bash
docker-compose ps
curl http://localhost:8080/health        # Phoenix Controller
curl http://localhost:9091/-/healthy     # Prometheus
curl http://localhost:11434/api/tags     # Ollama
```

## Services

| Service | Port | Description |
|---|---|---|
| `phoenix-controller` | 8080 | Control plane — incident handling, RCA, rollback |
| `prometheus` | 9091 | Metrics collection and storage |
| `ollama` | 11434 | Self-hosted LLM for AI-powered RCA |
| `order-service` | — | Sample order microservice |
| `payment-service` | — | Sample payment microservice |
| `inventory-service` | — | Sample inventory microservice |
| `order-sidecar` | 9101 | Sidecar proxy/monitor for order-service |
| `payment-sidecar` | 9102 | Sidecar proxy/monitor for payment-service |
| `inventory-sidecar` | 9103 | Sidecar proxy/monitor for inventory-service |

## API Reference

### Phoenix Controller (`:8080`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Controller health and k8s readiness status |
| `POST` | `/api/failure` | Report a service failure (called by sidecars) |
| `POST` | `/api/recovery` | Report service recovery (called by sidecars) |
| `GET` | `/api/incidents` | List active incidents |
| `POST` | `/api/test/failure` | Trigger a test incident (non-production only) |

### Sidecar Agent (`:9090`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/status` | Current sidecar state and probe history |
| `GET` | `/metrics` | Prometheus metrics endpoint |
| `ANY` | `/proxy/*` | Circuit-breaker proxy to upstream service |

## RCA Engine

Phoenix Mesh uses a layered RCA approach:

1. **Ollama (primary)** — Sends telemetry to the local LLM (`mistral` by default) for AI-powered analysis, producing a structured JSON incident report.
2. **Rules engine (fallback)** — If Ollama is unavailable, a deterministic rules-based engine classifies the failure and produces actionable recommendations instantly.
3. **Emergency fallback** — If both providers fail, a minimal report is generated so the incident is never silently dropped.

Results are cached for 5 minutes (configurable via `RCA_CACHE_TTL_MS`) to avoid redundant LLM calls for the same recurring failure.

### Supported RCA categories

`CRASH` · `MEMORY_LEAK` · `TIMEOUT` · `HTTP_5XX` · `RESOURCE_EXHAUSTION` · `DNS_FAILURE` · `CONNECTION_RESET` · `NETWORK_ERROR` · `UNKNOWN`

## Ollama Configuration

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://ollama:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `mistral` | LLM model for RCA |
| `OLLAMA_TIMEOUT_MS` | `60000` | Inference timeout (ms) |

To switch models:
```bash
docker exec phoenix-ollama ollama pull neural-chat
# Then set OLLAMA_MODEL=neural-chat in .env and restart the controller
docker-compose restart phoenix-controller
```

## Testing Self-Healing

### Trigger a test failure

```bash
curl -X POST http://localhost:8080/api/test/failure \
  -H 'Content-Type: application/json' \
  -d '{"service":"order-service","errorType":"CRASH"}'
```

### Force a service into an unhealthy state

```bash
curl -X POST http://localhost:3000/dev/toggle-health  # from inside the order-service container
```

### Monitor active incidents

```bash
curl http://localhost:8080/api/incidents
```

## Troubleshooting

**Ollama container exits / model not found**
```bash
docker exec phoenix-ollama ollama pull mistral
docker-compose restart phoenix-controller
```

**Controller fails to start** — check logs:
```bash
docker-compose logs phoenix-controller
```

**Prometheus targets are down** — verify sidecar containers are running:
```bash
docker-compose ps
curl http://localhost:9101/metrics
```

**Sidecars can't reach the controller** — ensure `CONTROLLER_URL` is set to `http://phoenix-controller:8080` (the Docker internal hostname).

## Project Structure

```
phoenix-mesh/
├── controller/              # Phoenix Control Plane
│   ├── index.js             # Express server & routes
│   ├── meshController.js    # Incident orchestration
│   ├── rcaEngine.js         # RCA entry point
│   ├── rcaFactory.js        # Provider selection & caching
│   ├── rcaProvider-ollama.js # Ollama LLM provider
│   ├── rcaProvider-rules.js  # Deterministic fallback
│   ├── logs.js              # K8s pod log collection
│   ├── prometheus.js        # Metrics queries
│   ├── rollback.js          # K8s rollback & traffic isolation
│   ├── slack.js             # Slack notifications
│   └── Dockerfile
├── sidecar/                 # Autonomous sidecar agent
│   ├── agent.js
│   └── Dockerfile
├── service/                 # Sample microservices
│   ├── order-service/
│   ├── payment-service/
│   └── inventory-service/
├── k8s/                     # Kubernetes manifests
├── prometheus.yml           # Prometheus scrape config
├── docker-compose.yml
└── .env.example
```

## License

MIT © Radha Rani Basak
