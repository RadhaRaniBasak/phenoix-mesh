# Phoenix Mesh 🔥

A **self-healing microservice mesh** with intelligent sidecars, autonomous control plane, and automatic rollback capabilities. Uses **local Ollama LLM** for AI-powered Root Cause Analysis (RCA).

## Overview

Phoenix Mesh provides:

- ✅ **Autonomous Health Monitoring**: Sidecar agents probe microservices every 5 seconds
- ✅ **Intelligent Failure Detection**: Local Ollama LLM analyzes root causes (cost-free!)
- ✅ **Automatic Rollback**: Kubernetes-native recovery without manual intervention
- ✅ **Observability**: Prometheus metrics & health dashboards
- ✅ **Circuit Breaking**: Graceful degradation during failures
- ✅ **Zero Cost**: Uses local Ollama instead of expensive cloud LLMs
- ✅ **Offline Capable**: All analysis happens locally with no external API calls
- ✅ **Production Ready**: Graceful shutdown, proper error handling, health checks

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Phoenix Mesh Control Plane                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  RCA Engine (Ollama) + K8s Rollback Engine     │   │
│  └─────────────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────────────┘
                   │ (HTTP)
      ┌────────────┼────────────┐
      │            │            │
 ┌────▼───┐  ┌────▼───┐  ┌───▼────┐
 │ Order  │  │Payment │  │Inventory│
 │Service │  │Service │  │Service  │
 └────┬───┘  └────┬───┘  └───┬────┘
      │           │           │
 ┌────▼───┐  ┌────▼───┐  ┌───▼────┐
 │ Order  │  │Payment │  │Inventory│
 │Sidecar │  │Sidecar │  │Sidecar  │
 │(Probe) │  │(Probe) │  │(Probe)  │
 └────────┘  └────────┘  └─────────┘
      │           │           │
      └───────────┼───────────┘
                  │
            ┌─────▼──────┐
            │ Prometheus │
            │  (Metrics) │
            └────────────┘
                  │
            ┌─────▼──────┐
            │  Ollama    │
            │   (LLM)    │
            └────────────┘
```

## Quick Start ⚡

### 1. **Clone Repository**
```bash
git clone https://github.com/RadhaRaniBasak/phoenix-mesh.git
cd phoenix-mesh
```

### 2. **Setup Environment**
```bash
cp .env.example .env
# Edit .env if needed (defaults work fine!)
```

### 3. **Start Services**
```bash
docker-compose up -d
```

### 4. **Install Ollama Model**
```bash
# Wait for Ollama to be healthy (~30 seconds)
sleep 30
docker-compose exec ollama ollama pull mistral
```

### 5. **Verify Services**
```bash
# Check all services
docker-compose ps

# Controller health
curl http://localhost:8080/health

# Prometheus
curl http://localhost:9091/api/v1/targets

# Order Sidecar
curl http://localhost:9101/status

# Payment Sidecar
curl http://localhost:9102/status
```

## Configuration 🔧

### Environment Variables

Key variables in `.env`:

```bash
# Ollama Configuration
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=mistral              # or: neural-chat, llama2, mistral
OLLAMA_TIMEOUT_MS=60000

# RCA Provider
RCA_PROVIDER=ollama               # Use local Ollama for cost-free analysis

# Sidecar Health Checks
PROBE_INTERVAL_MS=5000            # Check every 5 seconds
FAIL_THRESHOLD=3                  # Failure after 3 consecutive checks
PROBE_TIMEOUT_MS=2000             # 2 second timeout per check

# Recovery
RECOVERY_WINDOW_MS=60000          # 60 second window for auto-recovery
```

## API Documentation 📡

### Controller Endpoints

#### **POST /api/failure** - Report service failure
```bash
curl -X POST http://localhost:8080/api/failure \
  -H "Content-Type: application/json" \
  -d '{
    "service": "order-service",
    "podName": "order-pod-1",
    "namespace": "default",
    "errorType": "CRASH",
    "consecutiveFails": 3,
    "lastError": {
      "message": "Connection refused",
      "type": "CRASH",
      "ts": 1680000000000
    }
  }'
```

#### **POST /api/recovery** - Report service recovery
```bash
curl -X POST http://localhost:8080/api/recovery \
  -H "Content-Type: application/json" \
  -d '{
    "service": "order-service",
    "namespace": "default"
  }'
```

#### **GET /api/incidents** - View active incidents
```bash
curl http://localhost:8080/api/incidents | jq
```

**Response:**
```json
{
  "system": "phoenix-mesh",
  "active_count": 1,
  "incidents": [
    {
      "key": "default/order-service",
      "service": "order-service",
      "startedAt": 1680000000000,
      "steps": [
        {
          "step": "isolation",
          "result": { "rerouted": true, "healthyPods": 2 },
          "ts": 1680000000100
        }
      ]
    }
  ]
}
```

#### **GET /health** - Health check
```bash
curl http://localhost:8080/health | jq
```

**Response:**
```json
{
  "status": "ok",
  "mesh": "phoenix",
  "k8sReady": false,
  "uptime": 123.456,
  "timestamp": "2026-04-05T10:30:00.000Z"
}
```

### Sidecar Endpoints

#### **GET /status** - Sidecar status
```bash
curl http://localhost:9101/status | jq
```

**Response:**
```json
{
  "status": "HEALTHY",
  "service": "order-service",
  "consecutiveFails": 0,
  "lastCheck": 1680000000000,
  "uptime": 12345
}
```

#### **GET /metrics** - Prometheus metrics
```bash
curl http://localhost:9101/metrics
```

## Service Endpoints 🎯

### Order Service (Port 3000)

- **GET /health** - Health check
- **GET /orders** - List all orders
- **GET /orders/:id** - Get order details
- **POST /orders** - Create new order
- **PUT /orders/:id/status** - Update order status

### Payment Service (Port 3000)

- **GET /health** - Health check
- **POST /process** - Process payment
- **GET /transactions/:id** - Get transaction details
- **GET /orders/:orderId/transactions** - List transactions
- **POST /transactions/:id/refund** - Refund payment

## Testing Failure Scenarios 🧪

### 1. **Trigger Test Failure**
```bash
curl -X POST http://localhost:8080/api/test/failure \
  -H "Content-Type: application/json" \
  -d '{
    "service": "order-service",
    "errorType": "CRASH"
  }'
```

### 2. **Monitor RCA Analysis**
```bash
# Check active incidents
curl http://localhost:8080/api/incidents | jq '.incidents[0]'

# View Ollama logs for analysis details
docker-compose logs phoenix-controller | grep -i "rca\|ollama"
```

### 3. **Watch Metrics**
Open **http://localhost:9091** in browser:
- Search for `service_errors_total`
- Search for `service_health`
- Search for `service_probe_latency_ms`

## Monitoring & Observability 📊

### Prometheus Dashboard
- **URL**: http://localhost:9091
- **Default Scrape Interval**: 15 seconds
- **Targets**: Prometheus → Controller → Sidecars

### Key Metrics

| Metric | Description |
|--------|-------------|
| `service_health` | 1=healthy, 0=unhealthy |
| `service_errors_total` | Total errors by type |
| `service_probe_latency_ms` | Health check latency |
| `service_probes_total` | Total probes (success/failure) |

### View Metrics

```bash
# Health status
curl http://localhost:9091/api/v1/query?query=service_health

# Error rate
curl http://localhost:9091/api/v1/query?query=rate(service_errors_total[5m])

# Latency p95
curl http://localhost:9091/api/v1/query?query=histogram_quantile(0.95,service_probe_latency_ms)
```

## Troubleshooting 🔍

### **Services won't start**
```bash
# Check logs
docker-compose logs

# Restart everything
docker-compose down
docker-compose up -d
```

### **Ollama not ready**
```bash
# Check Ollama status
docker-compose logs ollama

# Pull model manually
docker exec phoenix-ollama ollama pull mistral

# Verify model installed
docker exec phoenix-ollama ollama list
```

### **Controller can't reach Ollama**
```bash
# Test connectivity from controller
docker exec phoenix-controller \
  curl http://ollama:11434/api/tags

# Check if model is loaded
docker exec phoenix-ollama ollama list
```

### **Metrics not appearing in Prometheus**
```bash
# Check scrape targets
curl http://localhost:9091/api/v1/targets

# Check prometheus.yml
cat prometheus.yml | grep -A5 "job_name"

# Verify sidecars are exposing metrics
curl http://localhost:9101/metrics
curl http://localhost:9102/metrics
```

### **Sidecars can't reach services**
```bash
# Test connectivity
docker-compose exec order-sidecar \
  curl http://order-service:3000/health

# Check network
docker network inspect phoenix-mesh_phoenix-mesh-net
```

## Performance Tuning ⚙️

### Adjust Probe Frequency
```bash
# More aggressive health checks
PROBE_INTERVAL_MS=2000            # Check every 2 seconds
FAIL_THRESHOLD=2                  # Fail faster

# More conservative
PROBE_INTERVAL_MS=10000           # Check every 10 seconds
FAIL_THRESHOLD=5                  # More tolerance
```

### Scale Ollama for Better Performance
```bash
# Increase timeout for complex models
OLLAMA_TIMEOUT_MS=120000          # 2 minute timeout

# Use faster model
OLLAMA_MODEL=neural-chat          # Faster than mistral
```

## Production Deployment 🚀

### Kubernetes Setup
```yaml
# Create namespace
kubectl create namespace phoenix-mesh

# Deploy control plane
kubectl apply -f k8s/controller.yaml

# Deploy sidecars
kubectl apply -f k8s/sidecars.yaml

# Deploy Ollama
kubectl apply -f k8s/ollama.yaml
```

### Environment Variables for K8s
```yaml
env:
  - name: K8S_IN_CLUSTER
    value: "true"
  - name: RCA_PROVIDER
    value: "ollama"
  - name: OLLAMA_HOST
    value: "http://ollama:11434"
```

## Development 👨‍💻

### Local Setup
```bash
# Install dependencies
cd controller && npm install
cd ../sidecar && npm install
cd ../service/order-service && npm install
cd ../service/payment-service && npm install

# Run individually with watch mode
cd controller && npm run dev
```

### Testing
```bash
# Run tests (placeholder)
npm test

# Create test incident
curl -X POST http://localhost:8080/api/test/failure
```

## Contributing 🤝

1. Fork repository
2. Create feature branch
3. Make changes
4. Test locally with docker-compose
5. Submit PR

## License 📄

MIT License - See [LICENSE](LICENSE) file

## Support 💬

- Issues: [GitHub Issues](https://github.com/RadhaRaniBasak/phoenix-mesh/issues)
- Discussions: [GitHub Discussions](https://github.com/RadhaRaniBasak/phoenix-mesh/discussions)

---

**Built with ❤️ & passion  by Radha Rani Basak**
