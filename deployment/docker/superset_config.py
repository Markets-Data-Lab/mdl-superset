"""
Production Superset configuration for AWS ECS Fargate deployment.

Environment variables required (set via ECS task definition / Secrets Manager):
  - SECRET_KEY: Cryptographically secure random string
  - DATABASE_URL: PostgreSQL RDS connection string
  - REDIS_URL: ElastiCache Redis connection string
  - COGNITO_DOMAIN: Cognito user pool domain (e.g. myapp.auth.us-east-1.amazoncognito.com)
  - COGNITO_CLIENT_ID: Cognito app client ID
  - COGNITO_CLIENT_SECRET: Cognito app client secret
  - COGNITO_REGION: AWS region (e.g. us-east-1)
  - COGNITO_USER_POOL_ID: Cognito user pool ID
  - SUPERSET_PUBLIC_URL: Public URL of your Superset instance (via CloudFront)
"""

import os
import logging
from datetime import timedelta

from celery.schedules import crontab
from flask_appbuilder.security.manager import AUTH_OAUTH

from custom_sso_security_manager import CognitoSecurityManager

logger = logging.getLogger()

# ---------------------------------------------------------------------------
# Core settings
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ["SECRET_KEY"]
SUPERSET_PUBLIC_URL = os.environ.get("SUPERSET_PUBLIC_URL", "https://superset.example.com")

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
    "x_for": 2,  # CloudFront -> ALB -> ECS
    "x_proto": 2,
    "x_host": 1,
    "x_port": 0,
    "x_prefix": 0,
}

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

# ---------------------------------------------------------------------------
# Security hardening
# ---------------------------------------------------------------------------
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    "content_security_policy": None,  # Tune once deployed; Superset needs inline scripts
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
