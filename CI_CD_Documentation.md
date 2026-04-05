# CI/CD Documentation for Phoenix Mesh Kubernetes Deployment

## Introduction
This document outlines the CI/CD processes for deploying Phoenix Mesh on Kubernetes using various workflows and scripts to automate the build, test, and deployment processes.

## Prerequisites
- Docker
- Kubernetes Cluster
- GitHub Actions
- Docker Registry Access
- kubectl installed
  
## Workflow Files

### 1. build-and-push.yml
- This workflow builds Docker images for the application and pushes them to a Docker registry.
- Example:
```yaml
name: Build and Push

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2
      - name: Log in to Docker Hub
        uses: docker/login-action@v1
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      - name: Build the Docker image
        run: |
          docker build -t phoenix-mesh:latest .
      - name: Push the Docker image
        run: |
          docker push phoenix-mesh:latest
```

### 2. k8s-validate.yml
- Validates Kubernetes deployment manifests before deployment.
- Example:
```yaml
name: Validate Kubernetes

on:
  push:
    branches:
      - main

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2
      - name: Set up Kubeconfig
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" > kubeconfig
          export KUBECONFIG=kubeconfig
      - name: Validate manifests
        run: |
          kubectl apply --dry-run=client -f k8s/
```

### 3. docker-compose-test.yml
- Testing local Docker Compose configurations.
- Example:
```yaml
version: '3'
services:
  phoenix-mesh:
    image: phoenix-mesh:latest
    build: .
    ports:
      - '8080:8080'
```

### 4. k8s-deploy.yml
- Deploys the built Docker image to the Kubernetes cluster.
- Example:
```yaml
name: Kubernetes Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v2
      - name: Set up Kubeconfig
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" > kubeconfig
          export KUBECONFIG=kubeconfig
      - name: Deploy to Kubernetes
        run: |
          kubectl apply -f k8s/deployment.yml
          kubectl apply -f k8s/service.yml
```

### 5. k8s-smoke-tests.yml
- Basic smoke tests to validate the deployment after it happens.
- Example:
```yaml
name: Smoke Tests

on:
  workflow_run:
    workflows: ["Kubernetes Deploy"]
    types: [completed]

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - name: Wait for deployment
        run: |
          kubectl rollout status deployment/phoenix-mesh
      - name: Run smoke tests
        run: |
          curl -f -s http://<service-url>/health
```

## Setup Scripts
### Setup Kubernetes
```bash
#!/bin/bash
set -e

# Install necessary tools
apt-get update
apt-get install -y kubectl docker-compose
```

## Conclusion
This documentation serves as a guide to set up CI/CD for Phoenix Mesh with Kubernetes. Follow the instructions carefully, and modify the examples to suit your specific deployment needs.
