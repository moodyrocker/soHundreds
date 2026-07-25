#!/usr/bin/env bash
# Run once on the EC2 instance (non-root user with sudo).
# Preferred: Ubuntu 22.04/24.04 (user: ubuntu).
# Also supports Amazon Linux 2023/2 (user: ec2-user) if you stay on AL.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as ubuntu or ec2-user (not root). Script uses sudo where needed."
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Cannot detect OS (/etc/os-release missing)."
  exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) NGROK_ARCH=amd64 ;;
  aarch64) NGROK_ARCH=arm64 ;;
  *)
    echo "Unsupported arch: $ARCH"
    exit 1
    ;;
esac

install_ngrok_tarball() {
  if command -v ngrok >/dev/null 2>&1; then
    echo "ngrok already present: $(ngrok version)"
    return
  fi
  echo "Installing ngrok ($NGROK_ARCH)…"
  TMP="$(mktemp -d)"
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${NGROK_ARCH}.tgz" \
    | tar -xz -C "$TMP"
  sudo mv "$TMP/ngrok" /usr/local/bin/ngrok
  sudo chmod +x /usr/local/bin/ngrok
  rm -rf "$TMP"
  echo "ngrok installed: $(ngrok version)"
}

install_compose_plugin_github() {
  if sudo docker compose version >/dev/null 2>&1; then
    echo "Compose already present: $(sudo docker compose version)"
    return
  fi
  echo "Installing Docker Compose plugin for $ARCH…"
  local dir="/usr/local/lib/docker/cli-plugins"
  local ver="v2.32.4"
  sudo mkdir -p "$dir"
  sudo curl -fsSL \
    "https://github.com/docker/compose/releases/download/${ver}/docker-compose-linux-${ARCH}" \
    -o "$dir/docker-compose"
  sudo chmod +x "$dir/docker-compose"
  if [[ -d /usr/libexec/docker/cli-plugins ]]; then
    sudo ln -sfn "$dir/docker-compose" /usr/libexec/docker/cli-plugins/docker-compose
  fi
  echo "Compose: $(sudo docker compose version)"
}

bootstrap_ubuntu() {
  echo "Detected Ubuntu ${VERSION_ID}"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git gnupg

  if ! command -v docker >/dev/null 2>&1; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker "$USER"
    echo "Docker installed. Log out/in (or newgrp docker) before compose."
  else
    echo "Docker already present: $(docker --version)"
    sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
  fi

  # Prefer apt ngrok; fall back to tarball
  if ! command -v ngrok >/dev/null 2>&1; then
    if curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc 2>/dev/null \
      | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null; then
      echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list >/dev/null
      sudo apt-get update
      if sudo apt-get install -y ngrok; then
        echo "ngrok installed: $(ngrok version)"
      else
        install_ngrok_tarball
      fi
    else
      install_ngrok_tarball
    fi
  else
    echo "ngrok already present: $(ngrok version)"
  fi
}

bootstrap_amazon() {
  echo "Detected Amazon Linux ${VERSION_ID} — Ubuntu is smoother for this app; continuing anyway."
  sudo dnf install -y curl git ca-certificates tar gzip 2>/dev/null \
    || sudo yum install -y curl git ca-certificates tar gzip

  if ! command -v docker >/dev/null 2>&1; then
    if [[ "${VERSION_ID:-}" == 2 ]]; then
      sudo amazon-linux-extras enable docker >/dev/null 2>&1 || true
      sudo yum install -y docker
    else
      sudo dnf install -y docker
    fi
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER"
    echo "Docker installed: $(sudo docker --version)"
  else
    echo "Docker already present: $(docker --version 2>/dev/null || sudo docker --version)"
    sudo systemctl enable --now docker >/dev/null 2>&1 || true
    sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
  fi

  install_compose_plugin_github
  install_ngrok_tarball
}

case "${ID:-}" in
  ubuntu) bootstrap_ubuntu ;;
  amzn) bootstrap_amazon ;;
  *)
    echo "Unsupported OS ID=${ID:-unknown}. Prefer Ubuntu 24.04 AMI."
    exit 1
    ;;
esac

echo
echo "Next:"
echo "  1) newgrp docker   # or reconnect SSH"
echo "  2) ngrok config add-authtoken YOUR_TOKEN"
echo "  3) cd ~/20_SEOHUndreds && docker compose up -d --build api web"
echo "  4) Stop ngrok on your Mac, then: ngrok http --domain=YOUR_DOMAIN 5000"
