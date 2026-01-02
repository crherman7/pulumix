#!/bin/bash
#
# Ensure k3d cluster exists for local development
# This script is called via hooks in pulumix.yaml
#
set -e

CLUSTER_NAME="${CLUSTER_NAME:-hello-world}"
REGISTRY_PORT="${REGISTRY_PORT:-5001}"
LB_PORT="${LB_PORT:-80}"

# Check if k3d is installed
if ! command -v k3d &> /dev/null; then
  echo "Error: k3d is not installed"
  echo "Install it from: https://k3d.io/"
  exit 1
fi

# Check if cluster exists
if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"$CLUSTER_NAME\""; then
  echo "Cluster '$CLUSTER_NAME' already exists"
  exit 0
fi

echo "Creating k3d cluster '$CLUSTER_NAME'..."
k3d cluster create "$CLUSTER_NAME" \
  --registry-create "${CLUSTER_NAME}-registry:0.0.0.0:${REGISTRY_PORT}" \
  --port "${LB_PORT}:80@loadbalancer" \
  --agents 2 \
  --wait

echo "Cluster '$CLUSTER_NAME' created successfully"
