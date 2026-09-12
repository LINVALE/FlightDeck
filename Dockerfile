# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# FlightDeck — display and control faces for every Roon zone — as one standalone image.
# It runs on its own, or beside RHEOS: RHEOS's installer adds this same image as a second container.
#
# Base: the multi-platform (linux/amd64 + linux/arm64) manifest-list digest RHEOS's release image also pins.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
FROM ${NODE_IMAGE} AS dependencies

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# The same hygiene as RHEOS's image: node-roon-api's GitHub tarball carries an encrypted deploy key, and node-uuid
# ships a test page. Neither is used at runtime.
RUN test -f /app/node_modules/node-roon-api/deploy_key.enc \
    && rm -f /app/node_modules/node-roon-api/deploy_key.enc \
    && test -d /app/node_modules/node-uuid/test \
    && rm -rf /app/node_modules/node-uuid/test

FROM ${NODE_IMAGE}

RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && find /var/log -type f -exec truncate --size 0 {} + \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
# FSL Redistribution clause: an image is a redistribution, so the licence ships in it. The Lucide ISC notice travels
# with the icons in assets/.
COPY --chown=node:node LICENSE THIRD-PARTY-NOTICES.md ./
COPY --chown=node:node src ./src
COPY --chown=node:node assets ./assets
# Exactly the three documents the server serves (/guide, /setup, /drill).
COPY --chown=node:node docs/guide.md docs/tv-setup.md docs/tv-drill.md ./docs/
RUN mkdir -p /app/notices /data \
    && npm sbom --sbom-format=cyclonedx > /tmp/sbom.cdx.json \
    && node -e 'const fs = require("node:fs"); const sbom = JSON.parse(fs.readFileSync("/tmp/sbom.cdx.json", "utf8")); delete sbom.serialNumber; if (sbom.metadata) delete sbom.metadata.timestamp; fs.writeFileSync("/app/notices/sbom.cdx.json", JSON.stringify(sbom, null, 2) + "\n", { mode: 0o644 });' \
    && rm -f /tmp/sbom.cdx.json \
    && rm -rf /root/.npm /tmp/node-compile-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && test ! -e /usr/local/lib/node_modules/npm \
    && test -x /usr/local/bin/node \
    && chown -R node:node /data \
    && chmod 0755 /app/notices \
    && chmod 0700 /data

ARG FLIGHTDECK_SOURCE_REVISION
ARG FLIGHTDECK_VERSION=0.1.0
RUN printf '%s' "${FLIGHTDECK_SOURCE_REVISION}" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$'

LABEL org.opencontainers.image.title="FlightDeck" \
      org.opencontainers.image.description="Display and control faces for every Roon zone" \
      org.opencontainers.image.version="${FLIGHTDECK_VERSION}" \
      org.opencontainers.image.revision="${FLIGHTDECK_SOURCE_REVISION}" \
      org.opencontainers.image.licenses="LicenseRef-FSL-1.1-MIT" \
      org.opencontainers.image.vendor="Linvale"

# One fixed port. A non-root container cannot bind :80, and with a single port a busy one is reported, never dodged —
# which is also what stops a second FlightDeck on the same host registering the same Roon extension.
ENV NODE_ENV=production \
    FLIGHTDECK_PORT=8440 \
    FLIGHTDECK_DATA=/data \
    FLIGHTDECK_NAME=flightdeck \
    FLIGHTDECK_BROWSE=1

USER node
EXPOSE 8440
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/src/healthcheck.ts"]
CMD ["node", "/app/src/main.ts"]
