# The collaboration server. Deno, with a SQLite file on a volume.
#
# Debian rather than Alpine on purpose: the zstd compressor is a native addon built
# against glibc, and there is no musl build of it.
FROM denoland/deno:2.9.6

WORKDIR /app

# Dependencies first, so editing a source file does not refetch them. The install has to
# run the zstd package's build script; deno.json says which package that is allowed for.
COPY deno.json deno.lock ./
RUN deno install

COPY . .

# Type-check and compile up front: a broken build fails here rather than on first
# connection, and the container starts without doing any of this work.
RUN deno check src/main.ts

# The database is the only thing that outlives the container.
RUN mkdir -p /data && chown deno:deno /data
VOLUME ["/data"]

USER deno
EXPOSE 8080

CMD ["deno", "run", "-P=docker", "src/main.ts", "--database-path=/data/db.sqlite"]
