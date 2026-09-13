# Collaboration Server

A server that allows multiple people to work on the same save file together.

## Getting started

1. Install Deno

See [deno.com](https://deno.com/)

2. Start

```bash
deno run start
```

To see all available options, use

```bash
deno run start --help
```

## Running with Docker

Images are built on every push and published to
`ghcr.io/<owner>/satisfactory-architect-server`, tagged with the build number and with
`latest` on the default branch.

```bash
docker run -d \
	--name satisfactory-architect-server \
	-p 8080:8080 \
	-v satisfactory-architect-data:/data \
	ghcr.io/<owner>/satisfactory-architect-server:latest
```

The server listens on port 8080 and clients connect to `/ws`.

The volume holds `db.sqlite`, which is everything the server remembers: the rooms and
their saves. Without it, every room is lost when the container is replaced.

### Options

Everything the server can be configured with is a command line argument, so pass them
after the image name:

```bash
docker run ... ghcr.io/<owner>/satisfactory-architect-server:latest \
	deno run -P=docker src/main.ts \
	--database-path=/data/db.sqlite \
	--max-rooms-per-server=10 \
	--max-clients-per-room=8
```

`deno run start --help` lists them all, either locally or with
`docker run --rm <image> deno run -P=docker src/main.ts --help`.

Keep `--database-path` under `/data`. The container is only allowed to write there, and
nothing else in it survives a restart.

### Behind a reverse proxy

The server speaks plain WebSocket; TLS is the proxy's job. It needs to pass through the
upgrade headers and not time the connection out - clients hold a socket open for as long
as someone has the page open. In nginx:

```nginx
location /ws {
	proxy_pass http://127.0.0.1:8080;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_read_timeout 3600s;
}
```

Clients then connect to `wss://your-host/ws`. Build the UI with
`VITE_SERVER_URL=wss://your-host/ws` so it points there by default.

### Building it yourself

```bash
docker build -t satisfactory-architect-server ./server
```
