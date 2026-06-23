# XenoXanadu — Risk match-server image (zero npm dependencies).
#
# IMPORTANT: build with the build context set to the parent `risk/` directory,
# because net/server.js require()s ../engine.js, ../maps.js, ../generals.js,
# ../bots.js. fly.toml already points build.dockerfile here, so from risk/ run:
#     flyctl deploy --config net/fly.toml
FROM node:22-alpine
WORKDIR /app

# the shared game brain the server loads under Node …
COPY engine.js maps.js generals.js bots.js ./
# … and the match-server itself
COPY net/ ./net/

# cloud platforms route to one port and terminate TLS in front of us
ENV HOST=0.0.0.0 \
    PORT=8790
EXPOSE 8790

# run as the built-in non-root user
USER node
CMD ["node", "net/server.js"]
