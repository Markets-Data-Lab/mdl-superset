"""
Production Superset configuration for AWS ECS Fargate deployment.

Environment variables required (set via ECS task definition / Secrets Manager):
  - SECRET_KEY: Cryptographically secure random string
  - DATABASE_URL: PostgreSQL RDS connection string
  - REDIS_URL: ElastiCache Redis connection string
  - COGNITO_DOMAIN: Cognito user pool domain
    (e.g. myapp.auth.us-east-1.amazoncognito.com)
  - COGNITO_CLIENT_ID: Cognito app client ID
  - COGNITO_CLIENT_SECRET: Cognito app client secret
  - COGNITO_REGION: AWS region (e.g. us-east-1)
  - COGNITO_USER_POOL_ID: Cognito user pool ID
  - SUPERSET_PUBLIC_URL: Public URL of your Superset instance (via CloudFront)

Snowflake connection (optional — set SNOWFLAKE_ACCOUNT to enable):
  - SNOWFLAKE_ACCOUNT: Snowflake account identifier (e.g. xy12345.us-east-1)
  - SNOWFLAKE_USER: Snowflake service account username
  - SNOWFLAKE_DATABASE: Snowflake database name
  - SNOWFLAKE_SCHEMA: Snowflake schema (default: PUBLIC)
  - SNOWFLAKE_WAREHOUSE: Snowflake compute warehouse
  - SNOWFLAKE_ROLE: Snowflake role
  - SNOWFLAKE_PRIVATE_KEY: PEM-encoded PKCS8 private key for key-pair auth
  - SNOWFLAKE_PRIVATE_KEY_PASS: Private key passphrase (optional, if key is encrypted)
"""

from __future__ import annotations

import logging
import os
import typing as t
from datetime import timedelta

from celery.schedules import crontab
from custom_sso_security_manager import CognitoSecurityManager
from flask import Flask
from flask_appbuilder.security.manager import AUTH_OAUTH

logger = logging.getLogger()


# ---------------------------------------------------------------------------
# Snowflake connection bootstrap
# ---------------------------------------------------------------------------
SNOWFLAKE_ACCOUNT = os.environ.get("SNOWFLAKE_ACCOUNT", "")  # e.g. xy12345.us-east-1
SNOWFLAKE_USER = os.environ.get("SNOWFLAKE_USER", "")
SNOWFLAKE_DATABASE = os.environ.get("SNOWFLAKE_DATABASE", "")
SNOWFLAKE_SCHEMA = os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC")
SNOWFLAKE_WAREHOUSE = os.environ.get("SNOWFLAKE_WAREHOUSE", "")
SNOWFLAKE_ROLE = os.environ.get("SNOWFLAKE_ROLE", "")
# PEM-encoded PKCS8 private key (the full -----BEGIN/END----- block)
SNOWFLAKE_PRIVATE_KEY = os.environ.get("SNOWFLAKE_PRIVATE_KEY", "")
SNOWFLAKE_PRIVATE_KEY_PASS = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASS")


def _bootstrap_snowflake(app: Flask) -> None:
    """Create or update the Snowflake database connection on startup.

    Reads connection details from environment variables. Skips if
    SNOWFLAKE_ACCOUNT is not set.
    """
    import json

    if not SNOWFLAKE_ACCOUNT:
        logger.info("SNOWFLAKE_ACCOUNT not set — skipping Snowflake bootstrap")
        return

    with app.app_context():
        # Import here to avoid circular imports at module level
        from superset.extensions import db as sa_db
        from superset.models.core import Database

        snowflake_uri = (
            f"snowflake://{SNOWFLAKE_USER}@{SNOWFLAKE_ACCOUNT}"
            f"/{SNOWFLAKE_DATABASE}/{SNOWFLAKE_SCHEMA}"
            f"?warehouse={SNOWFLAKE_WAREHOUSE}&role={SNOWFLAKE_ROLE}"
        )

        encrypted_extra = json.dumps(
            {
                "auth_method": "keypair",
                "auth_params": {
                    "privatekey_body": SNOWFLAKE_PRIVATE_KEY,
                    "privatekey_pass": SNOWFLAKE_PRIVATE_KEY_PASS,
                },
            }
        )

        db_name = f"Snowflake - {SNOWFLAKE_DATABASE}"
        existing = (
            sa_db.session.query(Database)
            .filter_by(
                database_name=db_name,
            )
            .first()
        )

        if existing:
            existing.sqlalchemy_uri = snowflake_uri
            existing.encrypted_extra = encrypted_extra
            logger.info("Updated existing Snowflake connection: %s", db_name)
        else:
            new_db = Database(
                database_name=db_name,
                sqlalchemy_uri=snowflake_uri,
                encrypted_extra=encrypted_extra,
                expose_in_sqllab=True,
                allow_ctas=False,
                allow_cvas=False,
                allow_dml=False,
            )
            sa_db.session.add(new_db)
            logger.info("Created Snowflake connection: %s", db_name)

        sa_db.session.commit()


# Allow Snowflake key-pair authentication
ALLOWED_EXTRA_AUTHENTICATIONS: dict[str, dict[str, t.Any]] = {}

# ---------------------------------------------------------------------------
# Core settings
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ["SECRET_KEY"]
SUPERSET_PUBLIC_URL = os.environ.get(
    "SUPERSET_PUBLIC_URL", "https://superset.example.com"
)

# Metadata database (RDS PostgreSQL)
# Supports either a full DATABASE_URL or individual components from RDS Secrets Manager
DATABASE_URL = os.environ.get("DATABASE_URL")
if DATABASE_URL:
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
else:
    _db_user = os.environ.get("DB_USER", "superset")
    _db_pass = os.environ.get("DB_PASS", "")
    _db_host = os.environ.get("DATABASE_HOST", "localhost")
    _db_port = os.environ.get("DATABASE_PORT", "5432")
    _db_name = os.environ.get("DATABASE_DB", "superset")
    SQLALCHEMY_DATABASE_URI = (
        f"postgresql+psycopg2://{_db_user}:{_db_pass}@{_db_host}:{_db_port}/{_db_name}"
    )

# Disable example data in production
SUPERSET_LOAD_EXAMPLES = False

# Webserver
ENABLE_PROXY_FIX = True  # Required behind ALB/CloudFront
PROXY_FIX_CONFIG = {
    "x_for": 1,
    "x_proto": 0,  # Disabled: ALB sets proto to http since CloudFront→ALB is HTTP
    "x_host": 1,
    "x_port": 0,
    "x_prefix": 0,
}
PREFERRED_URL_SCHEME = "https"


# Force HTTPS at WSGI level so Flask's url_for() generates https:// redirect URIs.
# CloudFront terminates TLS but ALB→ECS is plain HTTP, so the request scheme is "http".
# PREFERRED_URL_SCHEME alone doesn't override during active requests; we need to set
# wsgi.url_scheme in the environ before Flask creates the request context.
def FLASK_APP_MUTATOR(app: Flask) -> None:  # noqa: N802
    """Wrap WSGI app to force HTTPS scheme and bootstrap Snowflake connection."""
    _inner_wsgi = app.wsgi_app

    class _ForceHTTPS:
        def __init__(self, wsgi: t.Any) -> None:
            self.wsgi = wsgi

        def __call__(self, environ: dict[str, t.Any], start_response: t.Any) -> t.Any:
            environ["wsgi.url_scheme"] = "https"
            return self.wsgi(environ, start_response)

    app.wsgi_app = _ForceHTTPS(_inner_wsgi)

    _bootstrap_snowflake(app)


# ---------------------------------------------------------------------------
# Redis / Caching (ElastiCache)
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_URL": f"{REDIS_URL}/0",
}
DATA_CACHE_CONFIG = {
    **CACHE_CONFIG,
    "CACHE_KEY_PREFIX": "superset_data_",
    "CACHE_DEFAULT_TIMEOUT": 600,
}
FILTER_STATE_CACHE_CONFIG = {
    **CACHE_CONFIG,
    "CACHE_KEY_PREFIX": "superset_filter_",
    "CACHE_DEFAULT_TIMEOUT": 600,
}
EXPLORE_FORM_DATA_CACHE_CONFIG = {
    **CACHE_CONFIG,
    "CACHE_KEY_PREFIX": "superset_explore_",
    "CACHE_DEFAULT_TIMEOUT": 600,
}


# ---------------------------------------------------------------------------
# Celery (async queries, alerts, reports)
# ---------------------------------------------------------------------------
class CeleryConfig:
    broker_url = f"{REDIS_URL}/1"
    result_backend = f"{REDIS_URL}/2"
    imports = (
        "superset.sql_lab",
        "superset.tasks.scheduler",
        "superset.tasks.thumbnails",
        "superset.tasks.cache",
    )
    worker_prefetch_multiplier = 1
    task_acks_late = False
    beat_schedule = {
        "reports.scheduler": {
            "task": "reports.scheduler",
            "schedule": crontab(minute="*", hour="*"),
        },
        "reports.prune_log": {
            "task": "reports.prune_log",
            "schedule": crontab(minute=10, hour=0),
        },
    }


CELERY_CONFIG = CeleryConfig

# SQLLab result backend
RESULTS_BACKEND = None  # Use Redis via Celery result backend
RESULTS_BACKEND_USE_MSGPACK = True

# ---------------------------------------------------------------------------
# Cognito OIDC Authentication
# ---------------------------------------------------------------------------
COGNITO_DOMAIN = os.environ["COGNITO_DOMAIN"]
COGNITO_REGION = os.environ.get("COGNITO_REGION", "us-east-1")
COGNITO_USER_POOL_ID = os.environ["COGNITO_USER_POOL_ID"]
COGNITO_CLIENT_ID = os.environ["COGNITO_CLIENT_ID"]
COGNITO_CLIENT_SECRET = os.environ["COGNITO_CLIENT_SECRET"]

AUTH_TYPE = AUTH_OAUTH
AUTH_USER_REGISTRATION = True
AUTH_USER_REGISTRATION_ROLE = "Gamma"  # Default role for new users
AUTH_ROLES_SYNC_AT_LOGIN = True

# Map Cognito groups to Superset roles
AUTH_ROLES_MAPPING = {
    "am-infra-emi-admin": ["Admin"],
    "am-infra-emi": ["Alpha"],
    "am-non-emi": ["Gamma"],
}

OAUTH_PROVIDERS = [
    {
        "name": "cognito",
        "icon": "fa-amazon",
        "token_key": "access_token",
        "remote_app": {
            "client_id": COGNITO_CLIENT_ID,
            "client_secret": COGNITO_CLIENT_SECRET,
            "server_metadata_url": (
                f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com"
                f"/{COGNITO_USER_POOL_ID}/.well-known/openid-configuration"
            ),
            "api_base_url": (
                f"https://{COGNITO_DOMAIN}.auth.{COGNITO_REGION}.amazoncognito.com/"
            ),
            "client_kwargs": {
                "scope": "openid email profile",
            },
            "access_token_url": (
                f"https://{COGNITO_DOMAIN}.auth.{COGNITO_REGION}.amazoncognito.com/oauth2/token"
            ),
            "authorize_url": (
                f"https://{COGNITO_DOMAIN}.auth.{COGNITO_REGION}.amazoncognito.com/oauth2/authorize"
            ),
        },
    }
]

CUSTOM_SECURITY_MANAGER = CognitoSecurityManager

# Log out of both Superset AND the Cognito hosted UI session.
# After Cognito clears its session it redirects back to Superset's login page.
LOGOUT_REDIRECT_URL = (
    f"https://{COGNITO_DOMAIN}.auth.{COGNITO_REGION}.amazoncognito.com/logout"
    f"?client_id={COGNITO_CLIENT_ID}"
    f"&logout_uri={SUPERSET_PUBLIC_URL}/login/"
)

# ---------------------------------------------------------------------------
# Security hardening
# ---------------------------------------------------------------------------
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

WTF_CSRF_ENABLED = True
# Disable SSL strict Referer checking for CSRF validation. Behind
# CloudFront → ALB the Referer header contains the CloudFront domain
# while request.host resolves to the ALB hostname (ALB does not set
# X-Forwarded-Host), causing every mutating API request to fail CSRF
# validation with a Referer mismatch.
WTF_CSRF_SSL_STRICT = False
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    # Tune once deployed; Superset needs inline scripts
    "content_security_policy": None,
    "force_https": False,  # TLS is terminated at CloudFront/ALB
}

# CORS - adjust origins to your CloudFront domain
CORS_OPTIONS = {
    "supports_credentials": True,
    "allow_headers": ["*"],
    "resources": ["*"],
    "origins": [SUPERSET_PUBLIC_URL],
}

# Disable Swagger in production
FAB_API_SWAGGER_UI = False

# ---------------------------------------------------------------------------
# Branding (A&M / Markets Data Lab)
# ---------------------------------------------------------------------------
APP_NAME = "Markets Data Lab"
APP_ICON = "/static/assets/images/am-mdl-color-logo.png"
APP_ICON_WIDTH = 120
LOGO_TARGET_PATH = "/"
LOGO_TOOLTIP = "Markets Data Lab"
LOGO_RIGHT_TEXT = ""
FAVICONS = [{"href": "/static/assets/images/am-mdl-color-logo.png"}]

THEME_DEFAULT = {
    "token": {
        "brandAppName": "Markets Data Lab",
        "brandLogoAlt": "A&M Markets Data Lab",
        "brandLogoUrl": "/static/assets/images/am-mdl-color-logo.png",
        "brandLogoMargin": "8px 0 8px 25px",
        "brandLogoHref": "/",
        "brandLogoHeight": "48px",
        "brandSpinnerUrl": None,
        "brandSpinnerSvg": None,
    },
    "algorithm": "default",
}

THEME_DARK = {
    "token": {
        "brandAppName": "Markets Data Lab",
        "brandLogoAlt": "A&M Markets Data Lab",
        "brandLogoUrl": "/static/assets/images/am-mdl-white-logo.png",
        "brandLogoMargin": "8px 0 8px 25px",
        "brandLogoHref": "/",
        "brandLogoHeight": "48px",
        "brandSpinnerUrl": None,
        "brandSpinnerSvg": None,
    },
    "algorithm": "dark",
}

# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------
FEATURE_FLAGS = {
    "ALERT_REPORTS": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "DASHBOARD_RBAC": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
    "DATASET_FOLDERS": True,
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.environ.get("SUPERSET_LOG_LEVEL", "INFO")

# ---------------------------------------------------------------------------
# Webdriver (for alerts/reports - optional)
# ---------------------------------------------------------------------------
WEBDRIVER_BASEURL = f"http://localhost:{os.environ.get('SUPERSET_PORT', '8088')}/"
WEBDRIVER_BASEURL_USER_FRIENDLY = f"{SUPERSET_PUBLIC_URL}/"

# ---------------------------------------------------------------------------
# SQL Lab
# ---------------------------------------------------------------------------
SQLLAB_CTAS_NO_LIMIT = True
SQL_MAX_ROW = 100000
