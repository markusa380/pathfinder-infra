FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Bookworm, so its glibc matches the runtime stage.
FROM rust:1-slim-bookworm AS backend-builder
WORKDIR /app/backend
COPY backend/ ./
RUN cargo build --release

FROM debian:bookworm-slim AS steamcmd
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir /steamcmd \
    && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
    | tar -xz -C /steamcmd

FROM debian:bookworm-slim
# SteamCMD is a 32-bit program, and it asks for the en_US.UTF-8 locale.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates lib32gcc-s1 lib32stdc++6 locales \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen \
    && locale-gen
ENV LANG=en_US.UTF-8
RUN useradd --uid 1000 --no-create-home arma
# SteamCMD updates itself in its own directory.
COPY --from=steamcmd --chown=arma:arma /steamcmd /opt/steamcmd
WORKDIR /app
COPY --from=backend-builder /app/backend/target/release/arma-admin ./arma-admin
# index.html references the bundle under dist/.
COPY --from=frontend-builder /app/frontend/dist ./static/dist
COPY --from=frontend-builder /app/frontend/index.html ./static/index.html

USER arma
ENV PORT=8302
EXPOSE 8302 2302-2306/udp
CMD ["./arma-admin"]
