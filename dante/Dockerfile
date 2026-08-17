FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        dante-server \
        netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 1080

CMD ["/entrypoint.sh"]
