#
# Production Dockerfile for Superset on AWS ECS Fargate.
#
# This is a standalone multi-stage build that produces a production image
# with Snowflake + Cognito OIDC support.
#
# Build from repo root:
#   docker build -f deployment/Dockerfile -t superset-prod .
#
ARG PY_VER=3.11.14-slim-trixie
ARG BUILD_TRANSLATIONS="true"
ARG BUILDPLATFORM=${BUILDPLATFORM:-amd64}

######################################################################
# Stage 1: Build frontend assets
######################################################################
FROM --platform=${BUILDPLATFORM} node:20-trixie-slim AS frontend-build

COPY docker/ /app/docker/
RUN /app/docker/apt-install.sh build-essential python3 zstd

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN /app/docker/frontend-mem-nag.sh

WORKDIR /app/superset-frontend

RUN mkdir -p /app/superset/static/assets /app/superset/translations

RUN --mount=type=bind,source=./superset-frontend/package.json,target=./package.json \
    --mount=type=bind,source=./superset-frontend/package-lock.json,target=./package-lock.json \
    --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.npm \
    npm ci

COPY superset-frontend /app/superset-frontend
RUN --mount=type=cache,target=/root/.npm npm run build

COPY superset/translations /app/superset/translations
ARG BUILD_TRANSLATIONS
RUN if [ "${BUILD_TRANSLATIONS}" = "true" ]; then npm run build-translation; fi; \
    rm -rf /app/superset/translations/*/*/*.[po,mo]

######################################################################
# Stage 2: Python base
######################################################################
FROM python:${PY_VER} AS python-base

ARG SUPERSET_HOME="/app/superset_home"
ENV SUPERSET_HOME=${SUPERSET_HOME}

RUN mkdir -p ${SUPERSET_HOME} && \
    useradd --user-group -d ${SUPERSET_HOME} -m --no-log-init --shell /bin/bash superset && \
    chmod -R 1777 ${SUPERSET_HOME} && \
    chown -R superset:superset ${SUPERSET_HOME}

COPY --chmod=755 docker/*.sh /app/docker/
RUN pip install --no-cache-dir --upgrade uv
RUN uv venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}"

######################################################################
# Stage 3: Translation compiler
######################################################################
FROM python-base AS translation-compiler
ARG BUILD_TRANSLATIONS="true"
COPY requirements/translations.txt requirements/
RUN --mount=type=cache,target=/root/.cache/uv \
    . /app/.venv/bin/activate && /app/docker/pip-install.sh --requires-build-essential -r requirements/translations.txt
COPY superset/translations/ /app/translations_mo/
RUN if [ "${BUILD_TRANSLATIONS}" = "true" ]; then pybabel compile -d /app/translations_mo | true; fi; \
    rm -f /app/translations_mo/*/*/*.[po,json]

######################################################################
# Stage 4: Production image
######################################################################
FROM python-base AS production

ENV SUPERSET_HOME="/app/superset_home" \
    HOME="/app/superset_home" \
    SUPERSET_ENV="production" \
    FLASK_APP="superset.app:create_app()" \
    PYTHONPATH="/app/pythonpath" \
    SUPERSET_PORT="8088" \
    FLASK_DEBUG="false"

COPY --chmod=755 docker/entrypoints /app/docker/entrypoints
WORKDIR /app

RUN mkdir -p \
      ${PYTHONPATH} \
      superset/static \
      requirements \
      superset-frontend \
      apache_superset.egg-info \
    && touch superset/static/version_info.json

# System dependencies
RUN /app/docker/apt-install.sh \
      curl \
      libsasl2-dev \
      libsasl2-modules-gssapi-mit \
      libpq-dev \
      libecpg-dev \
      libldap2-dev

RUN mkdir -p /app/data && chown -R superset:superset /app/data

# Copy compiled frontend assets
COPY --from=frontend-build /app/superset/static/assets superset/static/assets

# Copy Python source
COPY pyproject.toml setup.py MANIFEST.in README.md ./
COPY superset-frontend/package.json superset-frontend/
COPY scripts/check-env.py scripts/
COPY superset superset
RUN rm -f superset/translations/*/*/*.po
COPY --from=frontend-build /app/superset/translations superset/translations
COPY --from=translation-compiler /app/translations_mo superset/translations

# Install Python dependencies
COPY requirements/base.txt requirements/
COPY superset-core superset-core

RUN --mount=type=cache,target=${SUPERSET_HOME}/.cache/uv \
    /app/docker/pip-install.sh --requires-build-essential -r requirements/base.txt

RUN --mount=type=cache,target=${SUPERSET_HOME}/.cache/uv \
    uv pip install -e .

# Install production extras: Snowflake, Cognito OIDC, PostgreSQL driver
RUN --mount=type=cache,target=${SUPERSET_HOME}/.cache/uv \
    uv pip install \
        "snowflake-sqlalchemy>=1.2.4,<2" \
        "authlib>=1.3,<2" \
        "psycopg2-binary>=2.9,<3"

RUN python -m compileall /app/superset

# Copy production configuration
COPY deployment/docker/superset_config.py /app/pythonpath/superset_config.py
COPY deployment/docker/custom_sso_security_manager.py /app/pythonpath/custom_sso_security_manager.py

# backward compatibility
COPY --chmod=755 ./docker/entrypoints/run-server.sh /usr/bin/

# Production gunicorn defaults
ENV SERVER_WORKER_AMOUNT=4 \
    SERVER_WORKER_CLASS=gthread \
    SERVER_THREADS_AMOUNT=20 \
    GUNICORN_TIMEOUT=120 \
    GUNICORN_KEEPALIVE=5 \
    WORKER_MAX_REQUESTS=1000 \
    WORKER_MAX_REQUESTS_JITTER=50 \
    SUPERSET_LOG_LEVEL=INFO

USER superset

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f "http://localhost:${SUPERSET_PORT:-8088}/health" || exit 1

CMD ["/app/docker/entrypoints/run-server.sh"]
EXPOSE 8088
