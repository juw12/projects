# =============================================================================
# OpenForge CI Runner Image
# Base: node:22-bookworm-slim (matches api/web stack so workspace deps install)
# This is a Docker-in-Docker (DinD) image with gVisor's runsc installed as a
# Docker runtime. Job containers launched by the runner daemon use runsc, so
# untrusted user code never touches the host kernel.
# =============================================================================

ARG NODE_BASE=node:22-bookworm-slim
ARG RUNSC_VERSION=20231219.0
ARG BUN_VERSION=1.1.34

FROM ${NODE_BASE} AS base

# Build-time args (pinned to specific versions for reproducibility)
ARG RUNSC_VERSION
ARG BUN_VERSION
ARG DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# 1. System dependencies
# - git, openssh-client: clone the repo under test, accept deploy keys
# - curl, ca-certificates: install runsc + bun from official sources
# - iptables, uidmap: gVisor runsc network mode requires iptables
# - tini: PID 1 init (proper signal forwarding + zombie reaping)
# - sudo: lets the non-root runner user invoke dockerd via the DinD socket
# ---------------------------------------------------------------------------
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      ca-certificates \
      curl \
      gnupg \
      iptables \
      uidmap \
      tini \
      sudo \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# 2. gVisor runsc installation
# Pinned to a specific release so security audit doesn't drift under us.
# https://github.com/google/gvisor/releases
# ---------------------------------------------------------------------------
ARG TARGETARCH=amd64
RUN set -eux; \
    ARCH="$TARGETARCH"; \
    if [ "$ARCH" != "amd64" ] && [ "$ARCH" != "x86_64" ]; then \
        echo "ERROR: gVisor runsc only ships for amd64 in the standard release." >&2; \
        exit 1; \
    fi; \
    curl -fsSL \
      "https://github.com/google/gvisor/releases/download/${RUNSC_VERSION}/runsc-${RUNSC_VERSION}-linux-amd64" \
      -o /usr/local/bin/runsc; \
    curl -fsSL \
      "https://github.com/google/gvisor/releases/download/${RUNSC_VERSION}/runsc-${RUNSC_VERSION}-linux-amd64.sha256" \
      -o /tmp/runsc.sha256; \
    (cd /tmp && sha256sum -c runsc.sha256); \
    chmod 0755 /usr/local/bin/runsc; \
    runsc --version

# ---------------------------------------------------------------------------
# 3. Docker-in-Docker (DinD) daemon
# We use the official dockerd-rootless approach BUT rootful here because
# gVisor's runsc needs CAP_SYS_ADMIN in the parent to set up namespaces.
# Pin to a specific Docker CLI/server version for reproducibility.
# ---------------------------------------------------------------------------
ARG DOCKER_VERSION=27.3.1
RUN set -eux; \
    curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
      -o /tmp/docker.tgz; \
    tar --extract --file /tmp/docker.tgz --strip-components 1 \
        --directory /usr/local/bin \
        docker/dockerd docker/docker-init docker/docker-proxy; \
    rm /tmp/docker.tgz; \
    dockerd --version

# ---------------------------------------------------------------------------
# 4. Register runsc as a Docker runtime
# /etc/docker/daemon.json is the canonical config; merging with jq keeps
# any operator overrides intact if they bind-mount a custom daemon.json.
# ---------------------------------------------------------------------------
RUN mkdir -p /etc/docker \
 && printf '%s\n' \
      '{' \
      '  "runtimes": {' \
      '    "runsc": {' \
      '      "path": "/usr/local/bin/runsc",' \
      '      "runtimeArgs": []' \
      '    }' \
      '  },' \
      '  "features": { "containerd-snapshotter": false },' \
      '  "log-driver": "json-file",' \
      '  "log-opts": {' \
      '    "max-size": "10m",' \
      '    "max-file": "3"' \
      '  },' \
      '  "storage-driver": "overlay2",' \
      '  "live-restore": true' \
      '}' \
      > /etc/docker/daemon.json

# ---------------------------------------------------------------------------
# 5. Bun runtime (for the runner daemon — fast TS startup, native fetch)
# Falls back to node + tsx if Bun is undesired; entrypoint honors BUN_ENABLED.
# ---------------------------------------------------------------------------
RUN set -eux; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
      -o /tmp/bun.zip; \
    (cd /usr/local/bin && unzip -o /tmp/bun.zip && chmod +x bun); \
    rm /tmp/bun.zip; \
    bun --version

# ---------------------------------------------------------------------------
# 6. Runner user
# The runner daemon runs as 'runner' (non-root) for defense-in-depth.
# Docker-in-Docker runs as root via a separate entrypoint stage; the daemon
# hands the user 'runner' sudo rights ONLY for dockerd's rootful helpers.
# gVisor job containers run with --user 1000:1000 (the build user's UID).
# ---------------------------------------------------------------------------
RUN groupadd --system --gid 1001 runner \
 && useradd  --system --uid 1001 --gid runner \
              --home-dir /home/runner --shell /bin/bash \
              --comment "OpenForge CI runner daemon" runner \
 && mkdir -p /home/runner /workspace /var/lib/openforge/runner-tmp /etc/openforge \
 && chown -R runner:runner /home/runner /workspace /var/lib/openforge/runner-tmp \
 && echo "runner ALL=(root) NOPASSWD: /usr/local/bin/dockerd" > /etc/sudoers.d/runner \
 && chmod 0440 /etc/sudoers.d/runner

# ---------------------------------------------------------------------------
# 7. Bake in security configs + runner source
# .dockerignore keeps node_modules out of the image (rebuilt at runtime).
# ---------------------------------------------------------------------------
WORKDIR /app
COPY --chown=runner:runner src/        ./src/
COPY --chown=runner:runner package.json tsconfig.json ./
COPY --chown=root:root   configs/      /etc/openforge/
COPY --chown=root:root   entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && mkdir -p /var/log/openforge \
 && chown runner:runner /var/log/openforge

# Bun cache dirs (so the first job doesn't pay install cost)
ENV BUN_INSTALL=/home/runner/.bun
ENV XDG_CACHE_HOME=/home/runner/.cache

# ---------------------------------------------------------------------------
# 8. Runtime defaults
# - DOCKER_HOST: the DinD socket the runner daemon talks to.
# - RUNSC_PATH: where the spawned job containers find runsc (host path).
# - The daemon writes audit logs to stdout (compose picks them up).
# ---------------------------------------------------------------------------
ENV DOCKER_HOST=unix:///var/run/docker.sock \
    RUNSC_PATH=/usr/local/bin/runsc \
    NODE_ENV=production \
    LOG_LEVEL=info \
    PATH=/home/runner/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Run as the unprivileged 'runner' user; entrypoint escalates to dockerd via sudo.
USER runner
WORKDIR /home/runner

# tini as PID 1 for proper signal handling + zombie reaping
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["--foreground"]
